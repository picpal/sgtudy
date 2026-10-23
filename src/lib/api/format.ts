import { dday, diffDays, WEEKDAY_KO, weekdayKo } from "@/lib/date";
import type { Tone } from "@/lib/palette";
import type { RoomStatus, TaskStatus } from "@/lib/types";
import type { LeafSummary, RoomDetail, RoomStatusDto, RoundSummary, TaskTypeDto } from "./types";

export const ymd = (iso: string) => iso.replaceAll("-", ".");
/** "10.01" — date.ts 의 md() 는 월을 안 채우므로(7.01) 카드·회차 표기는 이것을 쓴다 */
export const mmdd = (iso: string) => iso.slice(5).replace("-", ".");
export const uiStatus = (s: RoomStatusDto): RoomStatus => (s === "draft" ? "recruit" : s);
export const TASK_TYPE_KO: Record<TaskTypeDto, "공통" | "지정" | "개인"> = { common: "공통", designated: "지정", personal: "개인" };

const sameYear = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4);

/**
 * 날짜 하나 표기 규칙(Q2-13): 오늘과 같은 해면 MM.DD, 다른 해면 YYYY.MM.DD.
 * 범위는 endPart 규칙(끝이 시작과 다른 해면 연도)을 쓴다 — 둘 다 "연도가 바뀌면 연도를 쓴다"는 같은 규칙이다
 */
export const dateShort = (iso: string, today: string): string => (sameYear(iso, today) ? mmdd(iso) : ymd(iso));
/** 기간 표기 규칙(Q2-13): 시작은 dateShort, 끝은 시작과 다른 해면 YYYY.MM.DD — "10.25 – 2027.01.10", "2027.01.04 – 01.10" */
export const rangeShort = (start: string, end: string, today: string): string => `${dateShort(start, today)} – ${sameYear(start, end) ? mmdd(end) : ymd(end)}`;

/** "10/26" — 방 만들기(인터뷰·초안 카드·회차 초안) 의 짧은 날짜. withYear 면 "2026.10.26" */
export const slashDate = (iso: string, withYear = false): string => (withYear ? ymd(iso) : `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`);
/** 방 만들기 기간 표기 — 같은 해면 "10/26~12/20", 해를 넘기면 거꾸로 읽히지 않게 둘 다 연도 "2026.10.26 ~ 2027.10.24" */
export const slashRange = (start: string, end: string): string =>
  sameYear(start, end) ? `${slashDate(start)}~${slashDate(end)}` : `${ymd(start)} ~ ${ymd(end)}`;

/** D14: 기간 주 수 = round((일수+1)/7). 카드 "· N주" 와 종료 방 "N주 완주" 가 같은 값을 쓴다(회차 수와 무관) */
export const periodWeeks = (start: string, end: string): number => Math.round((diffDays(start, end) + 1) / 7);

/** 기간의 끝 표기: 같은 해면 MM.DD, 해를 넘기면 YYYY.MM.DD (Review Focus 1 — periodShort·periodLong 공용) */
export const endPart = (start: string, end: string): string => (sameYear(start, end) ? mmdd(end) : ymd(end));

/** "{YYYY.MM.DD} – {같은 해면 MM.DD}" — 사이드바·카드 공용 (preflight E5a) */
export const periodShort = (start: string, end: string): string => `${ymd(start)} – ${endPart(start, end)}`;

/** main §3-5: "{YYYY.MM.DD} – {같은 해면 MM.DD} · {round(일수/7)}주" */
export function periodCard(start: string, end: string): string {
  return `${periodShort(start, end)} · ${periodWeeks(start, end)}주`;
}

/** roomview §1.2: 요일 포함 */
export function periodLong(start: string, end: string): string {
  return `${ymd(start)}(${weekdayKo(start)}) – ${endPart(start, end)}(${weekdayKo(end)})`;
}

export function ddayOf(status: RoomStatusDto, today: string, start: string, end: string): { short: string; long: string } {
  if (status === "ended") return { short: "종료", long: `${dateShort(end, today)} 종료` };
  if (status === "active") {
    const short = dday(today, end);
    return { short, long: `종료까지 ${short}` };
  }
  if (today === start) return { short: "오늘 시작", long: "오늘 시작" };
  if (today > start) return { short: "시작일 지남", long: "시작일 지남 · 그룹장이 시작하면 진행돼요" };
  const short = dday(today, start);
  return { short, long: `시작까지 ${short}` };
}

