"use client";

import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ArchivedBadge, AvatarStack, TypeBadge } from "../bits";
import { md } from "@/lib/date";
import { CODE_CHIP, codeLabel, type TreeNode } from "../model";
import { isDone, ownerOf } from "../personal";
import type { RowMove } from "../rounds";
import { RowMenu } from "./RowMenu";

type Props = {
  n: TreeNode;
  isEdit: boolean;
  /** 개인 목표 행의 소유자 표시 — 내 것이면 표시 없음, 남의 것이면 아바타 + 이름 */
  meId?: string | null;
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
  /** 행 아래에 붙는 내용(삭제 확인 상자) — 같은 treeitem 안에 둬서 role="tree" 가 treeitem 만 소유하게 한다 */
  below?: React.ReactNode;
  /** 편집 목록 "⋯ 옮기기" 메뉴 (Q2-4, rowMoves) — 과제·묶음 행만. 비면 비활성 */
  moves?: RowMove[];
  onMoveRow?: (m: RowMove) => void;
  /** 옮기는 중 — 메뉴 비활성 */
  moveBusy?: boolean;
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


/** 행 클릭을 행 동작으로 넘기지 않는 것 — 자기 동작이 있는 컨트롤·메뉴·끌기 손잡이 (행 본문 버튼은 자기 onClick 으로 연다) */
const ROW_OWN = "button, a, input, select, textarea, [role=menu], [data-drag]";

export function TreeRow({ n, isEdit: isEditMode, meId = null, open, onToggle, onClick, onAddChild, onRemove, removeOff, asking = false, dragHandle, dropHint = null, dragging = false, below, moves, onMoveRow, moveBusy = false }: Props) {
  const personal = n.leaf && n.personal;
  // 개인 목표는 편집 모드에 그리지 않는다 — 혹시 그려져도 끌기·삭제 대상이 아니다
  const isEdit = isEditMode && !personal;
  const owner = personal ? ownerOf(n) : null;
  // 남의 개인 목표에만 소유자 표시 (결정 5 — 내 것에는 "나" 칩·아바타 없음)
  const other = personal && owner && owner.userId !== meId ? owner : null;
  const done = !!owner && isDone(owner.c);
  // "+" 는 회차에만 — 과제 아래 과제(묶음)는 만들지 않는다 (2단계: 회차 → 과제)
  const canAdd = isEdit && !n.leaf && n.d === 0 && !n.archived;
  const addTip = `${n.title}에 과제 추가`;
  const unassigned = n.leaf && !personal && n.asg === 0 && !n.archived;
  return (
    <div
      role="treeitem"
      aria-level={n.d + 2}
      aria-expanded={n.leaf ? undefined : open}
      aria-selected={isEdit ? false : undefined}
      data-node={n.id}
      className={`border-b border-line-2 ${dropHint === "top" ? "shadow-[inset_0_2px_0_#12A386]" : dropHint === "bottom" ? "shadow-[inset_0_-2px_0_#12A386]" : ""}`}
      data-personal={personal || undefined}
      style={{ background: n.d === 0 ? "#FAFCFB" : personal ? "var(--personal-bg)" : "#FFFFFF" }}
    >
      {/* 보이는 행(52px) — treeitem 은 이 행과 아래 확인 상자를 함께 감싼다.
          행 본문 버튼 밖의 배지·칸(개인 목표 상태, 담당 아바타·제출 수, 회차 진척률)을 눌러도 행 동작이 되게 클릭을 받는다.
          키보드는 행 본문 버튼이 맡는다(같은 동작) — 행의 다른 버튼·메뉴·끌기 손잡이는 자기 동작만 */}
      <div
        onClick={(e) => {
          if (!(e.target as Element).closest(ROW_OWN)) onClick();
        }}
        className={`flex min-h-[52px] cursor-pointer items-center gap-2 py-1 pl-2 pr-3 ${dragging ? "opacity-50" : ""}`}
        style={{ opacity: n.archived ? 0.55 : undefined }}
      >
        {/* 390 폭에서도 제목·기간이 보이게: 들여쓰기 축소, 드래그 핸들·진척 막대·아바타는 숨기고 제목은 줄바꿈 (Q3-03) */}
        <span className="w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]" style={{ "--d": n.d } as React.CSSProperties} />
        {isEdit && (
          // 회차 행은 끌 수 없다 — 자리만 남겨 제목 세로줄을 맞춘다
          <span
            data-drag
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
            <span className={`h-[6px] w-[6px] rounded-full ${personal ? "bg-personal-dot" : "bg-line-dash"}`} />
          </span>
        ) : (
          <button type="button" aria-label={`${n.title} ${open ? "접기" : "펼치기"}`} aria-expanded={open} onClick={onToggle} className="flex h-11 w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-transparent text-ink-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block transition-transform duration-150" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}

        {/* 행 본문 = 상세·편집 화면 열기(주 동작) — 누르는 자리 44px 이상. -my-1 로 행 py 를 덮어 52px 행 높이는 그대로 */}
        <button type="button" data-row-main onClick={onClick} className="-my-1 flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[2px] self-stretch bg-transparent px-1 py-3 text-left text-ink">
          {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{n.label}</span>}
          {n.leaf && <TypeBadge type={n.type} />}
          {/* 390: 소유자 이름 칸은 숨기고 남의 목표엔 제목 앞에 이니셜 아바타 (스펙 §4.4) */}
          {other && (
            <span className="shrink-0 sm:hidden" title={other.name}>
              <Avatar name={other.name} size={20} tone={other.tone} id={other.userId} />
              {/* 390 에선 이름 칸이 숨으니 스크린리더용 이름 */}
              <span className="sr-only">{other.name}</span>
            </span>
          )}
          <span className="min-w-0 max-w-full [overflow-wrap:anywhere]" style={{ fontSize: n.d === 0 ? 15 : 14, fontWeight: n.d === 0 ? 700 : n.leaf ? 500 : 600 }}>
            {n.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">
            {md(n.s)} – {md(n.e)}
          </span>
          {n.archived && <ArchivedBadge left={n.leaf && n.ownerLeft} />}
          {unassigned && <span className="shrink-0 rounded-[7px] bg-[#FDF4E1] px-2 py-[3px] text-[12px] font-semibold text-amber-text sm:hidden">담당자 미정</span>}
        </button>

        {personal ? (
          <>
            {other && (
              <span data-owner className="flex shrink-0 items-center gap-[6px] text-[12px] font-medium text-ink-3 max-sm:hidden">
                <Avatar name={other.name} size={20} tone={other.tone} id={other.userId} />
                {other.name}
              </span>
            )}
            {owner && (
              <span data-personal-status className={`shrink-0 whitespace-nowrap rounded-[8px] px-[10px] py-1 text-[12px] font-semibold ${CODE_CHIP[owner.c]}`}>
                {done && <span aria-hidden="true">✓ </span>}
                {codeLabel(n, owner.c)}
              </span>
            )}
          </>
        ) : n.leaf ? (
          <>
            <span className="max-sm:hidden">
              <AvatarStack people={n.people} size={28} ring="#FFFFFF" iconSize={14} overflowSize={30} />
            </span>
            {/* 보관된 과제는 배정할 일이 없어 빼고, 390 은 제목 칸을 지키려 행 본문 안(제목 아래 줄)으로 (Q2-10) */}
            {unassigned && <span className="shrink-0 rounded-[7px] bg-[#FDF4E1] px-2 py-[3px] text-[12px] font-semibold text-amber-text max-sm:hidden">담당자 미정</span>}
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
        {/* "+" 가 없는 행: 과제·묶음은 그 자리에 "⋯ 옮기기"(Q2-4), 보관된 회차는 비워 두어 삭제 버튼이 회차 행과 같은 세로줄에 선다 */}
        {isEdit && !canAdd && (n.d > 0 && moves && onMoveRow ? <RowMenu title={n.title} moves={moves} onMove={onMoveRow} disabled={moveBusy || n.temp} /> : <span aria-hidden="true" className="w-8 shrink-0" />)}
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
      {below}
    </div>
  );
}
