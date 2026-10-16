import { addDays, diffDays, parseISO, toISO } from "@/lib/date";
import { PERSONAL_LABEL, STATUS_CODE } from "@/components/my-study/model";
import { PERSONAL_LOOK } from "@/lib/palette";
import { STATUS_LABEL } from "@/lib/types";
import { routes } from "@/lib/routes";
import type { Study, Task } from "@/data/schedule";

/** 진행 중(open)이면서 내 담당인 과제만 급함으로 그린다 — 그룹장 전용(st:null → mine:false) 과제는 빼낸다 */
export const isUrgent = (t: Pick<Task, "st" | "mine">) => t.st === "open" && t.mine !== false;

/**
 * 내 일정 막대 모양. 시작 전(planned) 팀 과제도 흰 바탕 + 점선이라, 개인 목표는 굵기(1.5px)·slate 색·[개인] 배지로 구분한다.
 * 임박(진행 중·내 것)은 굵은 글자 — 팀 과제는 1.5px 실선을 더하고, 개인은 점선을 유지한다.
 */
export function barLook(t: Pick<Task, "st" | "mine" | "personal">, S: Pick<Study, "bg" | "fg" | "dot" | "pending">): { fill: string; color: string; line: string; weight: number; badge: boolean } {
  const urgent = isUrgent(t);
  const weight = urgent ? 700 : 500;
  if (t.personal) return { ...PERSONAL_LOOK, weight, badge: true };
  const planned = t.st === "planned";
  const fill = S.pending ? `repeating-linear-gradient(135deg, ${S.bg} 0 6px, #FFFFFF 6px 10px)` : planned ? "#FFFFFF" : S.bg;
  const line = S.pending ? `1px solid ${S.dot}` : planned ? `1px dashed ${S.dot}` : urgent ? `1.5px solid ${S.dot}` : "1px solid transparent";
  return { fill, color: S.fg, line, weight, badge: false };
}

/** 상태 문구 — 개인 목표는 "완료" 문구(model.PERSONAL_LABEL, 내 과제·진행목표와 같은 출처), 팀 과제는 제출 문구 */
export const statusLabel = (t: Pick<Task, "st" | "personal">): string => (t.personal ? PERSONAL_LABEL[STATUS_CODE[t.st]] : STATUS_LABEL[t.st]);

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

/** 달을 옮겼을 때의 선택일 — 그 달에 오늘이 있으면 오늘, 아니면 그 달 1일 */
export const monthSel = (y: number, m: number, today: string) => {
  const first = toISO(Date.UTC(y, m, 1));
  return today.slice(0, 7) === first.slice(0, 7) ? today : first;
};

/** 과제 막대·일 패널·다가오는 마감 → 내 스터디의 그 리프(?task=). 승인 대기 스터디는 공개 방 화면으로 */
export const taskHref = (t: Pick<Task, "id" | "study">, s: Pick<Study, "pending">) =>
  s.pending ? routes.room(t.study) : `${routes.myStudy(t.study)}?task=${encodeURIComponent(t.id)}`;

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
