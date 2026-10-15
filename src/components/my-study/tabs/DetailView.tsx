"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { md, weekdayKo } from "@/lib/date";
import { useToday } from "@/lib/today";
import { MarkdownView } from "../MarkdownView";
import { TypeBadge } from "../bits";
import { roundStatus, type TreeNode } from "../model";
import { ChildList } from "./ChildList";
import { LeafBody } from "./LeafBody";

type Props = { n: TreeNode; nodes: TreeNode[]; canEdit: boolean; onOpen: (id: string) => void; onBack: () => void; onEdit: () => void };

/** 보기 모드 상세 — 목록 자리를 쓰는 읽기 전용 화면 (?tab=curriculum&item=). 회차는 기간·진척·설명·과제 목록, 과제는 설명·담당자별 상태 */
export function DetailView({ n, nodes, canEdit, onOpen, onBack, onEdit }: Props) {
  const today = useToday();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const el = heading.current?.closest("section");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [n.id]);
  // 경로 조각: 회차(·묶음) — 누르면 그 상세로
  const ancestors: TreeNode[] = [];
  for (let p = nodes.find((x) => x.id === n.parentId); p; p = nodes.find((x) => x.id === p!.parentId)) ancestors.unshift(p);
  const kind = n.leaf ? "과제" : n.d === 0 ? "회차" : "묶음";
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) onBack();
  };
  return (
    <section aria-labelledby="detail-title" onKeyDown={onKey} className="flex flex-col">
      <div className="sticky top-0 z-[2] -mx-1 flex flex-wrap items-center gap-2 border-b border-line-2 bg-surface px-1 py-3">
        <button type="button" onClick={onBack} className="inline-flex h-11 shrink-0 items-center gap-[6px] rounded-[22px] border border-line-3 bg-surface pl-3 pr-4 text-[14px] font-semibold text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          진행목표
        </button>
        <nav aria-label="경로" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-[13px] text-muted">
          {ancestors.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1">
              <button type="button" onClick={() => onOpen(a.id)} className="inline-flex min-h-11 items-center rounded-[8px] px-1 font-medium text-ink-2 underline-offset-2 hover:underline">
                {a.d === 0 && !a.leaf && a.label ? `${a.label} ${a.title}` : a.title}
              </button>
              <span aria-hidden="true">›</span>
            </span>
          ))}
          <span>{kind}</span>
        </nav>
        {canEdit && (
          <button type="button" onClick={onEdit} className="h-11 shrink-0 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white">
            편집
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{n.label}</span>}
          {n.leaf && <TypeBadge type={n.type} />}
          <h2 id="detail-title" ref={heading} tabIndex={-1} className="m-0 min-w-0 text-[20px] font-bold text-ink outline-none [overflow-wrap:anywhere]">
            {n.title}
          </h2>
          {n.archived && <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">보관됨</span>}
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          {md(n.s)}({weekdayKo(n.s)}) – {md(n.e)}({weekdayKo(n.e)}) · {roundStatus(n, today)}
        </p>
        {n.leaf ? (
          <LeafBody n={n} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ProgressBar pct={n.pct} height={8} fill={n.pct === 100 ? "#1E9E6A" : "#12A386"} className="max-w-[320px] flex-1" />
              <span className="text-[13px] text-ink-2">
                <b className="font-bold text-ink">{n.pct}%</b> · 제출 {n.sub}/{n.asg}
              </span>
            </div>
            {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{kind} 설명이 아직 없어요</p>}
            <ChildList parent={n} onOpen={onOpen} />
          </>
        )}
      </div>
    </section>
  );
}
