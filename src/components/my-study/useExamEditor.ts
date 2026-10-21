"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { fetchExam, publishExam, putExam, toDraft, validateDraft, type ExamDraft } from "@/lib/api/exam";
import type { ExamView } from "@/lib/api/types";
import { EMPTY_DRAFT, draftDirty, draftReduce, examErrorAction, lockText, lockTextStarted, type DraftAction } from "./exam";

/** 저장 거절·클라이언트 검사로 표시할 칸 — index -1 = 시험 전체(문항 수) */
export type ExamFieldErr = { index: number; field: string; message: string };

const at = (e: ExamFieldErr) => (e.index < 0 ? e.message : `${e.index + 1}번 문항 · ${e.message}`);

/**
 * 출제 화면 상태(스펙 §4.2) — exam_get → 초안(toDraft) → draftReduce 로 고치고 [문제 저장] = exam_put 한 번.
 * base = 마지막으로 서버에서 받은 초안, dirty = 지금 초안이 base 와 다르다(미저장 가드 S.examDirty 의 근원).
 * onChanged: 저장·발행이 성공하면(트리의 시험 요약·배지를 다시 받게) 부른다
 */
export function useExamEditor(slug: string, nodeId: string, toast: (m: ToastMsg) => void, onChanged?: () => void) {
  const [view, setView] = useState<ExamView | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [base, setBase] = useState<ExamDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<ExamDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [fieldErr, setFieldErr] = useState<ExamFieldErr | null>(null);
  // 같은 틱의 두 번째 클릭도 막는 동기 표시 + await 뒤에 읽는 지금 초안
  const busy = useRef(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const toastRef = useRef(toast);
  const changedRef = useRef(onChanged);
  useEffect(() => {
    toastRef.current = toast;
    changedRef.current = onChanged;
  });

  /** 서버 응답으로 바꾼다. sent = 보낸 초안 — 그 사이 또 고쳤으면 고친 초안은 남긴다(저장 버튼이 다시 켜진다) */
  const applyView = useCallback((v: ExamView, sent?: ExamDraft) => {
    const next = toDraft(v);
    setView(v);
    setBase(next);
    setDraft((cur) => (sent === undefined || cur === sent ? next : cur));
    setLoadErr(false);
  }, []);

  const reload = useCallback(
    () =>
      fetchExam(slug, nodeId).then(
        (v) => {
          applyView(v);
          setFieldErr(null);
        },
        (e) => {
          setLoadErr(true);
          toastRef.current({ text: toApiError(e).message || "시험을 불러오지 못했어요 · 새로 고침해 주세요", tone: "bad" });
        },
      ),
    [slug, nodeId, applyView],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const locked = !!view?.exam.locked;
  const lockNote = !locked ? null : (view?.exam.submittedCount ?? 0) > 0 ? lockText(view!.exam.submittedCount!) : lockTextStarted;
  const dirty = draftDirty(draft, base);

  const dispatch = useCallback(
    (a: DraftAction) => {
      setFieldErr(null);
      setDraft((d) => draftReduce(d, locked, a));
    },
    [locked],
  );

  /** exam_* 실패 → 화면 동작. 상태가 바뀐 코드(잠김·발행 취소 등)는 다시 받아 초안을 서버 것으로 맞춘다 */
  const fail = useCallback(
    async (e: unknown) => {
      const act = examErrorAction(toApiError(e));
      toastRef.current({ text: act.text, tone: "bad" });
      if (act.kind === "refetch") await reload();
      else if (act.kind === "field") setFieldErr({ index: act.index ?? -1, field: act.field, message: act.text });
    },
    [reload],
  );

  /** [문제 저장] — 클라이언트 검사 뒤 exam_put. 성공이면 true (바뀐 게 없으면 보내지 않고 true) */
  const save = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    const sent = draftRef.current;
    if (!draftDirty(sent, base)) return true;
    const bad = validateDraft(sent);
    if (bad) {
      setFieldErr(bad);
      toastRef.current({ text: at(bad), tone: "bad" });
      return false;
    }
    busy.current = true;
    setSaving(true);
    try {
      applyView(await putExam(slug, nodeId, sent), sent);
      setFieldErr(null);
      changedRef.current?.();
      return true;
    } catch (e) {
      await fail(e);
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [base, slug, nodeId, applyView, fail]);

  /** [발행]·[초안으로]. 발행 전 고친 문항이 있으면 먼저 저장한다(저장한 문항으로 발행된다) */
  const publish = useCallback(
    async (on: boolean): Promise<boolean> => {
      if (busy.current) return false;
      if (on && draftDirty(draftRef.current, base) && !(await save())) return false;
      busy.current = true;
      setPublishing(true);
      try {
        // 발행은 문항을 바꾸지 않는다 — 초안은 그대로 둔다(초안으로 되돌리기 전에 고친 문항이 있어도 버리지 않게)
        const v = await publishExam(slug, nodeId, on);
        setView(v);
        setBase(toDraft(v));
        toastRef.current({ text: on ? "발행했어요 · 팀원에게 알림을 보냈어요" : "초안으로 되돌렸어요 · 팀원에게는 다시 보이지 않아요", tone: "ok" });
        changedRef.current?.();
        return true;
      } catch (e) {
        await fail(e);
        return false;
      } finally {
        busy.current = false;
        setPublishing(false);
      }
    },
    [base, save, slug, nodeId, fail],
  );

  /** 저장하지 않은 문항 수정을 버린다(떠나기 확인의 "버리기") */
  const discard = useCallback(() => {
    setDraft(base);
    setFieldErr(null);
  }, [base]);

  /** 초안을 통째로 바꾼다 — AI 탭의 JSON 가져오기 등(Task 8). 잠겼으면 바꾸지 않고 false */
  const replace = useCallback(
    (d: ExamDraft): boolean => {
      if (locked) return false;
      setFieldErr(null);
      setDraft(d);
      return true;
    },
    [locked],
  );

  return { view, loadErr, draft, base, dirty, locked, lockNote, saving, publishing, fieldErr, dispatch, save, publish, discard, replace, reload, applyView };
}

export type ExamEditorApi = ReturnType<typeof useExamEditor>;
