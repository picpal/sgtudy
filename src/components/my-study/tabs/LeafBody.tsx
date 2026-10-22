"use client";

import { MarkdownView } from "../MarkdownView";
import { emptyDescText } from "../submission";
import { ExamSection } from "./ExamSection";
import { NodeAttachments } from "./NodeAttachments";
import { SubmissionSection, type SubmissionSectionProps } from "./SubmissionSection";

/** 보기 상세 화면의 과제 본문 — 위: 과제(설명 · 첨부, 평면) / 아래: 내 제출 면 → 담당자별 제출 현황. 시험 리프면 제출 대신 내 응시 면(ExamSection) */
export function LeafBody(p: SubmissionSectionProps & { canRemoveFiles?: boolean; onExamUnsavedChange?: (unsaved: boolean) => void }) {
  const { canRemoveFiles = false, onExamUnsavedChange, ...sub } = p;
  const { n } = sub;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 시험은 파일을 올리지 않는다
  const { onUploadingChange, ...exam } = sub;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{emptyDescText(n.personal)}</p>}
        <NodeAttachments nodeId={n.id} canRemove={canRemoveFiles} toast={p.toast} />
      </div>
      {n.exam ? <ExamSection {...exam} onUnsavedChange={onExamUnsavedChange} /> : <SubmissionSection {...sub} />}
    </div>
  );
}
