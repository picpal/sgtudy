"use client";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { AvatarStack, TypeBadge } from "../bits";
import { md } from "@/lib/date";
import type { TreeNode } from "../model";

type Props = {
  n: TreeNode;
  isEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onClick: () => void;
  onAddChild?: () => void;
};

const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function TreeRow({ n, isEdit, open, onToggle, onClick, onAddChild }: Props) {
  const canAdd = isEdit && !n.leaf && n.d <= 2;
  const cantAdd = isEdit && !n.leaf && n.d > 2;
  const addTip = n.d <= 2 ? `${n.title}에 하위 과제 추가` : "최대 5단계까지만 만들 수 있어요";
  return (
    <div
      role="treeitem"
      aria-level={n.d + 2}
      aria-expanded={n.leaf ? undefined : open}
      aria-selected={isEdit ? false : undefined}
      data-node={n.id}
      className="flex min-h-[52px] items-center gap-2 border-b border-line-2 py-1 pl-2 pr-3"
      style={{ background: n.d === 0 ? "#FAFCFB" : "#FFFFFF", opacity: n.archived ? 0.55 : 1 }}
    >
      {/* 390 폭에서도 제목·기간이 보이게: 들여쓰기 축소, 드래그 핸들·진척 막대·아바타는 숨기고 제목은 줄바꿈 (Q3-03) */}
      <span className="w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]" style={{ "--d": n.d } as React.CSSProperties} />
      {isEdit && (
        <span title="드래그해서 순서 변경" className="flex shrink-0 cursor-grab text-ghost max-sm:hidden">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
          </svg>
        </span>
      )}
      {n.leaf ? (
        <span className="flex w-[30px] shrink-0 justify-center">
          <span className="h-[6px] w-[6px] rounded-full bg-line-dash" />
        </span>
      ) : (
        <button type="button" aria-label={`${n.title} ${open ? "접기" : "펼치기"}`} aria-expanded={open} onClick={onToggle} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-transparent text-ink-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block transition-transform duration-150" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}>
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      )}

      <button type="button" data-row-main onClick={onClick} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[2px] bg-transparent px-1 py-2 text-left text-ink">
        {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{n.label}</span>}
        {n.leaf && <TypeBadge type={n.type} />}
        <span className="min-w-0 max-w-full [overflow-wrap:anywhere]" style={{ fontSize: n.d === 0 ? 15 : 14, fontWeight: n.d === 0 ? 700 : n.leaf ? 500 : 600 }}>
          {n.title}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">
          {md(n.s)} – {md(n.e)}
        </span>
        {n.archived && <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">보관됨</span>}
      </button>

      {n.leaf ? (
        <>
          <span className="max-sm:hidden">
            <AvatarStack people={n.people} size={28} ring="#FFFFFF" iconSize={14} overflowSize={30} />
          </span>
          {n.asg === 0 && <span className="shrink-0 rounded-[7px] bg-[#FDF4E1] px-2 py-[3px] text-[12px] font-semibold text-amber-text">담당자 미정</span>}
          <span className="w-9 shrink-0 text-right text-[12px] font-semibold text-ink-2">{n.asg ? `${n.sub}/${n.asg}` : ""}</span>
        </>
      ) : (
        <span className="flex w-[120px] shrink-0 items-center gap-2 max-sm:w-auto">
          <ProgressBar pct={n.pct} height={6} fill={n.pct === 100 ? "#1E9E6A" : "#12A386"} className="flex-1 max-sm:hidden" />
          <span className="w-9 text-right text-[12px] font-bold">{n.pct}%</span>
        </span>
      )}

      {canAdd && (
        // 누르는 자리는 44px, 보이는 상자는 32px
        <button type="button" title={addTip} aria-label={addTip} onClick={onAddChild} className="group -mx-[6px] flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-transparent text-mint">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-3 bg-surface group-hover:border-mint">
            <Plus />
          </span>
        </button>
      )}
      {cantAdd && (
        <button type="button" disabled title={addTip} aria-label={addTip} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line bg-[#F4F6F7] text-ghost">
          <Plus />
        </button>
      )}
    </div>
  );
}
