/**
 * 비밀번호 정책 — 서버(supabase/config.toml [auth] minimum_password_length = 8, password_requirements = "letters_digits",
 * 호스팅은 scripts/apply-hosted-auth.sh)의 거울. GoTrue 의 letters_digits 는 [a-zA-Z] 한 자 + [0-9] 한 자.
 */
export const PASSWORD_MIN = 8;
/** bcrypt 는 72 byte 까지만 쓴다(GoTrue 는 넘으면 거절) — 글자 수가 아니라 UTF-8 byte 로 센다 */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_RULE_TEXT = `${PASSWORD_MIN}자 이상, 영문과 숫자를 함께 써 주세요`;

export const PASSWORD_MISMATCH_TEXT = "비밀번호가 서로 달라요";

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export function passwordProblem(pw: string): "length" | "too_long" | "letters_digits" | null {
  if ([...pw].length < PASSWORD_MIN) return "length";
  if (utf8Bytes(pw) > PASSWORD_MAX_BYTES) return "too_long";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "letters_digits";
  return null;
}

/** 새 비밀번호 + 확인 입력 → 첫 문제 문구, 없으면 null */
export function passwordFormError(pw: string, confirm: string): string | null {
  const p = passwordProblem(pw);
  if (p === "length") return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요`;
  if (p === "too_long") return "비밀번호가 너무 길어요 · 영문·숫자 기준 72자(한글은 24자)까지 쓸 수 있어요";
  if (p === "letters_digits") return "비밀번호에 영문과 숫자를 함께 써 주세요";
  if (pw !== confirm) return PASSWORD_MISMATCH_TEXT;
  return null;
}
