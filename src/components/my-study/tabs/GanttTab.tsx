"use client";

import { useEffect, useRef } from "react";
import { addDays, diffDays, md } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, CodeIcons, Seg, TypeBadge } from "../bits";
import { ganttRange, visibleNodes, type ItemScope, type LeafNode, type LeafState, type Tree } from "../model";
import type { ScreenState, Update, Zoom } from "../state";

type Props = { tree: Tree; S: ScreenState; update: Update; goLeaf: (id: string) => void; isLeader: boolean };

/** 리프 막대 색 [bg, 글자, border] */
const GBAR: Record<LeafState, [string, string, string]> = {
  complete: ["#1E9E6A", "#FFFFFF", "1px solid #1E9E6A"],
  progress: ["#BDE9DC", "#0B6553", "1.5px solid #12A386"],
  delayed: ["#F7D4D0", "#A3302A", "1.5px solid #D64545"],
  planned: ["#FFFFFF", "#4A5563", "1px dashed #8C97A4"],
  unassigned: ["#FFFFFF", "#7A4F00", "1px dashed #C98A00"],
};
/** 개인 목표 막대 — slate 톤 + 점선 (캘린더와 같은 값). 완료면 테두리를 진하게 */
const PERSONAL_BAR: [string, string, string] = ["#E9EEF0", "#4A5563", "1.5px dashed #8C97A4"];
const PERSONAL_DONE: [string, string, string] = ["#E9EEF0", "#3D4F6B", "1.5px dashed #4F6382"];

/** 개인 목표 소유자(서버 people = [소유자]) */
const ownerOf = (n: LeafNode) => n.people.find((p) => p.userId === n.ownerId) ?? n.people[0] ?? null;
const personalDone = (n: LeafNode) => {
  const c = ownerOf(n)?.c;
  return c === "D" || c === "L";
};

