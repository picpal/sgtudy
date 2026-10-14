/** 가입·재설정 흐름의 순수 상태 도우미 (OtpPasswordFlow) */

/**
 * 비밀번호를 정한 계정 표시. GoTrue 는 "비밀번호가 있는지" 를 클라이언트에 알려 주지 않으므로,
 * 비밀번호를 정하는 모든 경로(가입·재설정·/me 변경·scripts/master-user.sh)가 user_metadata 에 이 값을 같이 쓴다.
 */
export const HAS_PASSWORD_KEY = "has_password";

type AuthUserLike = { created_at?: string; user_metadata?: Record<string, unknown> | null };

/** 가입 코드 확인 직후 계정 종류: 새 계정 / 코드로만 쓰던 기존 계정 / 이미 비밀번호가 있는 계정 */
export function signupAccountKind(user: AuthUserLike, now: number): "new" | "existing" | "has_password" {
  if (user.user_metadata?.[HAS_PASSWORD_KEY] === true) return "has_password";
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  // 가입 코드 발송이 계정을 만든다 — 코드 유효시간(10분) + 여유 안에 만들어졌으면 이번 가입으로 본다
  if (Number.isFinite(created) && now - created < 15 * 60_000) return "new";
  return "existing";
}

/** 코드 확인 뒤 상태: 가입은 signupAccountKind 결과, 재설정은 "reset" */
export type Verified = ReturnType<typeof signupAccountKind> | "reset";

/** 화면 단계: 확인이 끝났으면 안내/비밀번호, 아니면 ?step=code 히스토리 항목 + 보낸 주소가 있을 때만 코드 입력 */
export function otpFlowStep(verified: Verified | null, codeParam: boolean, sentTo: string | null): "email" | "otp" | "password" | "notice" {
  if (verified) return verified === "has_password" ? "notice" : "password";
  return codeParam && sentTo ? "otp" : "email";
}

/**
 * 로그인한 채로 /signup·/reset-password 에 들어왔을 때(코드 확인 뒤 비밀번호를 정하기 전에 탭을 닫거나 새로고침한 경우).
 * 비밀번호가 없으면 그 단계로 다시 보내고(가입은 계정 나이로 새/기존 문구, 재설정은 "reset"), 있으면 null → 페이지가 returnTo 로 보낸다.
 */
export function resumeVerified(user: AuthUserLike, mode: "signup" | "reset", now = Date.now()): Exclude<Verified, "has_password"> | null {
  const kind = signupAccountKind(user, now);
  if (kind === "has_password") return null;
  return mode === "reset" ? "reset" : kind;
}
