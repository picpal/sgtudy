import { CAPTCHA_FAILED_TEXT } from "./captcha";

export type Digits = [string, string, string, string, string, string];
export const EMPTY_DIGITS: Digits = ["", "", "", "", "", ""];

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function applyDigit(digits: Digits, index: number, raw: string): { digits: Digits; focus: number } {
  const d = onlyDigits(raw);
  if (!d) return { digits, focus: index };
  // one-time-code 자동완성은 6자리 전체를 onChange 로 한 칸에 넣는다 → 붙여넣기처럼 0번 칸부터 채운다
  if (d.length >= 6) return applyPaste(digits, d, 0);
  const next = [...digits] as Digits;
  next[index] = d[d.length - 1];
  return { digits: next, focus: Math.min(5, index + 1) };
}

export function applyPaste(digits: Digits, text: string, from: number): { digits: Digits; focus: number } {
  const d = onlyDigits(text).slice(0, 6 - from);
  if (!d) return { digits, focus: from };
  const next = [...digits] as Digits;
  for (let i = 0; i < d.length; i++) next[from + i] = d[i];
  return { digits: next, focus: Math.min(5, from + d.length - 1) };
}

export function applyBackspace(digits: Digits, index: number): { digits: Digits; focus: number } {
  const next = [...digits] as Digits;
  if (next[index]) {
    next[index] = "";
    return { digits: next, focus: index };
  }
  const prev = Math.max(0, index - 1);
  next[prev] = "";
  return { digits: next, focus: prev };
}

export const isComplete = (d: Digits) => d.every((c) => c.length === 1);

const AUTH_CODE_TEXT: Record<string, string> = {
  over_email_send_rate_limit: "잠시 후 다시 시도해 주세요 · 인증 코드는 1분에 한 번만 보낼 수 있어요",
  over_request_rate_limit: "요청이 너무 많아요 · 잠시 후 다시 시도해 주세요",
  // GoTrue 는 틀린 코드에도 otp_expired 를 준다
  otp_expired: "코드가 맞지 않거나 만료됐어요",
  otp_disabled: "이메일 로그인이 꺼져 있어요 · 관리자에게 문의해 주세요",
  validation_failed: "이메일 주소를 확인해 주세요",
  email_address_invalid: "이메일 주소를 확인해 주세요",
  invalid_credentials: "이메일 또는 비밀번호가 맞지 않아요",
  email_not_confirmed: "이메일 인증이 끝나지 않은 계정이에요 · 회원가입에서 인증해 주세요",
  weak_password: "비밀번호는 8자 이상, 영문과 숫자를 함께 써 주세요",
  same_password: "지금 쓰는 비밀번호와 다른 비밀번호를 정해 주세요",
  // 비밀번호 변경 재인증(config.toml secure_password_change = true)
  reauthentication_not_valid: "코드가 맞지 않거나 만료됐어요",
  reauth_nonce_missing: "보안을 위해 이메일 인증 코드를 입력해 주세요",
  reauthentication_needed: "보안을 위해 이메일 인증을 다시 해 주세요",
  // CAPTCHA(Turnstile): 토큰이 없거나·만료·이미 쓴 토큰이면 GoTrue 가 400 captcha_failed
  captcha_failed: CAPTCHA_FAILED_TEXT,
};

/** 비밀번호 재설정은 계정을 만들지 않는다(shouldCreateUser: false) — 없는 주소도 계정 존재를 드러내지 않는 같은 문구 */
const NO_ACCOUNT_TEXT = "가입된 계정이 없거나 코드를 보낼 수 없어요";
// GoTrue: 없는 주소 + create_user false → 422 otp_disabled "Signups not allowed for otp"
const RESET_NO_ACCOUNT_CODES = ["otp_disabled", "user_not_found", "signup_disabled"];
const RESET_CODE_TEXT: Record<string, string> = Object.fromEntries(RESET_NO_ACCOUNT_CODES.map((c) => [c, NO_ACCOUNT_TEXT]));

/**
 * 재설정 코드 발송이 "없는 주소" 로 실패했는지. 화면은 이 경우도 보낸 것처럼 코드 단계로 넘어가
 * 계정 존재를 드러내지 않는다(남는 위험: GoTrue /otp 를 직접 부르면 422/200 이 구분된다 — README).
 */
export function isResetNoAccount(e: unknown): boolean {
  return typeof e === "object" && e !== null && RESET_NO_ACCOUNT_CODES.includes(String((e as { code?: unknown }).code));
}

export const errorCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;

export type AuthFlow = "login" | "signup" | "reset" | "change";

/** 코드로 못 옮긴 실패의 머리말 — 가입·재설정·변경 화면에 "로그인에 실패했어요" 가 뜨지 않게 흐름별로 */
const FAIL_TEXT: Record<AuthFlow, string> = {
  login: "로그인에 실패했어요",
  signup: "회원가입을 진행하지 못했어요",
  reset: "비밀번호 재설정을 진행하지 못했어요",
  change: "비밀번호를 바꾸지 못했어요",
};
export const NETWORK_TEXT = "인터넷 연결을 확인하고 다시 시도해 주세요";
const UNAVAILABLE_TEXT = "서버에 잠시 연결할 수 없어요 · 잠시 후 다시 시도해 주세요";

/**
 * supabase-js 는 fetch 자체가 실패하면 AuthRetryableFetchError(status 0, "Failed to fetch"),
 * 502/503/504 면 같은 이름에 그 status 를 준다. 우리 API(fetchMe)는 TypeError 를 그대로 던질 수 있다.
 */
function networkText(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const { name, status, message } = e as { name?: unknown; status?: unknown; message?: unknown };
  if (name === "AuthRetryableFetchError") return status === 0 || status === undefined ? NETWORK_TEXT : UNAVAILABLE_TEXT;
  if (e instanceof TypeError && /fetch|network|load failed/i.test(String(message))) return NETWORK_TEXT;
  return null;
}

/** supabase-js AuthApiError { code } → 문구. 네트워크 실패는 연결 안내, 그 외는 흐름별 머리말에 원문을 붙인다(Review Focus 4). */
export function authErrorMessage(e: unknown, flow: AuthFlow = "login"): string {
  if (typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const code = (e as { code: string }).code;
    const known = (flow === "reset" && RESET_CODE_TEXT[code]) || AUTH_CODE_TEXT[code];
    if (known) return known;
  }
  const net = networkText(e);
  if (net) return net;
  if (e instanceof Error && e.message) return `${FAIL_TEXT[flow]} · ${e.message}`;
  return FAIL_TEXT[flow];
}

export const RESEND_SEC = 60;

/**
 * 코드 발송 빈도 제한(over_email_send_rate_limit)이면 다시 받을 수 있을 때까지 남은 초, 아니면 null.
 * GoTrue 는 "...only request this after N seconds." 로 초를 알려 준다. 없으면 우리가 보낸 시각(sentAt, ms) 기준, 그것도 없으면 1분.
 */
export function rateLimitWait(e: unknown, sentAt: number | null, now: number): number | null {
  if (typeof e !== "object" || e === null || (e as { code?: unknown }).code !== "over_email_send_rate_limit") return null;
  const m = /(\d+)\s*seconds?/.exec(String((e as { message?: unknown }).message ?? ""));
  if (m) return Number(m[1]);
  if (sentAt !== null) return Math.max(1, Math.ceil(RESEND_SEC - (now - sentAt) / 1000));
  return RESEND_SEC;
}
