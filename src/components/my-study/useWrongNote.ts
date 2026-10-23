"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import type { WrongNotePracticeResult } from "@/lib/api/types";
import { masterWrongNote, practiceWrongNote, type WrongNoteAnswer } from "@/lib/api/wrongNote";
import { mergePractice, setMastered, wrongNoteErrorAction, type NoteStudy } from "./wrongNote";

/** 다시 풀기 결과 — 실패면 field = 「답을 확인해 주세요」 를 띄울 문항(모르면 null). 토스트·다시 받기는 훅이 이미 했다 */
export type PracticeOutcome = { ok: true; results: WrongNotePracticeResult["results"] } | { ok: false; field?: string | null };

type Opts = {
  toast: (m: ToastMsg) => void;
  /** 거짓이면 받지 않는다 — 내 과제는 「오답노트」 보기가 처음 열릴 때 받는다(D19). 한 번 받으면 deps 가 바뀔 때만 다시 */
  enabled?: boolean;
};

/**
 * 오답노트 데이터 — 방 탭(fetchWrongNote)·내 과제(fetchWrongNoteMine) 공용(D17~D21). 로더만 다르고 연습·외움은 같다.
 * 연습·외움 응답은 목록을 다시 받지 않고 합친다(mergePractice·setMastered) — 머리줄은 화면이 totalsOf 로 다시 센다(D21).
 * 목록과 서버가 어긋난 오류(노트에 없음·잠김…)는 토스트 + 다시 받기
 */
export function useWrongNote(load: () => Promise<NoteStudy[]>, deps: readonly unknown[], { toast, enabled = true }: Opts) {
  const [studies, setStudies] = useState<NoteStudy[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  const toastRef = useRef(toast);
  useEffect(() => {
    loadRef.current = load;
    toastRef.current = toast;
  });
  // 받을 열쇠(deps + 다시 받기) — 꺼졌다 켜져도 같은 열쇠를 이미 받았으면 다시 받지 않는다
  const key = JSON.stringify([tick, ...deps]);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || asked.current === key) return;
    asked.current = key;
    let live = true;
    let settled = false;
    loadRef
      .current()
      .then((s) => {
        settled = true;
        if (!live) return;
        setStudies(s);
        setError(false);
        setDoneKey(key);
      })
      .catch(() => {
        settled = true;
        if (!live) return;
        setError(true);
        setDoneKey(key);
      });
    return () => {
      live = false;
      // 응답 전에 열쇠가 바뀌었거나 꺼졌다 — 같은 열쇠로 다시 켜지면 그때 받는다
      if (!settled && asked.current === key) asked.current = null;
    };
  }, [enabled, key]);
  const loading = enabled && doneKey !== key;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  // 같은 틱의 두 번째 클릭(상태 반영 전)도 막는다
  const inflight = useRef(false);
  const run = useCallback(async <T,>(f: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; field?: string | null }> => {
    if (inflight.current) return { ok: false };
    inflight.current = true;
    setBusy(true);
    try {
      return { ok: true, v: await f() };
    } catch (e) {
      const a = wrongNoteErrorAction(toApiError(e));
      if (a.kind === "field") return { ok: false, field: a.questionId };
      toastRef.current({ text: a.text, tone: "bad" });
      if (a.kind === "refetch") setTick((t) => t + 1);
      return { ok: false };
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  const practice = useCallback(
    async (slug: string, answers: WrongNoteAnswer[]): Promise<PracticeOutcome> => {
      const r = await run(() => practiceWrongNote(slug, answers));
      if (!r.ok) return r;
      setStudies((s) => (s ? mergePractice(s, r.v.results) : s));
      return { ok: true, results: r.v.results };
    },
    [run],
  );

  const master = useCallback(
    async (slug: string, questionId: string, on: boolean): Promise<boolean> => {
      const r = await run(() => masterWrongNote(slug, questionId, on));
      if (!r.ok) return false;
      setStudies((s) => (s ? setMastered(s, questionId, r.v.mastered) : s));
      toastRef.current(on ? { text: "외운 문제로 옮겼어요 · 「외운 문제 보기」로 되돌릴 수 있어요", tone: "ok" } : { text: "오답노트에 다시 넣었어요", tone: "ok" });
      return true;
    },
    [run],
  );

  return { studies, error, loading, refetch, practice, master, busy };
}
