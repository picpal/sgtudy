"use client";

import { StatusIcon } from "@/components/ui/StatusIcon";
import { diffDays, md, weekdayKo } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { AvatarStack, Seg, TypeBadge } from "../bits";
import { CODE_COLOR, CODE_STATUS, boardColumn, codeLabel, ddayLabel, myCode, type BoardCol, type LeafNode, type Tree } from "../model";
import { roundLabel } from "../rounds";
import { boardSource } from "../sources";
import type { BoardMode, ScreenState, Update } from "../state";

/**
 * 보드 회차 필터 선택지 — 회차가 20개쯤 되면 칩이 여러 줄로 쌓여 칸반을 밀어내서 select 하나로 바꿨다.
 * 글은 roundLabel("1주차 · 제목 (10/1 – 10/7)"), 오늘이 든 회차는 "· 이번 회차", 보관된 회차는 "· 보관됨".
 */
export function boardRoundOptions(roots: Tree["roots"], today: string): [string, string][] {
  return [
    ["all", "전체 회차"],
    ...roots.map((r): [string, string] => {
      const tag = r.archived ? " · 보관됨" : r.s <= today && today <= r.e ? " · 이번 회차" : "";
      return [r.id, `${roundLabel(r)}${tag}`];
    }),
  ];
}

type Props = { tree: Tree; S: ScreenState; update: Update; goLeaf: (id: string) => void };

