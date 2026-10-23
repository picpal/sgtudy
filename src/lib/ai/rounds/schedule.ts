import { addDays } from "../normalize";
import { MAX_ROUNDS } from "./schema";

/* 회차 표(D23·D24) — 날짜는 서버가 나눈다. 모델은 이 표에 제목·목표·과제 글만 채운다. 순수 함수 */

export type Cadence = 7 | 14;
export type ScheduleRound = { index: number; label: string; startDate: string; endDate: string };
export type Schedule = { cadenceDays: Cadence; rounds: ScheduleRound[] };

/** 꼬리 회차가 이 일수보다 짧으면 앞 회차에 합친다 */
const MIN_TAIL = 3;

export const labelFor = (i: number, cadence: Cadence) => `${i + 1}${cadence === 7 ? "주차" : "회차"}`;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 꼬리 합치기를 반영한 회차 수 — 짧은 꼬리 하루 때문에 회차가 늘거나 주기가 바뀌지 않게 */
function countFor(days: number, cadence: Cadence): number {
  const full = Math.floor(days / cadence);
  const tail = days - full * cadence;
  if (full === 0) return 1;
  return tail >= MIN_TAIL ? full + 1 : full;
}

/**
 * 방 기간을 회차로 나눈다. 7일 회차가 26개를 넘으면 14일 회차(1년 = 26회차). 마지막 회차 끝 = 종료일, 최소 1회차.
 * 회차는 빈틈없이 이어진다(다음 회차 시작 = 앞 회차 끝 + 1).
 */
export function splitRounds(start: string, end: string): Schedule {
  const days = Math.max(1, daysBetween(start, end) + 1);
  let cadenceDays: Cadence = 7;
  let n = countFor(days, 7);
  if (n > MAX_ROUNDS) {
    cadenceDays = 14;
    n = Math.min(MAX_ROUNDS, countFor(days, 14));
  }
  const rounds: ScheduleRound[] = [];
  for (let i = 0; i < n; i++) {
    const s = addDays(start, i * cadenceDays);
    rounds.push({ index: i, label: labelFor(i, cadenceDays), startDate: s, endDate: i === n - 1 ? end : addDays(s, cadenceDays - 1) });
  }
  return { cadenceDays, rounds };
}
