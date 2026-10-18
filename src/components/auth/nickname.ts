import { NICK_PROBLEM_TEXT, nicknameProblem } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";

export type NickHint = { tone: "idle" | "checking" | "ok" | "bad"; text: string };
/** 입력창은 이 길이까지만 막고(붙여넣기 등 과한 입력), 16자 초과는 글자 수와 함께 안내한다 */
export const NICK_MAX = 16;
export const NICK_INPUT_MAX = 32;
export const NICK_RULE = "2~16자 · 한글·영문·숫자·_·. · 단어 사이 공백 한 칸";

export function nicknameHint(value: string, result: NicknameCheck | null, checking: boolean, original?: string): NickHint {
  const v = value.trim();
  if (!v) return { tone: "idle", text: NICK_RULE };
  const problem = nicknameProblem(v);
  const len = [...v.normalize("NFC")].length;
  if (problem === "length" && len > NICK_MAX) return { tone: "bad", text: `${NICK_MAX}자까지 쓸 수 있어요 (지금 ${len}자)` };
  if (problem) return { tone: "bad", text: NICK_PROBLEM_TEXT[problem] };
  if (original !== undefined && v === original) return { tone: "ok", text: "지금 쓰는 닉네임이에요" };
  if (checking || !result) return { tone: "checking", text: "확인 중…" };
  if (result.available) return { tone: "ok", text: "사용할 수 있어요" };
  if (result.reason === "taken") return { tone: "bad", text: "이미 사용 중인 닉네임이에요" };
  if (result.reason === "reserved") return { tone: "bad", text: "사용할 수 없는 닉네임이에요" };
  return { tone: "bad", text: NICK_RULE };
}

/** "a.b" 처럼 붙인 뒤에도 규칙(nicknameProblem)에 맞게 — 앞부분을 글자 단위로 줄이고 끝 공백은 뺀다 */
const fit = (base: string, suffix: string): string => {
  const room = NICK_MAX - [...suffix].length;
  return [...base].slice(0, room).join("").trimEnd() + suffix;
};

/**
 * 닉네임이 이미 쓰일 때 내놓을 후보 (시나리오 QA D4·#22) — 숫자·_숫자·.숫자 를 붙인다. 규칙에 맞는 것만, 서로 다르게.
 * 쓸 수 있는지는 pickAvailable 이 기존 nickname_check 로 확인한다. rand 는 테스트용.
 */
export function nicknameCandidates(base: string, rand: () => number = Math.random): string[] {
  const b = base.trim().normalize("NFC");
  if (nicknameProblem(b)) return [];
  const n2 = () => String(10 + Math.floor(rand() * 90)); // 10~99
  const raw = [fit(b, String(2 + Math.floor(rand() * 8))), fit(b, `_${n2()}`), fit(b, `.${n2()}`), fit(b, n2()), fit(b, `_${n2()}`), fit(b, `.${n2()}`)];
  return [...new Set(raw)].filter((x) => x !== b && nicknameProblem(x) === null);
}

/** 후보 중 쓸 수 있는 것만 순서대로 최대 max 개 — 확인이 실패한 후보는 뺀다. max 개씩 나눠 묻고 다 찾으면 멈춘다(요청 수를 줄인다) */
export async function pickAvailable(cands: string[], check: (v: string) => Promise<NicknameCheck>, max = 3): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < cands.length && out.length < max; i += max) {
    const batch = cands.slice(i, i + max);
    const rs = await Promise.all(batch.map((c) => check(c).then((r) => r.available, () => false)));
    out.push(...batch.filter((_, j) => rs[j]));
  }
  return out.slice(0, max);
}
