"use client";

import { useEffect, useRef, useState } from "react";
import { Listbox, type ListboxOption } from "@/components/ui/Listbox";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { diffDays, md, weekdayKo } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { Seg, TypeBadge } from "../bits";
import { TaskAvatars } from "../TaskAvatars";
import { CODE_COLOR, CODE_LABEL, CODE_STATUS, boardColumn, codeLabel, ddayLabel, myCode, type BoardCol, type LeafNode, type Tree } from "../model";
import { boardSource } from "../sources";
import type { BoardMode, ScreenState, Update } from "../state";

/**
 * 보드 회차 필터 선택지 — 회차가 20개쯤 되면 칩이 여러 줄로 쌓여 칸반을 밀어내서 드롭다운 하나로 고른다.
 * 제목은 "1주차 · 제목"(라벨 없으면 제목만), 아래 줄은 기간과 그 회차 과제 수(counts — 지금 칸반 범위 기준).
 * 꼬리표: 보관된 회차 "보관됨", 오늘이 든 회차 "이번 회차", 끝난 회차 "종료". 앞으로의 회차는 꼬리표 없음.
 */
export function boardRoundOptions(roots: Tree["roots"], today: string, counts: Record<string, number> = {}): ListboxOption[] {
  const n = (k: number) => `과제 ${k}개`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return [
    { value: "all", label: "전체 회차", sub: `${roots.length}개 회차 · ${n(total)}` },
    ...roots.map((r): ListboxOption => {
      const tag: ListboxOption["tag"] = r.archived
        ? { text: "보관됨", tone: "slate" }
        : r.s <= today && today <= r.e
          ? { text: "이번 회차", tone: "mint" }
          : r.e < today
            ? { text: "종료", tone: "muted" }
            : undefined;
      return { value: r.id, label: r.label ? `${r.label} · ${r.title}` : r.title, sub: `${md(r.s)} – ${md(r.e)} · ${n(counts[r.id] ?? 0)}`, tag };
    }),
  ];
}

const EMPTY: Record<BoardCol, string> = {
  todo: "예정된 과제가 없어요",
  doing: "진행 중인 과제가 없어요",
  late: "기한이 지난 과제가 없어요",
  done: "아직 제출이 끝난 과제가 없어요",
};

type Props = { tree: Tree; S: ScreenState; update: Update; goLeaf: (id: string) => void };

