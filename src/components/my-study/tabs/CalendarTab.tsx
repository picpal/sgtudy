"use client";

import { Avatar } from "@/components/ui/Avatar";
import { addDays, md, weekdayKo } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { Chip, CodeIcons, PERSONAL_BAR, Seg, TypeBadge } from "../bits";
import {
  CODE_COLOR,
  CODE_STATE,
  codeLabel,
  calendarAnchor,
  calendarGrid,
  ddayLabel,
  shiftAnchor,
  weekSegments,
  type CalMode,
  type Code,
  type LeafNode,
  type LeafState,
  type Tree,
  type TreeMember,
} from "../model";
import { calendarSource } from "../sources";
import type { ScreenState, Update } from "../state";

type Props = { tree: Tree; S: ScreenState; update: Update; goLeaf: (id: string) => void };

/** 막대 색 [bg, 글자, border] */
const BAR: Record<LeafState, [string, string, string]> = {
  complete: ["#E6F4EC", "#1A6B47", "1px solid #BFE3CF"],
  progress: ["#DDF4EE", "#0B6553", "1.5px solid #12A386"],
  delayed: ["#FCEBE9", "#A3302A", "1.5px solid #D64545"],
  planned: ["#FFFFFF", "#4A5563", "1px dashed #8C97A4"],
  unassigned: ["#FFFFFF", "#7A4F00", "1px dashed #C98A00"],
};


const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dowColor = (c: number) => (c === 0 ? "#C0453A" : c === 6 ? "#2F5BC2" : "#4A5563");

