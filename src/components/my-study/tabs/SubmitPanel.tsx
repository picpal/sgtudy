"use client";

import type { ReactNode, Ref } from "react";
import { StatusIcon } from "@/components/ui/StatusIcon";
import type { TaskStatus } from "@/lib/types";

export const BADGE_TONE: Record<TaskStatus, string> = {
  done: "bg-[#E3F5EC] text-[#1A7F55]",
  late: "bg-amber-soft text-amber-text",
  missed: "bg-warn-soft text-[#B03A2E]",
  open: "bg-[#EEF3FF] text-navy",
  planned: "bg-slate-soft text-ink-3",
};

type Props = {
  /** 머리 h3 의 id — section 이 aria-labelledby 로 가리킨다 */
  id: string;
  title: string;
  /** 머리 아래 한 줄 — "여기서 제출해요 · 마감 10.18(일)" */
  sub?: string | null;
  icon: "submit" | "exam";
  badge?: { status: TaskStatus; text: string } | null;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
};

/** 과제 상세의 "내가 하는 곳" — 위 과제 설명(평면)과 나뉘는 옅은 면. 카드 안 카드를 만들지 않도록 테두리 없이 면 색으로만 구분 */
export function SubmitPanel({ id, title, sub, icon, badge, headingRef, children }: Props) {
  return (
    <section aria-labelledby={id} data-submit-panel className="flex min-w-0 flex-col gap-4 rounded-[16px] bg-bg-main px-3 py-4 @[560px]:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-mint-soft text-mint">
          {icon === "submit" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="M7 9l5-5 5 5" />
              <path d="M5 20h14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4h6v3H9z" />
              <path d="M7 5H5v16h14V5h-2" />
              <path d="M9 13l2 2 4-4" />
            </svg>
          )}
        </span>
        <div className="flex min-w-0 flex-[1_1_160px] flex-col">
          <h3 id={id} ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-20 text-[16px] font-bold text-ink outline-none">
            {title}
          </h3>
          {sub && <p className="m-0 text-[12px] text-muted">{sub}</p>}
        </div>
        {badge && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-[3px] text-[12px] font-bold ${BADGE_TONE[badge.status]}`}>
            <StatusIcon status={badge.status} size={13} label={false} />
            {badge.text}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
