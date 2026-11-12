"use client";

import { emptyDescText } from "../submission";
import { ExamSection } from "./ExamSection";
import { NodeDescription } from "./NodeDescription";
import { SubmissionSection, type SubmissionSectionProps } from "./SubmissionSection";

/** 제출·시험 카드는 본문 카드 안이 아니라 아래 형제 카드로 그린다(SubmitPanel 포털) */
export function LeafBody(p: SubmissionSectionProps & { canRemoveFiles?: boolean; onExamUnsavedChange?: (unsaved: boolean) => void }) {
  const { canRemoveFiles = false, onExamUnsavedChange, ...sub } = p;
  const { n } = sub;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 시험은 파일을 올리지 않고, 답은 자동 저장이라 나가기 확인도 따로(onUnsavedChange)
  const { onUploadingChange, onDraftChange, ...exam } = sub;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <NodeDescription nodeId={n.id} desc={n.desc} emptyText={emptyDescText(n.personal)} canRemove={canRemoveFiles} toast={p.toast} />
      </div>
      {n.exam ? <ExamSection {...exam} onUnsavedChange={onExamUnsavedChange} /> : <SubmissionSection {...sub} />}
    </div>
  );
}