/** 오늘을 포함하는 회차(여러 개면 마지막) → inside. 없으면 오늘 이전에 시작한 마지막 회차 → inside:false. 시작한 회차가 없으면 null. */
export function curIndexOf(rounds: RoundSummary[], today: string): { index: number; inside: boolean } | null {
  let inside = -1;
  let started = -1;
  rounds.forEach((r, i) => {
    if (r.startDate <= today) started = i;
    if (r.startDate <= today && today <= r.endDate) inside = i;
  });
  if (inside >= 0) return { index: inside, inside: true };
  if (started >= 0) return { index: started, inside: false };
  return null;
}

/** roomview §3.6: recruit 앞 3개 / active [cur-1, cur, cur+1] + 완료 접두 / ended 전부 */
export function roundsWindow(rounds: RoundSummary[], status: RoomStatusDto, today: string): { rows: RoundSummary[]; more: string; lo: number } {
  const n = rounds.length;
  if (status === "ended") return { rows: rounds, more: "", lo: 0 };
  if (status !== "active") return { rows: rounds.slice(0, 3), more: n > 3 ? `이후 ${n - 3}개 회차가 더 있어요` : "", lo: 0 };
  const i = curIndexOf(rounds, today)?.index ?? 0;
  const lo = Math.max(0, Math.min(i - 1, n - 3));
  const hi = Math.min(n - 1, lo + 2);
  const after = n - 1 - hi;
  const prefix = lo === 0 ? "" : lo === 1 ? `${rounds[0].label} 완료` : `${rounds[0].label.replace(/주차$/, "")}~${rounds[lo - 1].label} 완료`;
  const tail = after > 0 ? `이후 ${after}개 회차가 더 있어요` : "";
  return { rows: rounds.slice(lo, hi + 1), more: [prefix, tail].filter(Boolean).join(" · "), lo };
}

export type RoundRowView = { label: string; title: string; dates: string; state: string; sub?: number; total?: number; current?: boolean };

export function roundRow(r: RoundSummary, status: RoomStatusDto, today: string, current: boolean): RoundRowView {
  const dates = rangeShort(r.startDate, r.endDate, today);
  if (status === "recruit" || status === "draft") return { label: r.label, title: r.title, dates, state: `과제 ${r.leafCount}개` };
  if (status === "ended") return { label: r.label, title: r.title, dates, state: "완료", sub: r.submitted, total: r.assigned };
  const state = today < r.startDate ? "예정" : today <= r.endDate ? "진행중" : r.pct === 100 ? "완료" : "기간 종료";
  return { label: r.label, title: r.title, dates, state, sub: r.submitted, total: r.assigned, current };
}

export type CurPersonView = { userId: string; name: string; tone: Tone; status: TaskStatus };
export type CurTaskView = { id: string; title: string; type: "공통" | "지정" | "개인"; dates: string; people: CurPersonView[] };
export type CurView = { pill: string; title: string; meta: string; tasks: CurTaskView[] };
export type CurInput = Pick<RoomDetail, "status" | "startDate" | "endDate" | "currentRound" | "rounds" | "stats">;

const taskView = (t: LeafSummary, today: string): CurTaskView => ({
  id: t.id,
  title: t.title,
  type: TASK_TYPE_KO[t.type],
  dates: rangeShort(t.startDate, t.endDate, today),
  people: t.people.map((p) => ({ userId: p.userId, name: p.nickname, tone: p.tone, status: p.status })),
});

