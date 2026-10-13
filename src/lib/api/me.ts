import { rpc } from "@/lib/api/errors";
import type { Me, NicknameCheck } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/client";

export const fetchMe = () => rpc<Me>("me_get");

export const updateMe = (patch: { nickname?: string; optionalMailEnabled?: boolean }) =>
  rpc<Me>("me_update", { p_nickname: patch.nickname ?? null, p_optional_mail_enabled: patch.optionalMailEnabled ?? null });

export const checkNickname = (value: string) => rpc<NicknameCheck>("nickname_check", { p_value: value });

export async function signOut(): Promise<void> {
  const { error } = await createClient().auth.signOut();
  if (error) throw error;
}

const NICK_RE = /^[가-힣A-Za-z0-9._]+( [가-힣A-Za-z0-9._]+)*$/;

/**
 * 0002 nickname_problem 의 거울: NFC 후 trim 없이 검사, 2~16자(코드포인트), 완성형 한글[가-힣]·영문·숫자·_·.,
 * 단어 사이 단일 공백. 서버는 전부 'invalid' 하나로 답하지만 안내 문구를 위해 갈래를 나눈다.
 * 호출부는 value.trim() 을 넘긴다. 금칙어·중복은 서버(nickname_check)가 판정한다.
 */
export function nicknameProblem(value: string): "length" | "chars" | "spaces" | "jamo" | "invalid" | null {
  const v = value.normalize("NFC");
  if (v.startsWith(" ") || v.endsWith(" ")) return "invalid";
  const len = [...v].length;
  if (len < 2 || len > 16) return "length";
  if (NICK_RE.test(v)) return null;
  if (/ {2,}/.test(v)) return "spaces";
  if (/(?![가-힣])\p{Script=Hangul}/u.test(v)) return "jamo"; // 완성형이 아닌 한글 자모 (ㅋㅋ)
  return "chars";
}

export const NICK_PROBLEM_TEXT: Record<NonNullable<ReturnType<typeof nicknameProblem>>, string> = {
  length: "2~16자로 입력해 주세요",
  chars: "한글·영문·숫자·_·. 와 단어 사이 공백 한 칸만 쓸 수 있어요",
  spaces: "공백은 연속으로 쓸 수 없어요",
  jamo: "ㅋ·ㅏ 같은 자모 말고 완성된 한글로 입력해 주세요",
  invalid: "앞뒤에 공백을 둘 수 없어요",
};
