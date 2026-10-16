"use client";

import { useState, type Ref } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import type { FileMeta } from "@/lib/api/types";
import { ArchivedBadge } from "../bits";
import { rowStatusText, stampKst, statusHeadOf, type StatusRow } from "../submission";
import { SubmissionView } from "./SubmissionView";

type Props = {
  rows: StatusRow[];
  sub: number;
  asg: number;
  note: string | null;
  archived?: boolean;
  /** 개인 목표 — 머리에 개수 없이, 상태는 codeLabel 문구, 보관이면 소유자 한 줄 + "보관됨" */
  personal?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onOpenFile: (f: FileMeta) => void;
};

/** 담당자별 제출 현황 (스펙 §2.4). 펼침은 task_get.submissions 에 있는 줄만 — 트리 people 로 제출물을 추측하지 않는다 */
export function SubmissionStatusList({ rows, sub, asg, note, archived = false, personal = false, headingRef, onOpenFile }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <section aria-labelledby="sub-status-title" className="flex flex-col gap-2">
      <h3 id="sub-status-title" ref={headingRef} tabIndex={-1} className="m-0 scroll-mt-20 text-[15px] font-bold text-ink outline-none">
        {statusHeadOf(personal, sub, asg)}
      </h3>
      {note && <p className="m-0 text-[13px] text-muted">{note}</p>}
      {/* 보관 과제는 배정이 풀려 0명 — "담당자가 없어요" 는 틀린 안내 */}
      {rows.length === 0 && asg === 0 && !archived && <p className="m-0 text-[13px] text-amber-text">아직 담당자가 없어요</p>}
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
          {rows.map((r) => {
            // 내 줄은 위 카드에 있어 펼치지 않는다
            const canOpen = !!r.submission && !r.me;
            const isOpen = canOpen && open.has(r.userId);
            const label = rowStatusText(r.status, personal, archived);
            const line = (
              <>
                <Avatar name={r.name} size={30} tone={r.tone} id={r.userId} className="shrink-0" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px]">
                  <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">
                    {r.name}
                    {r.me ? " (나)" : ""}
                  </span>
                  {label && (
                    <span className="inline-flex items-center gap-1 text-[13px] text-ink-2">
                      <StatusIcon status={r.status} label={false} />
                      {label}
                    </span>
                  )}
                  {personal && archived && <ArchivedBadge />}
                  {r.submission && <span className="text-[12px] text-muted">{stampKst(r.submission.firstSubmittedAt)}</span>}
                  {/* 개인 목표는 상태 문구("늦게 완료")가 이미 말한다 */}
                  {r.submission?.isLate && !personal && <span className="rounded-[6px] bg-amber-soft px-[6px] py-[1px] text-[11px] font-bold text-amber-text">지각</span>}
                  {r.released && <span className="rounded-[6px] bg-slate-soft px-[6px] py-[1px] text-[11px] font-bold text-ink-3">담당 제외</span>}
                </span>
              </>
            );
            return (
              <li key={r.userId} className="border-b border-line-2 last:border-b-0">
                {canOpen ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`sub-${r.userId}`}
                    aria-label={`${r.name} 제출물 ${isOpen ? "접기" : "펼치기"}`}
                    onClick={() => toggle(r.userId)}
                    className="flex min-h-11 w-full items-center gap-2 bg-surface px-3 py-2 text-left hover:bg-surface-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {line}
                  </button>
                ) : (
                  <div className={`flex min-h-11 items-center gap-2 px-3 py-2 ${r.me ? "bg-[#EEF3FF]" : "bg-surface"}`}>
                    <span className="w-[14px] shrink-0" aria-hidden="true" />
                    {line}
                  </div>
                )}
                {isOpen && r.submission && (
                  <div id={`sub-${r.userId}`} className="border-t border-line-2 bg-surface-3 px-4 pb-5 pt-3">
                    <SubmissionView s={r.submission} onOpenFile={onOpenFile} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
