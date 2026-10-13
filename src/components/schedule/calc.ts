import { addDays, diffDays, parseISO, toISO } from "@/lib/date";
import type { Task } from "@/data/schedule";

/** 진행 중(open)이면서 내 담당인 과제만 급함으로 그린다 — 그룹장 전용(st:null → mine:false) 과제는 빼낸다 */
export const isUrgent = (t: Pick<Task, "st" | "mine">) => t.st === "open" && t.mine !== false;

/** 달력 격자: 1일이 속한 주(일요일 시작)부터 말일이 속한 주까지, 주별 7개 ISO 날짜 */
export function monthWeeks(y: number, m: number): string[][] {
  const first = Date.UTC(y, m, 1);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = new Date(first).getUTCDay();
  const rows = Math.ceil((lead + dim) / 7);
  const start = toISO(first - lead * 86400000);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)));
}

export const monthRange = (y: number, m: number) => ({
  start: toISO(Date.UTC(y, m, 1)),
  end: toISO(Date.UTC(y, m + 1, 0)),
});

/** 그 날이 속한 주의 일요일 */
export const weekStartOf = (k: string) => addDays(k, -new Date(parseISO(k)).getUTCDay());

export type Seg = {
  task: Task;
  /** 0-base 열 */
  col: number;
  span: number;
  /** 실제 시작/끝 구간인지 (주 경계에서 잘린 쪽은 false) */
  isStart: boolean;
  isEnd: boolean;
  /** 0-base 레인 */
  lane: number;
};

/**
 * 한 주(ws = 일요일) 안에 걸치는 과제를 잘라 레인에 배정.
 * 시작 열 오름차순 → 같으면 긴 것부터, 이전 막대 끝이 시작 열보다 작은 첫 레인에 그리디로.
 */
export function packWeek(tasks: Task[], ws: string): Seg[] {
  const we = addDays(ws, 6);
  const segs = tasks
    .filter((t) => t.s <= we && t.e >= ws)
    .map((t) => {
      const s = t.s > ws ? t.s : ws;
      const e = t.e < we ? t.e : we;
      return { task: t, col: diffDays(ws, s), span: diffDays(s, e) + 1, isStart: s === t.s, isEnd: e === t.e, lane: 0 };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span);
  const laneEnd: number[] = [];
  for (const sg of segs) {
    let l = laneEnd.findIndex((end) => end < sg.col);
    if (l === -1) {
      l = laneEnd.length;
      laneEnd.push(-1);
    }
    laneEnd[l] = sg.col + sg.span - 1;
    sg.lane = l;
  }
  return segs;
}
