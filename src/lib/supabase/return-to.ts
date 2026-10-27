/** 로그인 필요 라우트(D6). `/rooms/[slug]` 는 공개라 `/rooms/new` 만 정확히 잡는다. */
export const PROTECTED_PREFIXES = ["/my-study", "/schedule", "/tasks", "/me", "/rooms/new", "/join"] as const;

/** returnTo 로 허용하는 접두사(03-api §1). 그 외는 전부 "/". */
const RETURN_TO_PREFIXES = ["/rooms/", "/my-study", "/schedule", "/tasks", "/invite/"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  // 절대 URL·프로토콜 상대·백슬래시·상위 경로·공백/제어문자 전부 거부 (오픈 리다이렉트 차단)
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw) || raw.includes("..")) return "/";
  // 인코딩된 점·슬래시(%2e·%2f)도 거부 — 브라우저가 풀어서 허용 접두사 밖으로 나간다(/rooms/%2e%2e/me → /me)
  if (/%2e|%2f/i.test(raw)) return "/";
  // "/join" 은 접두사로 두면 /joinx 도 통과하므로 정확히 /join, /join?…, /join/… 만 허용한다
  const isJoin = raw === "/join" || raw.startsWith("/join?") || raw.startsWith("/join/");
  if (!isJoin && !RETURN_TO_PREFIXES.some((p) => raw === p || raw.startsWith(p))) return "/";
  return raw;
}

/** 로그인 화면 안내 사유 — 고아 세션(계정이 지워졌는데 쿠키만 남음)을 정리하고 보낼 때 붙인다 */
export const SESSION_EXPIRED = "session_expired";
/** 로그인 화면 안내 사유 — 오래 안 써서 서버가 세션을 지웠고(0050 pg_cron) proxy 의 refresh 가 거절됐을 때 붙인다 */
export const SESSION_INACTIVE = "session_inactive";

export type LoginReason = typeof SESSION_EXPIRED | typeof SESSION_INACTIVE;
const LOGIN_REASONS: readonly string[] = [SESSION_EXPIRED, SESSION_INACTIVE];

/** ?reason= 값 검증 — 허용 목록 밖(임의 문자열·배열)은 null */
export function parseLoginReason(raw: unknown): LoginReason | null {
  return typeof raw === "string" && LOGIN_REASONS.includes(raw) ? (raw as LoginReason) : null;
}

export function loginUrl(returnTo: string, reason?: LoginReason): string {
  const q = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return reason ? `${q}&reason=${reason}` : q;
}

/** 고아 세션 정리 라우트(src/app/auth/session-expired/route.ts). 서버 컴포넌트는 쿠키를 못 지우므로 여기로 보낸다 */
export function sessionExpiredUrl(returnTo: string): string {
  return `/auth/session-expired?returnTo=${encodeURIComponent(returnTo)}`;
}
