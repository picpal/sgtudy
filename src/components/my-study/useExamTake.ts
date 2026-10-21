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
 * 화면에 보이는 답 = 서버 답 위에 아직 보내지 않은 답을 덮은 것. 나갈 때(언마운트) 남은 답은 바로 보낸다.
 */
export function useExamTake(slug: string, nodeId: string, toast: (m: ToastMsg) => void) {
  const [got, setGot] = useState<Got | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [save, setSave] = useState<ExamSaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(new Map<string, unknown>());
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
        setGot({ nodeId, view, error: null });
        // 받은 답 위에 아직 못 보낸 답을 덮는다(재조회가 고르던 답을 지우지 않게)
        setAnswers({ ...(view.attempt?.answers ?? {}), ...Object.fromEntries(pending.current) });
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
      if (act.kind === "refetch") {
        pending.current.clear();
        setSave("idle");
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
        try {
          answered = (await saveExamAnswer(nodeId, qid, ans)).answered;
        } catch (e) {
          // 그사이 같은 문항을 다시 고르지 않았으면 실패한 답을 다시 보낼 줄에 남긴다
          if (!pending.current.has(qid)) pending.current.set(qid, ans);
          if (alive.current) fail(e);
          return false;
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

  // 나가면(다른 항목·탭·뒤로 가기) 기다리던 답을 바로 보낸다 — 응답은 화면이 없으니 버린다
  useEffect(() => {
    alive.current = true;
    const left = pending.current;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      for (const [qid, ans] of left) void saveExamAnswer(nodeId, qid, ans).catch(() => {});
      left.clear();
    };
  }, [nodeId]);

  /** 제출 — 남은 답을 먼저 저장하고, 저장이 실패하면 제출하지 않는다. 겹쳐 누르면 무시 */
  const busy = useRef(false);
  const submit = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setSubmitting(true);
    try {
      if (!(await drain())) return false;
      const view = await submitExam(nodeId);
      if (!alive.current) return true;
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
