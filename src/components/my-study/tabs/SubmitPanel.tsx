"use client";

import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { StatusIcon } from "@/components/ui/StatusIcon";
import type { TaskStatus } from "@/lib/types";
import { useSubmitSlot } from "../submitSlot";

export const BADGE_TONE: Record<TaskStatus, string> = {
  done: "bg-[#E3F5EC] text-[#1A7F55]",
  late: "bg-amber-soft text-amber-text",
  missed: "bg-warn-soft text-[#B03A2E]",
  open: "bg-[#EEF3FF] text-navy",
  planned: "bg-slate-soft text-ink-3",
};

type Props = {
  /** 머리 h2 의 id — section 이 aria-labelledby 로 가리킨다 */
  id: string;
  title: string;
  /** 머리 아래 한 줄 — "여기서 제출해요 · 마감 10.18(일)" */
  sub?: string | null;
  icon: "submit" | "exam" | "results";
  badge?: { status: TaskStatus; text: string } | null;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
};

/** 과제 상세의 "내가 하는 곳" — 본문 카드(과제 · 제출 현황 · 댓글) 아래 형제 카드. 방 화면이 연 자리(submitSlot)로 포털해 그린다.
 *  React 트리는 그대로라 작성 상태·나가기 확인·포커스 ref 가 상세 화면과 함께 산다 */
export function SubmitPanel(props: Props) {
  return (
    <SubmitSlotPortal>
      <SlotCard {...props} />
    </SubmitSlotPortal>
  );
}

/** 자리(submitSlot)로 보내는 포털 — 여러 카드를 한 포털에 넣으면 그 순서가 그대로 자리 안 순서다 */
export function SubmitSlotPortal({ children }: { children?: ReactNode }) {
  const slot = useSubmitSlot();
  // 자리가 아직 붙기 전(null)에는 그리지 않는다 — 제자리에 그렸다 옮기면 작성 화면이 다시 마운트된다
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}

/** 자리 카드 한 장(포털 없이) — 「과제 제출」·「시험 응시」·「시험 결과」가 같은 머리(아이콘 · h2 · 한 줄 · 배지) */
export function SlotCard({ id, title, sub, icon, badge, headingRef, children }: Props) {
  // 표식: 결과 카드는 따로 — 「내가 하는 곳」(data-submit-panel)을 찾는 쪽이 결과 카드를 집지 않게
  const mark = icon === "results" ? { "data-results-panel": "" } : { "data-submit-panel": "" };
  return (
    <section aria-labelledby={id} {...mark} className="flex min-w-0 flex-col gap-5 rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[901px]:px-4 max-sm:pb-7 max-sm:pt-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-mint-soft text-mint">
          {icon === "submit" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="M7 9l5-5 5 5" />
              <path d="M5 20h14" />
            </svg>
          ) : icon === "results" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 20V12" />
              <path d="M12 20V5" />
              <path d="M19 20v-5" />
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
          <h2 id={id} ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-4 text-[18px] font-bold text-ink outline-none">
            {title}
          </h2>
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
