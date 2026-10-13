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

const NICK_RE = /^[\p{Script=Hangul}A-Za-z0-9_. ]+$/u;

/** 03-api §1: 2~16자, 한글·영문·숫자·_·.·공백(연속 불가). 금칙어·중복은 서버(nickname_check)가 판정한다. */
export function nicknameProblem(value: string): "length" | "chars" | "spaces" | null {
  const v = value.trim();
  if (v.length < 2 || v.length > 16) return "length";
  if (!NICK_RE.test(v)) return "chars";
  if (/ {2,}/.test(v)) return "spaces";
  return null;
}

export const NICK_PROBLEM_TEXT: Record<NonNullable<ReturnType<typeof nicknameProblem>>, string> = {
  length: "2~16자로 입력해 주세요",
  chars: "한글·영문·숫자·_·. 만 쓸 수 있어요",
  spaces: "공백은 연속으로 쓸 수 없어요",
};