export function GanttTab({ tree, S, update, goLeaf, isLeader }: Props) {
  const dayZoom = S.zoom !== "week";
  const dw = dayZoom ? 28 : 10;
  const today = useToday();
  const { start, nDays } = ganttRange(tree.roots, today);
  const W = nDays * dw;
  const meId = useMe()?.id ?? null;
  // 진행목표와 같은 두 칩·같은 state ("내 것만"·"팀원 목표"; 둘은 서로 끈다). 간트는 읽기 전용 — 편집 범위 없음
  const scope: ItemScope = { meId, mineOnly: S.mineOnly, others: S.othersPersonal && !S.mineOnly, isEdit: false, isLeader };
  const rows = visibleNodes(tree.roots, S.closed, scope);
  const toggleMine = () => update((p) => ({ mineOnly: !p.mineOnly, othersPersonal: p.mineOnly ? p.othersPersonal : false }));
  const toggleOthers = () => update((p) => ({ othersPersonal: !p.othersPersonal, mineOnly: p.othersPersonal ? p.mineOnly : false }));

  const months: { i: number; label: string; end: number }[] = [];
  for (let i = 0; i < nDays; i++) {
    const k = addDays(start, i);
    if (k.slice(8, 10) === "01" || i === 0) months.push({ i, label: `${+k.slice(5, 7)}월`, end: nDays });
  }
  months.forEach((m, idx) => {
    if (idx + 1 < months.length) m.end = months[idx + 1].i;
  });
  const tIdx = diffDays(start, today);
  const hasToday = tIdx >= 0 && tIdx < nDays;
  const todayX = tIdx * dw + dw / 2;
  const toggle = (id: string) => update((p) => ({ closed: { ...p.closed, [id]: !p.closed[id] } }));
  // 처음(및 확대 단위 변경 시) 오늘이 차트 영역 가운데쯤 오도록 가로 스크롤 (Q1-21/Q3-08)
  const scroller = useRef<HTMLDivElement>(null);
  const labelCol = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !hasToday) return;
    const left = labelCol.current?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, todayX - (el.clientWidth - left) / 2);
  }, [hasToday, todayX]);

  return (
    <div className="mt-[18px] flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Seg<Zoom> label="확대 단위" value={S.zoom} onChange={(z) => update({ zoom: z })} options={[["day", "일 단위"], ["week", "주 단위"]]} />
        <div role="group" aria-label="보기 필터" className="flex gap-[6px]">
          <Chip on={S.mineOnly} onClick={toggleMine}>
            내 것만
          </Chip>
          <Chip on={S.othersPersonal} onClick={toggleOthers}>
            팀원 목표
          </Chip>
        </div>
        <span className="flex-[1_1_20px]" />
        <Legend style={{ background: "#1E9E6A" }}>완료</Legend>
        <Legend style={{ background: "#BDE9DC", border: "1.5px solid #12A386" }}>진행</Legend>
        <Legend style={{ background: "#F7D4D0", border: "1.5px solid #D64545" }}>지연</Legend>
        <Legend style={{ background: "#FFFFFF", border: "1px dashed #8C97A4" }}>예정</Legend>
        <Legend style={{ background: PERSONAL_BAR[0], border: PERSONAL_BAR[2] }}>개인 목표</Legend>
        <span className="inline-flex items-center gap-[5px] text-[12px] text-ink-3">
          <span className="h-[14px] w-[2px] bg-danger" />오늘
        </span>
      </div>

      {/* 좁은 화면은 이름 열을 ≈96px 로 줄이고 아이콘·퍼센트를 숨겨 차트 폭을 확보한다 */}
      <div className="relative [--gantt-left:300px] max-sm:[--gantt-left:96px]">
        <div ref={scroller} className="thin-scroll overflow-x-auto rounded-[16px] border border-line">
          <div className="relative min-w-full" style={{ width: `calc(var(--gantt-left) + ${W}px)` }}>
            <div className="flex h-16 border-b border-line">
              <div ref={labelCol} className="sticky left-0 z-[3] flex w-[var(--gantt-left)] shrink-0 items-center border-r border-line bg-surface-3 px-[14px] text-[12px] font-semibold text-ink-3 max-sm:px-2">목표 · 과제</div>
              <div className="relative flex-1 bg-surface-3" style={{ minWidth: W }}>
                {months.map((m) => (
                  <span key={m.i} className="absolute top-0 h-[26px] overflow-hidden whitespace-nowrap border-l border-line pl-[6px] pr-2 pt-[6px] text-[12px] font-bold text-ink" style={{ left: m.i * dw, width: (m.end - m.i) * dw }}>
                    {m.label}
                  </span>
                ))}
                {Array.from({ length: nDays }, (_, i) => {
                  const k = addDays(start, i);
                  const dow = i % 7;
                  if (dayZoom)
                    return (
                      <span key={k} className="absolute top-[28px] text-center text-[11px] leading-4" style={{ left: i * dw, width: dw, color: dow === 0 ? "#C0453A" : dow === 6 ? "#2F5BC2" : "#5B6675", fontWeight: k === today ? 700 : 500 }}>
                        {+k.slice(8, 10)}
                      </span>
                    );
                  if (dow === 0)
                    return (
                      <span key={k} className="absolute top-[26px] h-[18px] whitespace-nowrap border-l border-line pl-[6px] pt-[2px] text-[11px] text-muted" style={{ left: i * dw }}>
                        {md(k)}
                      </span>
                    );
                  return null;
                })}
                {hasToday && (
                  <span className="absolute bottom-[3px] z-[1] -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-danger px-[6px] py-px text-[10px] font-bold leading-[14px] text-white" style={{ left: todayX }}>
                    오늘
                  </span>
                )}
              </div>
            </div>

            {rows.map((n) => {
              const open = !S.closed[n.id];
              const x = diffDays(start, n.s) * dw;
              const w = (diffDays(n.s, n.e) + 1) * dw;
              const personal = n.leaf && n.personal;
              const done = personal && personalDone(n);
              const owner = personal ? ownerOf(n) : null;
              // 남의 개인 목표에만 소유자 표시 (결정 5 — 내 것에는 "나" 칩·아바타 없음)
              const other = personal && owner && owner.userId !== meId ? owner : null;
              const what = personal ? `개인 목표${other ? ` · ${other.name}` : ""} · ${done ? "완료" : "미완료"}` : n.leaf ? (n.asg ? `${n.sub}/${n.asg} 제출` : "담당자 미정") : `${n.pct}%`;
              const tip = `${n.title} · ${md(n.s)}–${md(n.e)} · ${what}`;
              // 리프 막대 색 (회차·묶음은 아래 진척 막대 — 팀만)
              const bar = personal ? (done ? PERSONAL_DONE : PERSONAL_BAR) : n.leaf ? GBAR[n.state] : GBAR.planned;
              return (
                <div key={n.id} data-gantt-row={n.id} className="flex h-11 border-b border-line-2">
                  <div className="sticky left-0 z-[2] flex w-[var(--gantt-left)] shrink-0 items-center gap-[6px] border-r border-line pl-2 pr-3 max-sm:gap-[2px] max-sm:pl-1 max-sm:pr-1" style={{ background: n.d === 0 ? "#FAFCFB" : personal ? "#F7F9FC" : "#FFFFFF", opacity: n.archived ? 0.55 : 1 }}>
                    <span className="w-[calc(var(--d)*16px)] shrink-0 max-sm:w-[calc(var(--d)*4px)]" style={{ "--d": n.d } as React.CSSProperties} />
                    {n.leaf ? (
                      <span className="w-[26px] shrink-0 max-sm:w-0" />
                    ) : (
                      <button type="button" aria-label={`${n.title} ${open ? "접기" : "펼치기"}`} aria-expanded={open} onClick={() => toggle(n.id)} className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-transparent text-ink-3">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block transition-transform duration-150" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}>
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                      </button>
                    )}
                    <button type="button" onClick={() => (n.leaf ? goLeaf(n.id) : toggle(n.id))} title={tip} className="flex h-9 min-w-0 flex-1 items-center gap-[6px] bg-transparent p-0 text-left text-ink">
                      {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[6px] bg-navy px-[6px] py-[2px] text-[11px] font-bold text-white max-sm:hidden">{n.label}</span>}
                      {personal && (
                        <span className="flex shrink-0 max-sm:hidden">
                          <TypeBadge type="개인" />
                        </span>
                      )}
                      {other && (
                        <span data-owner={other.userId} className="flex shrink-0">
                          <Avatar name={other.name} size={20} tone={other.tone} id={other.userId} />
                          <span className="sr-only">{other.name}</span>
                        </span>
                      )}
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] max-sm:text-[12px]" style={{ fontWeight: n.d === 0 ? 700 : n.leaf ? 500 : 600 }}>
                        {n.title}
                      </span>
                    </button>
                    <span className="flex shrink-0 max-sm:hidden">
                      {personal ? (
                        other && <span aria-hidden="true" className="max-w-[56px] truncate text-[12px] font-medium text-ink-3">{other.name}</span>
                      ) : n.leaf ? (
                        <CodeIcons codes={n.people.map((p) => p.c)} size={13} max={4} />
                      ) : (
                        <span className="text-[12px] font-bold">{n.pct}%</span>
                      )}
                    </span>
                  </div>
                  <div className="relative flex-1" style={{ minWidth: W, backgroundImage: `repeating-linear-gradient(to right, #EEF2F1 0 1px, transparent 1px ${7 * dw}px)` }}>
                    {hasToday && <span className="absolute bottom-0 top-0 z-[1] w-[2px] bg-danger opacity-55" style={{ left: todayX - 1 }} />}
                    {n.leaf ? (
                      <span
                        title={tip}
                        data-bar
                        data-personal={personal || undefined}
                        className="absolute top-[10px] flex h-6 items-center justify-center overflow-hidden whitespace-nowrap rounded-[6px] text-[11px] font-bold"
                        style={{ left: x + 2, width: w - 4, background: bar[0], color: bar[1], border: bar[2], opacity: n.archived ? 0.5 : 1 }}
                      >
                        {w >= 44 ? (personal ? (done ? "✓ 완료" : "") : n.asg ? `${n.sub}/${n.asg}` : "미정") : ""}
                      </span>
                    ) : (
                      <span title={tip} className="absolute top-[17px] block h-[10px] overflow-hidden rounded-[5px] bg-[#DCE5E2]" style={{ left: x + 2, width: w - 4 }}>
                        <span className="block h-full" style={{ width: `${n.pct}%`, background: n.d === 0 ? "#22264B" : "#4A5563" }} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="flex h-[120px]">
                <div className="sticky left-0 z-[2] w-[var(--gantt-left)] shrink-0 border-r border-line bg-surface" />
                <div className="relative flex-1" style={{ minWidth: W, backgroundImage: `repeating-linear-gradient(to right, #EEF2F1 0 1px, transparent 1px ${7 * dw}px)` }}>
                  {hasToday && <span className="absolute bottom-0 top-0 z-[1] w-[2px] bg-danger opacity-55" style={{ left: todayX - 1 }} />}
                </div>
              </div>
            )}
          </div>
        </div>
        {rows.length === 0 && (
          // 안내 문구는 가로 스크롤과 무관하게 보이는 영역 가운데(헤더 아래)에 둔다
          <p className="pointer-events-none absolute left-[var(--gantt-left)] right-0 top-16 z-[4] m-0 flex h-[120px] items-center justify-center px-4">
            <span className="rounded-[10px] bg-surface px-3 py-2 text-center text-[13px] leading-[1.6] text-muted shadow-[0_0_0_1px_var(--color-line-2)]">
              아직 등록된 회차·과제가 없어요.
              <br />
              진행목표 탭에서 추가하면 여기에 일정이 그려져요.
            </span>
          </p>
        )}
      </div>
      <p className="m-0 text-[12px] text-muted">읽기 전용이에요. 일정 변경은 진행목표 탭의 편집 모드(그룹장)에서 할 수 있어요. 과제 이름을 누르면 진행목표에서 상세를 볼 수 있어요.</p>
    </div>
  );
}

const Legend = ({ style, children }: { style: React.CSSProperties; children: string }) => (
  <span className="inline-flex items-center gap-[5px] text-[12px] text-ink-3">
    <span className="h-3 w-[22px] rounded-[4px]" style={style} />
    {children}
  </span>
);
