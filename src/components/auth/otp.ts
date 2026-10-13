export type Digits = [string, string, string, string, string, string];
export const EMPTY_DIGITS: Digits = ["", "", "", "", "", ""];

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function applyDigit(digits: Digits, index: number, raw: string): { digits: Digits; focus: number } {
  const d = onlyDigits(raw);
  if (!d) return { digits, focus: index };
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
  otp_expired: "인증 코드가 만료됐어요 · 다시 받아 주세요",
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
