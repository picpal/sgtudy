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
};

/** supabase-js AuthApiError { code } → 문구. 그 외는 원문을 붙인다(Review Focus 4). */
export function authErrorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const known = AUTH_CODE_TEXT[(e as { code: string }).code];
    if (known) return known;
  }
  if (e instanceof Error) return `로그인에 실패했어요 · ${e.message}`;
  return "로그인에 실패했어요";
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
