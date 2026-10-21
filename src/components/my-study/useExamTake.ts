"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError, type ApiError } from "@/lib/api/errors";
import { fetchExam, saveExamAnswer, submitExam } from "@/lib/api/exam";
import type { ExamView } from "@/lib/api/types";
import { answeredCount, examErrorAction } from "./exam";

export type ExamSaveState = "idle" | "saving" | "saved" | "failed";

/** 답을 고른 뒤 이만큼 조용하면 저장한다(스펙 §4.3) */
export const SAVE_DEBOUNCE_MS = 400;

type Got = { nodeId: string; view: ExamView | null; error: ApiError | null };

/**
 * 응시 화면 상태(스펙 §4.3) — exam_get · 답 즉시 저장(400ms 디바운스, 한 번에 하나씩 차례로) · 제출.
 * 화면에 보이는 답 = 서버 답 위에 보내는 중·아직 보내지 않은 답을 덮은 것. 나갈 때(언마운트) 남은 답은 보내던 저장 뒤에 이어 보낸다.
 */
export function useExamTake(slug: string, nodeId: string, toast: (m: ToastMsg) => void) {
  const [got, setGot] = useState<Got | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [save, setSave] = useState<ExamSaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(new Map<string, unknown>());
  /** 지금 보내는 중인 답 — pending 에서 빠졌지만 서버에 아직 없을 수 있다(재조회가 덮어쓰지 않게) */
  const sending = useRef<[string, unknown] | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const toastRef = useRef(toast);
  const answersRef = useRef(answers);
  const viewRef = useRef<ExamView | null>(null);
  useEffect(() => {
    toastRef.current = toast;
    answersRef.current = answers;
    viewRef.current = got?.nodeId === nodeId ? got.view : null;
  });

  useEffect(() => {
    const id = ++seq.current;
    fetchExam(slug, nodeId).then(
      (view) => {
        if (id !== seq.current) return;
        // 제출은 되돌릴 수 없다 — 제출 전에 떠난 늦은 응답이 결과 화면을 응시 화면으로 되돌리지 않게
        if (viewRef.current?.attempt?.status === "submitted" && view.attempt?.status !== "submitted") return;
        setGot({ nodeId, view, error: null });
        // 받은 답 위에 보내는 중·아직 못 보낸 답을 덮는다(재조회가 고르던 답을 지우지 않게)
        const s = sending.current;
        setAnswers({ ...(view.attempt?.answers ?? {}), ...(s ? { [s[0]]: s[1] } : {}), ...Object.fromEntries(pending.current) });
      },
      (e) => {
        if (id !== seq.current) return;
        setGot((p) => ({ nodeId, view: p?.nodeId === nodeId ? p.view : null, error: toApiError(e) }));
      },
    );
  }, [slug, nodeId, tick]);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  /** 실패 → 토스트. 상태가 바뀐 실패(마감·제출됨·문항 교체 등)는 보낼 답을 버리고 다시 불러온다 */
  const fail = useCallback(
    (e: unknown) => {
      const act = examErrorAction(toApiError(e));
      toastRef.current({ text: act.text, tone: "bad" });
      if (act.kind === "refetch" || act.kind === "field") {
        // 상태가 바뀌었거나 서버가 그 답을 받지 않는다 — 다시 보내지 않고 서버 것을 다시 받는다
        if (act.kind === "refetch") pending.current.clear();
        setSave(pending.current.size > 0 ? "failed" : "idle"); // 남은 다른 답은 [다시 시도]로
        refetch();
        return;
      }
      setSave("failed");
    },
    [refetch],
  );

  /** 남은 답을 차례로 보낸다. 모두 저장되면 true. 이미 보내는 중이면 그 흐름을 기다린다 */
  const drain = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // 보내는 중이면 그 흐름이 끝나길 기다린 뒤 남은 답을 이어서 보낸다
    while (inflight.current) if (!(await inflight.current)) return false;
    if (pending.current.size === 0) return true;
    if (alive.current) setSave("saving");
    const run = (async () => {
      let answered: number | null = null;
      while (pending.current.size > 0) {
        const [qid, ans] = pending.current.entries().next().value as [string, unknown];
        pending.current.delete(qid);
        sending.current = [qid, ans];
        try {
          answered = (await saveExamAnswer(nodeId, qid, ans)).answered;
        } catch (e) {
          // 다시 보내도 같은 결과인 실패(모양 오류·상태 변경)는 버린다. 그 밖엔 그사이 같은 문항을 다시 고르지 않았으면 다시 보낼 줄에 남긴다
          const kind = examErrorAction(toApiError(e)).kind;
          if (kind !== "field" && kind !== "refetch" && !pending.current.has(qid)) pending.current.set(qid, ans);
          if (alive.current) fail(e);
          return false;
        } finally {
          sending.current = null;
        }
      }
      if (!alive.current) return true;
      setSave("saved");
      // "답함 n/총" = 서버 answered. 어긋나면(다른 탭에서 푼 답 등) 서버 것을 다시 받는다
      const qs = viewRef.current?.questions;
      if (qs && answered !== null && answeredCount(qs, answersRef.current) !== answered) refetch();
      return true;
    })();
    inflight.current = run;
    void run.finally(() => {
      if (inflight.current === run) inflight.current = null;
    });
    return run;
  }, [nodeId, fail, refetch]);

  const setAnswer = useCallback(
    (qid: string, ans: unknown) => {
      setAnswers((p) => ({ ...p, [qid]: ans }));
      pending.current.set(qid, ans);
      setSave("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void drain();
      }, SAVE_DEBOUNCE_MS);
    },
    [drain],
  );
  const retry = useCallback(() => void drain(), [drain]);

  // 나가면(다른 항목·탭·뒤로 가기) 기다리던 답을 보낸다 — 보내던 저장이 끝난 뒤 차례로(같은 문항의 옛 답이 나중에 닿지 않게).
  // 보내던 저장이 실패해 줄에 다시 남은 답도 함께 한 번 더 보낸다. 응답은 화면이 없으니 버린다
  useEffect(() => {
    alive.current = true;
    const left = pending.current;
    const live = inflight;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void (async () => {
        if (live.current) await live.current.catch(() => false);
        for (const [qid, ans] of [...left]) {
          left.delete(qid);
          await saveExamAnswer(nodeId, qid, ans).catch(() => {});
        }
      })();
    };
  }, [nodeId]);

  /** 제출 — 남은 답을 먼저 저장하고, 저장이 실패하면 제출하지 않는다. 겹쳐 누르면 무시 */
  const busy = useRef(false);
  const submit = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setSubmitting(true);
    try {
      // 남은 답이 하나도 없을 때까지(보내는 사이 고른 답까지) 저장한 뒤에 제출한다
      while (pending.current.size > 0 || inflight.current) if (!(await drain())) return false;
      const view = await submitExam(nodeId);
      if (!alive.current) return true;
      ++seq.current; // 제출 전에 떠난 재조회 응답은 버린다
      viewRef.current = view;
      setGot({ nodeId, view, error: null });
      setAnswers(view.attempt?.answers ?? {});
      setSave("idle");
      return true;
    } catch (e) {
      const act = examErrorAction(toApiError(e));
      toastRef.current({ text: act.text, tone: "bad" });
      if (act.kind === "refetch") refetch();
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  }, [drain, nodeId, refetch]);

  const cur = got?.nodeId === nodeId ? got : null;
  const view = cur?.view ?? null;
  const answered = view?.questions ? answeredCount(view.questions, answers) : 0;
  return { view, error: cur?.error ?? null, loading: !cur, refetch, answers, setAnswer, answered, save, retry, submit, submitting };
}
