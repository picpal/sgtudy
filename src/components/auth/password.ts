/**
 * 비밀번호 정책 — 서버(supabase/config.toml [auth] minimum_password_length = 8, password_requirements = "letters_digits",
 * 호스팅은 scripts/apply-hosted-auth.sh)의 거울. GoTrue 의 letters_digits 는 [a-zA-Z] 한 자 + [0-9] 한 자.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_RULE_TEXT = `${PASSWORD_MIN}자 이상, 영문과 숫자를 함께 써 주세요`;

export function passwordProblem(pw: string): "length" | "letters_digits" | null {
  if ([...pw].length < PASSWORD_MIN) return "length";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "letters_digits";
  return null;
}

/** 새 비밀번호 + 확인 입력 → 첫 문제 문구, 없으면 null */
export function passwordFormError(pw: string, confirm: string): string | null {
  const p = passwordProblem(pw);
  if (p === "length") return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요`;
  if (p === "letters_digits") return "비밀번호에 영문과 숫자를 함께 써 주세요";
  if (pw !== confirm) return "비밀번호 확인이 맞지 않아요";
  return null;
}
