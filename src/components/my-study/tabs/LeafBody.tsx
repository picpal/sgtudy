"use client";

import { MarkdownView } from "../MarkdownView";
import { emptyDescText } from "../submission";
import { ExamSection } from "./ExamSection";
import { NodeAttachments } from "./NodeAttachments";
import { SubmissionSection, type SubmissionSectionProps } from "./SubmissionSection";

/** 보기 상세 화면의 과제 본문 — 과제(설명 · 첨부) → 담당자별 제출 현황. 과제 제출 카드는 본문 카드 아래 형제 카드로(SubmitPanel 포털), 시험이면 시험 응시 카드(ExamSection) */
export function LeafBody(p: SubmissionSectionProps & { canRemoveFiles?: boolean; onExamUnsavedChange?: (unsaved: boolean) => void }) {
  const { canRemoveFiles = false, onExamUnsavedChange, ...sub } = p;
  const { n } = sub;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 시험은 파일을 올리지 않고, 답은 자동 저장이라 나가기 확인도 따로(onUnsavedChange)
  const { onUploadingChange, onDraftChange, ...exam } = sub;
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
