/** KST 오늘(YYYY-MM-DD). 서버 meta_get 이 정본이고, 이건 그 호출이 실패했을 때만 쓰는 폴백이다. */
export function kstToday(now: Date = new Date()): string {
  // en-CA 로케일은 YYYY-MM-DD 로 포맷한다
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
