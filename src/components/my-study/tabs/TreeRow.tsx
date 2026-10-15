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
  /** 편집 모드 삭제 — 없으면 버튼을 비활성으로 두고 removeOff 를 안내한다 */
  onRemove?: () => void;
  removeOff?: string;
  /** 이 행의 삭제 확인이 열려 있다 */
  asking?: boolean;
  /** 편집 목록 드래그 핸들 포인터 이벤트 (과제·묶음 행만 — 회차는 끌 수 없다) */
  dragHandle?: React.HTMLAttributes<HTMLElement>;
  /** 이 행 위/아래에 놓을 자리 표시선 */
  dropHint?: "top" | "bottom" | null;
  /** 이 행을 끌고 있다 */
  dragging?: boolean;
};

const Trash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);

const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function TreeRow({ n, isEdit, open, onToggle, onClick, onAddChild, onRemove, removeOff, asking = false, dragHandle, dropHint = null, dragging = false }: Props) {
  // "+" 는 회차에만 — 과제 아래 과제(묶음)는 만들지 않는다 (2단계: 회차 → 과제)
  const canAdd = isEdit && !n.leaf && n.d === 0 && !n.archived;
  const addTip = `${n.title}에 과제 추가`;
  return (
    <div
      role="treeitem"
      aria-level={n.d + 2}
      aria-expanded={n.leaf ? undefined : open}
      aria-selected={isEdit ? false : undefined}
      data-node={n.id}
      className={`flex min-h-[52px] items-center gap-2 border-b border-line-2 py-1 pl-2 pr-3 ${dropHint === "top" ? "shadow-[inset_0_2px_0_#12A386]" : dropHint === "bottom" ? "shadow-[inset_0_-2px_0_#12A386]" : ""} ${dragging ? "opacity-50" : ""}`}
      style={{ background: n.d === 0 ? "#FAFCFB" : "#FFFFFF", opacity: n.archived ? 0.55 : 1 }}
    >
      {/* 390 폭에서도 제목·기간이 보이게: 들여쓰기 축소, 드래그 핸들·진척 막대·아바타는 숨기고 제목은 줄바꿈 (Q3-03) */}
      <span className="w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]" style={{ "--d": n.d } as React.CSSProperties} />
      {isEdit && (
        // 회차 행은 끌 수 없다 — 자리만 남겨 제목 세로줄을 맞춘다
        <span
          {...(n.d === 0 ? { "aria-hidden": true } : { ...dragHandle, title: "드래그해서 순서 변경·회차 이동" })}
          className={`flex shrink-0 text-ghost max-sm:hidden ${n.d === 0 ? "invisible" : "cursor-grab touch-none"}`}
        >
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

      {/* 행 본문 = 상세·편집 화면 열기(주 동작) — 누르는 자리 44px 이상. -my-1 로 행 py 를 덮어 52px 행 높이는 그대로 */}
      <button type="button" data-row-main onClick={onClick} className="-my-1 flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[2px] self-stretch bg-transparent px-1 py-3 text-left text-ink">
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
        <button type="button" title={addTip} aria-label={addTip} onClick={onAddChild} className="group -mx-[6px] -my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-transparent text-mint">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-3 bg-surface group-hover:border-mint">
            <Plus />
          </span>
        </button>
      )}
      {/* "+" 가 없는 행(과제·묶음·보관된 회차)은 같은 자리를 비워 두어 삭제 버튼이 회차 행과 같은 세로줄에 선다 */}
      {isEdit && !canAdd && <span aria-hidden="true" className="w-8 shrink-0" />}
      {isEdit && (
        // 누르는 자리는 44px(행 높이 52 안), 보이는 상자는 32px — "+" 와 같은 모양
        <button
          type="button"
          data-row-del
          disabled={!onRemove}
          title={onRemove ? `${n.title || "제목 없는 항목"} 삭제` : removeOff}
          aria-label={`${n.title || "제목 없는 항목"} 삭제`}
          aria-expanded={onRemove ? asking : undefined}
          onClick={onRemove}
          className="group -mx-[6px] -my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-transparent text-warn disabled:text-ghost"
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-[9px] border group-disabled:border-line group-disabled:bg-[#F4F6F7] ${asking ? "border-warn bg-[#FFF7F6]" : "border-line-3 bg-surface group-hover:border-warn"}`}>
            <Trash />
          </span>
        </button>
      )}
    </div>
  );
}
