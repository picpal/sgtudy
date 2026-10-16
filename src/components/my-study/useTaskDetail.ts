"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError, type ApiError } from "@/lib/api/errors";
import { fetchTask } from "@/lib/api/submission";
import type { Submission, TaskDetail } from "@/lib/api/types";

type Got = { nodeId: string; detail: TaskDetail | null; error: ApiError | null };

/**
 * 과제 상세(task_get) — 노드가 바뀌면 새로 받고, 늦게 온 이전 응답은 버린다(요청 id 비교).
 * 재조회 중에는 이전 값을 그대로 보여 준다(스켈레톤으로 튀지 않게).
 */
export function useTaskDetail(slug: string, nodeId: string) {
  const [got, setGot] = useState<Got | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    fetchTask(slug, nodeId).then(
      (detail) => {
        if (id === seq.current) setGot({ nodeId, detail, error: null });
      },
      (e) => {
        if (id !== seq.current) return;
        // 재조회 실패면 받아 둔 값을 지키고 오류만 남긴다
        setGot((p) => ({ nodeId, detail: p?.nodeId === nodeId ? p.detail : null, error: toApiError(e) }));
      },
    );
  }, [slug, nodeId, tick]);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  /** 저장 응답(Submission)으로 내 제출만 바로 바꾼다 — 응답 확정값이라 낙관적 갱신이 아니다 (R4) */
  const setMine = useCallback((s: Submission) => setGot((p) => (p?.detail ? { ...p, detail: { ...p.detail, mySubmission: s } } : p)), []);
  const cur = got?.nodeId === nodeId ? got : null;
  return { detail: cur?.detail ?? null, error: cur?.error ?? null, loading: !cur, refetch, setMine };
}
