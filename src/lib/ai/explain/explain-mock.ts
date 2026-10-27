import type { CallExplain } from "./explain";
import type { ExplainOut } from "./schema";

/*
 * AI_INTERVIEW_MOCK=1 용어 해설 대본 — 키 없이 로컬·E2E 확인용. 결정적:
 * "?" 로 끝나면 not_term · "실패" 면 500 흉내 · "지연" 이면 2초 뒤 응답 · 그 밖(2자 이상)은 AWS 어투 샘플
 */
export const mockCallExplain: CallExplain = async ({ term }) => {
  const t = term.trim();
  if (t === "실패") return { ok: false, status: 500 };
  if (t === "지연") await new Promise((r) => setTimeout(r, 2000));
  const usage = { in: 0, out: 0, cached: 0 };
  if (t.endsWith("?") || [...t].length < 2) {
    const output: ExplainOut = { kind: "not_term", term: t, oneLiner: "용어가 아니라 문장이에요", inContext: "", points: [], related: [] };
    return { ok: true, output, usage, model: "mock" };
  }
  const output: ExplainOut = {
    kind: "term",
    term: t,
    oneLiner: `${t}는 이 스터디에서 자주 나오는 개념이에요(목 응답).`,
    inContext: `- AWS 네트워크 설계에서 ${t}를 어떻게 쓰는지 먼저 떠올려 보세요\n- 시험에서는 다른 서비스와 묶어서 자주 물어봐요`,
    points: [`${t}와 비슷한 이름의 개념을 헷갈리게 내는 문제가 많아요`, "범위·한도 숫자를 외워 두면 좋아요"],
    related: ["서브넷", "VPC"],
  };
  return { ok: true, output, usage, model: "mock" };
};
