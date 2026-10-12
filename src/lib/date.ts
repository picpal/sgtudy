/** 'YYYY-MM-DD' 문자열 기반 날짜 유틸. 모든 계산은 UTC. */

export const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (s: string, n: number) => toISO(parseISO(s) + n * 86400000);

export const diffDays = (from: string, to: string) =>
  Math.round((parseISO(to) - parseISO(from)) / 86400000);

/** D-day 표기: 0 → D-DAY, 양수 → D-n, 지난 날 → D+n */
export const dday = (today: string, target: string) => {
  const n = diffDays(today, target);
  if (n === 0) return "D-DAY";
  return n > 0 ? `D-${n}` : `D+${-n}`;
};

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export const weekdayKo = (s: string) => WEEKDAY_KO[new Date(parseISO(s)).getUTCDay()];

/** "10.04" — 월은 0 없이, 일은 두 자리 */
export const md = (s: string) => {
  const d = new Date(parseISO(s));
  return `${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, "0")}`;
};
