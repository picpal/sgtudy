"use client";

import { MarkdownView } from "../MarkdownView";
import { SubmissionSection, type SubmissionSectionProps } from "./SubmissionSection";

/** 보기 상세 화면의 과제 본문 — 설명 + 제출(내 제출 카드 · 담당자별 제출 현황) */
export function LeafBody(p: SubmissionSectionProps) {
  const { n } = p;
  return (
    <div className="flex flex-col gap-5">
      {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">과제 설명이 아직 없어요</p>}
      <SubmissionSection {...p} />
    </div>
  );
}
