"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { StatusIcon } from "@/components/ui/StatusIcon";
import type { ToastMsg } from "@/components/ui/Toast";
import type { FileMeta, Submission, TaskDetail } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { metaLine, type MyCardState } from "../submission";
import { useSubmissionComposer } from "../useSubmissionComposer";
import { DraftNotice, SubmissionComposer } from "./SubmissionComposer";
import { SubmissionView } from "./SubmissionView";

const BADGE_TONE: Record<TaskStatus, string> = {
  done: "bg-[#E3F5EC] text-[#1A7F55]",
  late: "bg-amber-soft text-amber-text",
  missed: "bg-warn-soft text-[#B03A2E]",
  open: "bg-[#EEF3FF] text-navy",
  planned: "bg-slate-soft text-ink-3",
};

type ViewProps = {
  state: Exclude<MyCardState, { kind: "hidden" }>;
  badge: { status: TaskStatus; text: string };
  mine: Submission | null;
  /** 작성 화면 슬롯 — 있으면 본문 자리에 그린다 */
  composer: ReactNode;
  /** 카드 머리 아래 안내(이어 쓰기 등) */
  notice?: ReactNode;
  onEdit: () => void;
  onOpenFile: (f: FileMeta) => void;
  headingRef?: Ref<HTMLHeadingElement>;
};

/** 내 제출 카드 표시 (훅 없음) — 스펙 §2.2 */
export function MySubmissionCardView({ state, badge, mine, composer, notice, onEdit, onOpenFile, headingRef }: ViewProps) {
  const saved = mine && (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12px] text-muted">
        {metaLine(mine)}
        {mine.isLate && <span className="block text-amber-text">마감 뒤에 처음 제출해 지각으로 기록됐어요</span>}
      </p>
      <SubmissionView s={mine} onOpenFile={onOpenFile} />
    </div>
  );
  let body: ReactNode;
  if (composer) body = composer;
  else if (state.kind === "blocked") body = <p className="m-0 text-[13px] text-ink-2">{state.note}</p>;
  else if (state.kind === "readonly")
    body = (
      <>
        <p className="m-0 rounded-[10px] bg-slate-soft px-3 py-2 text-[13px] text-ink-2">{state.note}</p>
        {saved}
      </>
    );
  else if (state.kind === "submitted")
    body = (
      <>
        {saved}
        <div className="flex justify-end">
          <button type="button" onClick={onEdit} className="h-11 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
            수정하기
          </button>
        </div>
      </>
    );
  return (
    <section aria-labelledby="my-sub-title" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[14px] @[560px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="my-sub-title" ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-20 text-[15px] font-bold text-ink outline-none">
          내 제출
        </h3>
        <span className={`inline-flex items-center gap-1 rounded-[8px] px-2 py-[3px] text-[12px] font-bold ${BADGE_TONE[badge.status]}`}>
          <StatusIcon status={badge.status} size={13} label={false} />
          {badge.text}
        </span>
      </div>
      {notice}
      {body}
    </section>
  );
}

type Props = {
  detail: TaskDetail;
  nodeId: string;
  userId: string;
  state: Exclude<MyCardState, { kind: "hidden" }>;
  badge: { status: TaskStatus; text: string };
  onSaved: (s: Submission) => void;
  onRefetch: () => void;
  onOpenFile: (f: FileMeta) => void;
  toast: (m: ToastMsg) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** 파일을 올리는 중인지 — 상세 나가기 확인용 (스펙 §2.8) */
  onUploadingChange?: (uploading: boolean) => void;
};

/** 내 제출 카드 — 작성 가능(compose/submitted)일 때만 작성 훅을 쓴다 */
export function MySubmissionCard(p: Props) {
  if (p.state.kind === "compose" || p.state.kind === "submitted") return <EditableCard {...p} />;
  return <MySubmissionCardView state={p.state} badge={p.badge} mine={p.detail.mySubmission} composer={null} onEdit={() => {}} onOpenFile={p.onOpenFile} headingRef={p.headingRef} />;
}

function EditableCard({ detail, nodeId, userId, state, badge, onSaved, onRefetch, onOpenFile, toast, headingRef, onUploadingChange }: Props) {
  const [editing, setEditing] = useState(false);
  const c = useSubmissionComposer({
    nodeId,
    userId,
    detail,
    onSaved: (s) => {
      setEditing(false);
      onSaved(s);
    },
    onRefetch,
    toast,
  });
  useEffect(() => {
    onUploadingChange?.(c.uploading);
  }, [c.uploading, onUploadingChange]);
  useEffect(() => () => onUploadingChange?.(false), [onUploadingChange]);
  const mine = detail.mySubmission;
  // 제출 전이면 작성 화면이 바로 열린다. 제출 뒤에는 [수정하기] 또는 남은 임시본 [이어 쓰기]
  const composing = state.kind === "compose" || editing;
  const late = detail.today > detail.node.endDate;
  const edit = () => {
    c.reset();
    setEditing(true);
  };
  const composer = composing ? (
    <SubmissionComposer
      c={c}
      editing={!!mine}
      late={late}
      onCancel={() => {
        c.cancel();
        setEditing(false);
      }}
    />
  ) : null;
  // 제출물 보기 위 이어 쓰기 안내 — 고르면 작성 화면으로
  const notice =
    !composing && c.pending ? (
      <DraftNotice
        at={c.pending.at}
        onResume={() => {
          c.resume();
          setEditing(true);
        }}
        onDrop={c.dropDraft}
      />
    ) : null;
  return <MySubmissionCardView state={state} badge={badge} mine={mine} composer={composer} notice={notice} onEdit={edit} onOpenFile={onOpenFile} headingRef={headingRef} />;
}