export function BoardTab({ tree, S, update, goLeaf }: Props) {
  const today = useToday();
  // 「전체 회차 보기」로 넓히기 전 회차 — 있으면 전체 보기에서 「접기」로 그 회차에 돌아간다(드롭다운으로 직접 고른 전체엔 없음)
  const [backTo, setBackTo] = useState<string | null>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapsed = useRef(false);
  // 접은 뒤 목록이 짧아져 버튼이 화면 밖이면 — 펼치기 버튼으로 포커스를 옮겨 화면 안으로 끌어온다
  useEffect(() => {
    if (!collapsed.current) return;
    collapsed.current = false;
    expandRef.current?.focus();
  });
  const meId = useMe()?.id ?? null;
  const mine = S.bMode === "mine";
  const scoped = boardSource(tree, mine, meId);
  const counts: Record<string, number> = {};
  for (const l of scoped) if (l.roundId) counts[l.roundId] = (counts[l.roundId] ?? 0) + 1;
  const rounds = boardRoundOptions(tree.roots, today, counts);
  // 고른 회차가 사라졌으면(삭제 등) 전체로 — 드롭다운에 보이는 값과 거르는 값을 맞춘다
  const bRound = rounds.some((o) => o.value === S.bRound) ? S.bRound : "all";
  const inRound = (l: LeafNode) => bRound === "all" || l.roundId === bRound;
  const src = scoped
    .filter(inRound)
    .sort((a, b) => a.e.localeCompare(b.e));
  const noMine = mine && scoped.length === 0;
  const cols: [BoardCol, string, string][] = [
    ["todo", "예정", "#8C97A4"],
    ["doing", "진행중", "#12A386"],
    ["late", "지연", CODE_COLOR.M],
    ["done", mine ? "제출 완료" : "전원 제출", "#1E9E6A"],
  ];
  // 한 회차만 볼 때 예정 칸이 비면 — 이후 회차 전체의 예정 과제 수를 알려 주고 전체 회차로 넓힐 수 있게 한다
  const at = tree.roots.findIndex((r) => r.id === bRound);
  const later = new Set(at < 0 ? [] : tree.roots.slice(at + 1).map((r) => r.id));
  const nextTodo = scoped.filter((l) => l.roundId && later.has(l.roundId) && boardColumn(l, mine, meId) === "todo").length;

  return (
    <div className="mt-[18px] flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-[10px]">
        <Seg<BoardMode> label="칸반 범위" value={S.bMode} onChange={(m) => update({ bMode: m })} options={[["mine", "내 칸반"], ["team", "팀 칸반"]]} />
        <span className="flex-[1_1_20px]" />
        {/* 좁은 폭: 버튼이 한 줄을 다 쓰고 목록은 아래에서 올라오는 시트. sm 이상: 버튼은 칸반 세그(40px)와 같은 높이(누르는 영역은 44px), 목록은 버튼 아래 팝오버 */}
        <Listbox label="회차 필터" prefix="회차" value={bRound} options={rounds} onChange={(v) => { setBackTo(null); update({ bRound: v }); }} className="max-sm:w-full sm:w-[300px] sm:max-w-[360px]" />
      </div>
      <p className="m-0 text-[12px] text-muted">
        {mine
          ? "내가 담당한 과제만 보여요. 제출 상태에 따라 칸이 자동으로 바뀌고, 기한이 지나도록 제출하지 않으면 ‘지연’으로 옮겨져요 · 카드를 누르면 진행목표에서 상세를 볼 수 있어요."
          : "모든 과제의 팀 진행 상황이에요. 기한이 지났는데 아직 다 제출하지 않은 과제는 ‘지연’, 담당자 전원이 제출하면 ‘전원 제출’로 이동해요."}
      </p>
      {noMine && <div className="rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">아직 내게 배정된 과제가 없어요. 참가가 확정되면 여기에 보여요.</div>}

      {/* 칸 4개 — 자기 폭 기준으로 1열(좁은 폭) · 2×2 · 4열. auto-fit 이면 3+1 로 지연·제출 칸이 홀로 떨어져서 단계를 고정한다(4열은 칸 하나 ≥200px) */}
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-[14px] @min-[420px]:grid-cols-2 @min-[850px]:grid-cols-4">
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
                {cards.length === 0 && <p className="mx-1 my-[6px] text-[12px] text-faint">{EMPTY[id]}</p>}
                {id === "todo" && cards.length === 0 && bRound !== "all" && nextTodo > 0 && (
                  <button
                    ref={expandRef}
                    type="button"
                    aria-expanded={false}
                    onClick={() => { setBackTo(bRound); update({ bRound: "all" }); }}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[12px] border border-dashed border-line-dash bg-surface px-3 text-left text-[12px] font-semibold text-ink-2 hover:border-mint hover:text-mint-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint"
                  >
                    <span>이후 회차 과제 {nextTodo}개</span>
                    <span className="text-mint-deep">
                      전체 회차 보기 <span aria-hidden="true">→</span>
                    </span>
                  </button>
                )}
                {id === "todo" && bRound === "all" && backTo && rounds.some((o) => o.value === backTo) && (
                  <button
                    type="button"
                    aria-expanded={true}
                    onClick={() => { update({ bRound: backTo }); setBackTo(null); collapsed.current = true; }}
                    className="flex min-h-11 w-full items-center justify-center gap-1 rounded-[12px] border border-dashed border-line-dash bg-surface px-3 text-[12px] font-semibold text-mint-deep hover:border-mint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint"
                  >
                    접기 <span aria-hidden="true">↑</span>
                  </button>
                )}
              </section>
            );
          })}
        </div>
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
    // 카드 전체가 누르는 영역 — 안에 아바타 펼치기 버튼이 있어 버튼 안 버튼을 피해 div 클릭으로 받고, 키보드·보조기기는 제목 버튼(Enter·Space 의 click 이 카드로 올라온다)
    <div
      onClick={onOpen}
      className="flex w-full cursor-pointer flex-col items-stretch gap-[6px] rounded-[14px] border p-[14px] text-left text-ink transition-[box-shadow,border-color] duration-150 hover:border-line-dash hover:shadow-[0_6px_16px_rgba(27,34,48,.08)] has-[button[data-card-open]:focus-visible]:outline-2 has-[button[data-card-open]:focus-visible]:outline-offset-2 has-[button[data-card-open]:focus-visible]:outline-mint"
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
      <button type="button" data-card-open className="bg-transparent p-0 text-left focus-visible:outline-none">
        <span className="text-[14px] font-semibold leading-[1.4] text-ink">{l.title}</span>
      </button>
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
          <TaskAvatars
            people={l.people.map((p) => ({ key: p.userId, name: p.name, tone: p.tone, id: p.userId, status: CODE_STATUS[p.c], title: `${p.name} · ${CODE_LABEL[p.c]}` }))}
            size={24}
            iconSize={11}
            compactSize={22}
            compactIconSize={10}
            ring="#FFFFFF"
          />
          <span className="flex-1" />
          <span className="text-[12px] font-semibold text-ink-2">{l.asg ? `${l.sub}/${l.asg} 제출` : "담당자 미정"}</span>
        </span>
      )}
    </div>
  );
}
