import { NICK_PROBLEM_TEXT, nicknameProblem } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";

export type NickHint = { tone: "idle" | "checking" | "ok" | "bad"; text: string };
export const NICK_RULE = "2~16자 · 한글·영문·숫자·_·. · 단어 사이 공백 한 칸";

export function nicknameHint(value: string, result: NicknameCheck | null, checking: boolean, original?: string): NickHint {
  const v = value.trim();
  if (!v) return { tone: "idle", text: NICK_RULE };
  const problem = nicknameProblem(v);
  if (problem) return { tone: "bad", text: NICK_PROBLEM_TEXT[problem] };
  if (original !== undefined && v === original) return { tone: "ok", text: "지금 쓰는 닉네임이에요" };
  if (checking || !result) return { tone: "checking", text: "확인 중…" };
  if (result.available) return { tone: "ok", text: "사용할 수 있어요" };
  if (result.reason === "taken") return { tone: "bad", text: "이미 사용 중인 닉네임이에요" };
  if (result.reason === "reserved") return { tone: "bad", text: "사용할 수 없는 닉네임이에요" };
  return { tone: "bad", text: NICK_RULE };
}