export function CalendarTab({ tree, S, update, goLeaf }: Props) {
  const today = useToday();
  const meId = useMe()?.id ?? null;
  const anchor = S.calAnchor ?? calendarAnchor(tree.leaves, today);
  const isWeek = S.calMode === "week";
  const { gridStart, rows, label, month } = calendarGrid(anchor, S.calMode);
  const whoId = S.calWho === "all" ? null : S.calWho === "me" ? meId : S.calWho;
  const whoCode = (l: LeafNode): Code | null => (whoId ? (l.people.find((p) => p.userId === whoId)?.c ?? null) : null);
  const calLeaves = calendarSource(tree, S.calWho, meId);
  const pick = calLeaves.find((l) => l.id === S.calPick) ?? null;
  const shift = (dir: 1 | -1) => update({ calAnchor: shiftAnchor(anchor, S.calMode, dir), calPick: null });
  const who: [string, string, TreeMember | null][] = [["all", "전체", null], ["me", "내 과제만", null], ...tree.members.filter((m) => m.userId !== meId).map((m): [string, string, TreeMember] => [m.userId, m.name, m])];

  return (
    <div className="mt-[18px] flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-[10px]">
        <h3 className="m-0 min-w-[128px] text-[20px] font-bold">{label}</h3>
        <NavBtn label="이전" onClick={() => shift(-1)} d="m15 6-6 6 6 6" />
        <NavBtn label="다음" onClick={() => shift(1)} d="m9 6 6 6-6 6" />
        <button type="button" onClick={() => update({ calAnchor: today, calPick: null })} className="h-[38px] rounded-[19px] border border-line bg-surface px-[14px] text-[13px] font-semibold text-ink">
          오늘
        </button>
        <span className="flex-[1_1_20px]" />
        <Seg<CalMode> label="보기 단위" value={S.calMode} onChange={(m) => update({ calMode: m, calPick: null })} options={[["month", "월간"], ["week", "주간"]]} />
      </div>
      <div role="group" aria-label="참가자 필터" className="flex flex-wrap items-center gap-[6px]">
        {who.map(([id, text, person]) => (
          <Chip key={id} on={S.calWho === id} onClick={() => update({ calWho: id, calPick: null })} withAvatar={!!person}>
            {person && <Avatar name={person.name} size={22} tone={person.tone} id={person.userId} />}
            {text}
          </Chip>
        ))}
      </div>

      {/* 팝오버는 overflow-hidden 그리드 밖(바깥 relative)에 둔다 — 주간 보기에서 잘리지 않게 (Q1-06) */}
      <div className="relative">
        <div className="overflow-hidden rounded-[16px] border border-line">
          <div className="grid grid-cols-7 border-b border-line bg-surface-2">
            {DOW.map((d, c) => (
              <div key={d} className="p-[10px] text-[12px] font-semibold" style={{ color: dowColor(c) }}>
                {d}
              </div>
            ))}
          </div>
          {Array.from({ length: rows }, (_, ri) => {
            const ws = addDays(gridStart, ri * 7);
            const segs = weekSegments(calLeaves, ws);
            return (
              <div key={ws} className="relative" style={{ borderBottom: ri < rows - 1 ? "1px solid #EEF2F1" : 0, minHeight: isWeek ? 240 : 112 }}>
                <div className="absolute inset-0 grid grid-cols-7">
                  {Array.from({ length: 7 }, (_, c) => {
                    const k = addDays(ws, c);
                    const inM = isWeek || +k.slice(5, 7) === month;
                    const isT = k === today;
                    const markers = tree.roots.filter((r) => r.s === k && r.label);
                    return (
                      <div key={k} className="px-2 py-[6px]" style={{ borderRight: c < 6 ? "1px solid #EEF2F1" : 0, background: isT ? "#F4FBF8" : inM ? "#FFFFFF" : "#FAFBFB" }}>
                        <span className="flex items-center justify-between gap-1">
                          <span
                            className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[13px] text-[13px]"
                            style={{
                              padding: `0 ${isWeek ? 8 : 0}px`,
                              fontWeight: isT ? 700 : 500,
                              background: isT ? "#1B2230" : "transparent",
                              color: isT ? "#FFFFFF" : !inM ? "#A7B0BA" : c === 0 ? "#C0453A" : c === 6 ? "#2F5BC2" : "#1B2230",
                            }}
                          >
                            {isWeek ? `${+k.slice(5, 7)}.${+k.slice(8, 10)}` : String(+k.slice(8, 10))}
                          </span>
                          <span className="flex gap-[3px]">
                            {markers.map((r) => (
                              <span key={r.id} title={`${r.label} ${r.title} 시작`} className="whitespace-nowrap rounded-[5px] bg-navy px-[6px] py-px text-[10px] font-bold text-white max-sm:h-[7px] max-sm:w-[7px] max-sm:self-center max-sm:rounded-full max-sm:p-0">
                                <span className="max-sm:hidden">{r.label}</span>
                              </span>
                            ))}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="relative grid grid-cols-7 pb-[10px] pt-[38px]" style={{ gridAutoRows: 26, rowGap: 4 }}>
                  {segs.map(({ l, col, span, isStart, isEnd, lane }) => {
                    const wc = whoCode(l);
                    const st = wc ? CODE_STATE[wc] : l.state;
                    const [bg, fg, bdr] = l.personal ? PERSONAL_BAR : BAR[st];
                    const endCodes: Code[] = wc ? [wc] : l.people.map((p) => p.c);
                    const lr = isStart ? 7 : 0;
                    const rr = isEnd ? 7 : 0;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        title={`${l.personal ? "[개인] " : ""}${l.crumb} · ${l.title} (${md(l.s)}–${md(l.e)})`}
                        onClick={() => update({ calPick: l.id })}
                        className="relative flex min-w-0 items-center gap-1 pl-2 pr-[6px] text-left text-[12px] transition-shadow duration-100 hover:z-[2] hover:shadow-[0_3px_8px_rgba(27,34,48,.18)]"
                        style={{
                          gridColumn: `${col + 1} / span ${span}`,
                          gridRow: lane + 1,
                          margin: `0 ${isEnd ? 5 : 0}px 0 ${isStart ? 5 : 0}px`,
                          borderRadius: `${lr}px ${rr}px ${rr}px ${lr}px`,
                          border: bdr,
                          background: bg,
                          color: fg,
                          fontWeight: st === "progress" || st === "delayed" ? 700 : 500,
                        }}
                      >
                        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{isStart || col === 0 ? l.title : `${l.title} (계속)`}</span>
                        {isEnd && <CodeIcons codes={endCodes} size={13} max={3} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {pick && (
          <div role="dialog" aria-label="과제 상세" className="absolute right-3 top-12 z-[5] flex w-[300px] max-w-[calc(100%-24px)] flex-col gap-[10px] rounded-[16px] border border-line bg-surface p-4 shadow-[0_16px_40px_rgba(27,34,48,.18)]">
            <div className="flex items-start gap-2">
              <TypeBadge type={pick.type} />
              <span className="min-w-0 flex-1 text-[15px] font-bold leading-[1.35]">{pick.title}</span>
              <button type="button" aria-label="닫기" onClick={() => update({ calPick: null })} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-transparent text-ink-3">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="text-[12px] text-muted">{pick.crumb}</div>
            <div className="text-[13px] text-ink-2">
              {md(pick.s)}({weekdayKo(pick.s)}) – {md(pick.e)}({weekdayKo(pick.e)}) · <b className="font-bold">{pick.state === "complete" ? (pick.personal ? codeLabel(pick, pick.people[0]?.c ?? "D") : "전원 제출") : ddayLabel(today, pick.e)}</b>
            </div>
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {pick.people.map((p) => (
                <li key={p.userId} className="flex items-center gap-[10px] rounded-[10px] bg-surface-2 px-2 py-[6px]">
                  <Avatar name={p.name} size={28} tone={p.tone} id={p.userId} />
                  <span className="flex-1 text-[13px] font-semibold">
                    {p.name}
                    {p.userId === meId ? " (나)" : ""}
                  </span>
                  <span className="text-[12px] font-semibold" style={{ color: CODE_COLOR[p.c] }}>
                    {codeLabel(pick, p.c)}
                  </span>
                </li>
              ))}
            </ul>
            {pick.people.length === 0 && <span className="text-[13px] text-amber-text">아직 담당자가 없어요</span>}
            <button type="button" onClick={() => goLeaf(pick.id)} className="h-[42px] rounded-[21px] bg-navy text-[14px] font-semibold text-white">
              진행목표에서 보기
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[14px] text-[12px] text-ink-3">
        <Legend bg="#DDF4EE" border="1.5px solid #12A386">진행중</Legend>
        <Legend bg="#E6F4EC" border="1px solid #BFE3CF">완료</Legend>
        <Legend bg="#FCEBE9" border="1.5px solid #D64545">지연(미제출 있음)</Legend>
        <Legend bg="#FFFFFF" border="1px dashed #8C97A4">예정</Legend>
        <Legend bg="#E9EEF0" border="1.5px dashed #8C97A4">개인</Legend>
        <span className="inline-flex items-center gap-[5px]">
          <span className="rounded-[5px] bg-navy px-[6px] py-px text-[10px] font-bold text-white">2주차</span>회차 시작
        </span>
        <span className="text-muted">· 막대 끝 아이콘 = 담당자별 제출 상태</span>
      </div>
    </div>
  );
}

const Legend = ({ bg, border, children }: { bg: string; border: string; children: string }) => (
  <span className="inline-flex items-center gap-[5px]">
    <span className="h-3 w-6 rounded-[4px]" style={{ background: bg, border }} />
    {children}
  </span>
);

const NavBtn = ({ label, onClick, d }: { label: string; onClick: () => void; d: string }) => (
  <button type="button" aria-label={label} onClick={onClick} className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line bg-surface">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1B2230" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  </button>
);