/** roomview §1.3 현재 회차 카드 */
export function curOf(dto: CurInput, today: string): CurView {
  const { stats } = dto;
  if (dto.status === "recruit" || dto.status === "draft") {
    const s = dto.startDate;
    return {
      pill: "시작 전",
      title: `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일(${weekdayKo(s)}) 첫 회차가 열려요`,
      meta: `${stats.roundCount}회차 · 과제 ${stats.leafCount}개 준비됨`,
      tasks: [],
    };
  }
  if (dto.status === "ended") {
    return {
      pill: "종료",
      title: `${periodWeeks(dto.startDate, dto.endDate)}주 완주 · 전체 달성률 ${stats.overallPct === null ? "—" : `${stats.overallPct}%`}`,   // N주 = 기간 주 수(D14), N회차 = roundCount
      meta: `${rangeShort(dto.startDate, dto.endDate, today)} · 제출 ${stats.totalSubmissions} / ${stats.totalAssignments}건`,
      tasks: [],
    };
  }
  // 서버는 공백 구간에서 직전 회차를 currentRound 로 준다(room_current_round_id) → 오늘을 포함할 때만 현재 회차 (preflight C2)
  const cur = dto.currentRound && dto.currentRound.startDate <= today && today <= dto.currentRound.endDate ? dto.currentRound : null;
  if (cur) {
    return {
      pill: `${cur.label} · 진행중`,
      title: cur.title,
      meta: `${dateShort(cur.startDate, today)}(${weekdayKo(cur.startDate)}) – ${sameYear(cur.startDate, cur.endDate) ? mmdd(cur.endDate) : ymd(cur.endDate)}(${weekdayKo(cur.endDate)}) · 마감 ${dday(today, cur.endDate)}`,
      tasks: (cur.tasks ?? []).map((t) => taskView(t, today)),
    };
  }
  const prev = curIndexOf(dto.rounds, today);
  const next = dto.rounds.find((r) => r.startDate > today);
  const last = prev ? dto.rounds[prev.index] : null;
  return {
    // roundRow 와 같은 규칙: 지난 회차가 전원 제출(pct 100)이면 "완료"
    pill: last ? `${last.label} · ${last.pct === 100 ? "완료" : "기간 종료"}` : "시작 전",
    title: "진행 중인 회차가 없어요",
    meta: next ? `다음 회차 ${dateShort(next.startDate, today)} 시작` : "",
    tasks: [],
  };
}

/** roomview §3.7 */
export function glanceOf(stats: RoomDetail["stats"], status: RoomStatusDto): { rounds: string; tasks: string } {
  const wd = stats.startWeekdays;
  let rounds = `${stats.roundCount}회차`;
  if (status === "ended") rounds += " · 완료";
  else if (wd.length === 1 && stats.roundCount >= 3) rounds += ` · 매주 ${WEEKDAY_KO[wd[0] % 7]}요일 시작`;
  else if (wd.length === 2) rounds += ` · ${WEEKDAY_KO[wd[0] % 7]}·${WEEKDAY_KO[wd[1] % 7]} 시작`;
  const mix = stats.designatedCount === 0 ? "모두 공통 과제" : `공통 ${stats.commonCount} · 지정 ${stats.designatedCount}`;
  const tasks =
    status === "ended"
      ? `${stats.totalAssignments}건 중 ${stats.totalSubmissions}건 제출`
      : status === "active"
        ? `${stats.leafCount}개 · 공통 ${stats.commonCount} · 지정 ${stats.designatedCount}`
        : `${stats.leafCount}개 · ${mix}`;
  return { rounds, tasks };
}

/** rules_md → 불릿 배열 (D14: 마크다운 1필드, 프론트가 줄 단위로 분해). 줄 앞 목록 표식(-, *, +, 1., - [ ])은 뗀다 */
export const rulesOf = (md: string): string[] =>
  md
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "").trim())
    .filter(Boolean);

/** 보관된 방 표기 — 내 스터디·방 화면 공통 (시나리오 QA #6). 회차·기간 계산은 종료와 같은 규칙으로 접는다 */
export const ARCHIVED_DDAY = { short: "보관됨", long: "보관된 스터디 · 기록만 볼 수 있어요" } as const;
export const ARCHIVED_CUR: CurView = { pill: "보관됨", title: "보관된 스터디예요", meta: "기록만 볼 수 있어요 · 제출·편집은 할 수 없어요", tasks: [] };
export const ARCHIVED_ROUND_STATE = "보관됨";
/** 보관된 방이면 상태를 ended 로 접는다(진행중·D-n 이 섞이지 않게) */
export const foldArchived = <T extends { archived: boolean; status: RoomStatusDto }>(d: T): T => (d.archived && d.status !== "ended" ? { ...d, status: "ended" } : d);