export function BoardTab({ tree, S, update, goLeaf }: Props) {
  const today = useToday();
  const meId = useMe()?.id ?? null;
  const mine = S.bMode === "mine";
  const rounds = boardRoundOptions(tree.roots, today);
  // 고른 회차가 사라졌으면(삭제 등) 전체로 — select 에 보이는 값과 거르는 값을 맞춘다
  const bRound = rounds.some(([id]) => id === S.bRound) ? S.bRound : "all";
  const inRound = (l: LeafNode) => bRound === "all" || l.roundId === bRound;
  const src = boardSource(tree, mine, meId)
    .filter(inRound)
    .sort((a, b) => a.e.localeCompare(b.e));
  const noMine = mine && boardSource(tree, true, meId).length === 0;
  const cols: [BoardCol, string, string][] = [
    ["todo", "예정", "#8C97A4"],
    ["doing", "진행중", "#12A386"],
    ["done", mine ? "제출 완료" : "전원 제출", "#1E9E6A"],
  ];

  return (
    <div className="mt-[18px] flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-[10px]">
        <Seg<BoardMode> label="칸반 범위" value={S.bMode} onChange={(m) => update({ bMode: m })} options={[["mine", "내 칸반"], ["team", "팀 칸반"]]} />
        <span className="flex-[1_1_20px]" />
        {/* 좁은 폭: 상자 44px 가 한 줄을 다 쓴다. sm 이상: 상자는 옆 칸반 세그(40px)와 같은 높이, select 는 44px 로 상자 위아래로
            보이지 않게 2px 씩 넘쳐 누르는 영역을 지킨다(HIT_Y 와 같은 방식 — select 는 ::before 를 못 그린다). 긴 회차 글은 truncate(text-overflow: ellipsis) */}
        <label className="inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-[12px] border border-line-3 bg-surface pl-3 text-[13px] font-medium text-ink-2 max-sm:w-full sm:h-10 sm:max-w-[360px]">
          <span className="shrink-0">회차</span>
          <select
            aria-label="회차 필터"
            value={bRound}
            onChange={(e) => update({ bRound: e.target.value })}
            className="h-11 min-w-0 flex-1 cursor-pointer truncate rounded-r-[12px] border-0 bg-transparent pr-2 text-[13px] font-semibold text-ink"
          >
            {rounds.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="m-0 text-[12px] text-muted">
        {mine ? "내가 담당한 과제만 보여요. 제출 상태에 따라 칸이 자동으로 바뀌어요 · 카드를 누르면 진행목표에서 상세를 볼 수 있어요." : "모든 과제의 팀 진행 상황이에요. 담당자 전원이 제출하면 ‘전원 제출’로 이동해요."}
      </p>
      {noMine && <div className="rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">아직 내게 배정된 과제가 없어요. 참가가 확정되면 여기에 보여요.</div>}

      <div className="grid items-start gap-[14px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {cols.map(([id, label, dot]) => {
          const cards = src.filter((l) => boardColumn(l, mine, meId) === id);
          return (
            <section key={id} aria-label={label} className="flex min-h-[180px] flex-col gap-[10px] rounded-[16px] bg-[#F4F7F6] p-3">
              <h3 className="mx-1 my-[2px] flex items-center gap-2 text-[14px] font-bold">
                <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />
                {label}
                <span className="rounded-[10px] bg-[#E3E9E7] px-2 py-px text-[12px] font-semibold text-ink-3">{cards.length}</span>
              </h3>
              {cards.map((l) => (
                <Card key={l.id} l={l} mine={mine} today={today} meId={meId} onOpen={() => goLeaf(l.id)} />
              ))}
              {cards.length === 0 && <p className="mx-1 my-[6px] text-[12px] text-faint">해당하는 과제가 없어요</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ l, mine, today, meId, onOpen }: { l: LeafNode; mine: boolean; today: string; meId: string | null; onOpen: () => void }) {
  const c = myCode(l, meId);
  const finished = mine ? c === "D" || c === "L" : l.state === "complete";
  const overdue = mine ? c === "M" : l.state === "delayed";
  const left = diffDays(today, l.e);
  const hot = overdue || (left >= 0 && left <= 2);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col items-stretch gap-[6px] rounded-[14px] border p-[14px] text-left text-ink transition-[box-shadow,border-color] duration-150 hover:border-line-dash hover:shadow-[0_6px_16px_rgba(27,34,48,.08)]"
      style={{ borderColor: overdue ? "#E7A9A3" : l.personal ? "var(--personal-edge)" : "#E4ECEA", background: overdue ? "#FFF6F5" : l.personal ? "var(--personal-bg)" : "#FFFFFF" }}
    >
      <span className="flex flex-wrap items-center gap-[6px]">
        <TypeBadge type={l.type} />
        {!mine && l.state === "complete" && (
          <span className="inline-flex items-center gap-[3px] rounded-[6px] bg-done px-[7px] py-[2px] text-[11px] font-bold text-white">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            완료
          </span>
        )}
        <span className="flex-1" />
        {!finished && (
          <span className="shrink-0 rounded-[7px] px-2 py-[3px] text-[11px] font-bold" style={{ color: hot ? "#FFFFFF" : "#3A4452", background: hot ? "#B4462B" : "#E9EEF0" }}>
            {overdue ? "기한 지남" : ddayLabel(today, l.e)}
          </span>
        )}
      </span>
      <span className="text-[14px] font-semibold leading-[1.4] text-ink">{l.title}</span>
      <span className="text-[12px] text-muted">{l.crumb}</span>
      <span className="flex items-center gap-[5px] text-[12px] text-ink-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {md(l.e)}({weekdayKo(l.e)}) 마감
      </span>
      {mine && c ? (
        <span className="mt-[2px] flex items-center gap-[6px] border-t border-line-2 pt-2">
          <StatusIcon status={CODE_STATUS[c]} size={15} label={false} />
          <span className="text-[12px] font-semibold" style={{ color: CODE_COLOR[c] }}>
            {l.personal ? codeLabel(l, c) : c === "M" ? "미제출 · 기한이 지났어요" : `내 상태 · ${codeLabel(l, c)}`}
          </span>
        </span>
      ) : (
        <span className="mt-[2px] flex items-center gap-[10px] border-t border-line-2 pt-2">
          <AvatarStack people={l.people} size={26} ring="#FFFFFF" iconSize={13} overflowSize={28} />
          <span className="flex-1" />
          <span className="text-[12px] font-semibold text-ink-2">{l.asg ? `${l.sub}/${l.asg} 제출` : "담당자 미정"}</span>
        </span>
      )}
    </button>
  );
}
