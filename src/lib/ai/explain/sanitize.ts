import { clampCp, cpLength } from "@/components/room-new/validate";
import { sanitizeLine, sanitizeMd } from "../rounds/sanitize";
import { normTerm } from "./normalize";
import { IN_CONTEXT_MAX, ONE_LINER_MAX, POINT_MAX, POINTS_MAX, RELATED_ITEM_MAX, RELATED_MAX, TERM_MAX, type ExplainOut } from "./schema";

/*
 * 모델 출력 정제 — 링크·이미지·HTML·헤딩·URL 제거(rounds 의 sanitizeMd), 상한 적용.
 * points·related 는 빈 값·중복·용어 자신을 뺀다. not_term 이면 본문 절을 비운다
 */
/** dropLong: 상한을 넘는 항목은 자르지 않고 버린다(관련 용어 칩 — 잘린 용어로 다시 물으면 엉뚱한 해설이 된다) */
function uniqLines(xs: string[], max: number, maxItems: number, term: string, dropLong = false): string[] {
  const out: string[] = [];
  const seen = new Set<string>([normTerm(term)]);
  for (const x of xs) {
    if (dropLong && cpLength(sanitizeLine(x, Number.MAX_SAFE_INTEGER)) > max) continue;
    const v = sanitizeLine(x, max);
    const k = normTerm(v);
    if (!v || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function sanitizeExplain(raw: ExplainOut, term: string): ExplainOut {
  const t = sanitizeLine(raw.term, TERM_MAX) || clampCp(term.replace(/\s+/g, " ").trim(), TERM_MAX);
  const oneLiner = sanitizeLine(raw.oneLiner, ONE_LINER_MAX);
  if (raw.kind === "not_term") return { kind: "not_term", term: t, oneLiner, inContext: "", points: [], related: [] };
  return {
    kind: "term",
    term: t,
    oneLiner,
    inContext: sanitizeMd(raw.inContext, IN_CONTEXT_MAX),
    points: uniqLines(raw.points, POINT_MAX, POINTS_MAX, term),
    related: uniqLines(raw.related, RELATED_ITEM_MAX, RELATED_MAX, term, true),
  };
}

/** 보기·정답 지목(응시 화면 exam_take) — 「정답은」·「오답」·「답은 B」·원 숫자·「2번 보기」·「보기 1」·「맞는 선택지」. 「2번 이상」·「대답」·「답변」은 남긴다 */
const ANSWER_HINT =
  /정답|오답|(?:^|[^가-힣])답(?:은|이|으로)(?![가-힣])|[①-⑳]|\d+\s*번\s*(?:보기|선택지)|\d+\s*번(?:이|은|을|가|이에요|예요)(?![가-힣])|(?:보기|선택지)\s*[0-9A-Ea-e]|(?:맞는|옳은|틀린|정확한)\s*(?:보기|선택지|것은|답)/;
export const TAKE_FALLBACK = "이 용어의 일반적인 뜻만 설명할 수 있어요";

const dropHintSentences = (line: string): string =>
  line
    .split(/(?<=[.!?。])\s+/)
    .filter((x) => !ANSWER_HINT.test(x))
    .join(" ")
    .trim();

/** 응시 중 해설 후처리 — 프롬프트 규칙(문제를 풀지 않는다)의 두 번째 겹. 지목한 문장·항목을 통째로 뺀다(정제 뒤에 부른다) */
export function stripAnswerHints(b: ExplainOut): ExplainOut {
  const inContext = b.inContext
    .split("\n")
    .map((l) => {
      const m = /^(\s*-\s+)?(.*)$/.exec(l)!;
      const rest = dropHintSentences(m[2]);
      return rest ? `${m[1] ?? ""}${rest}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    ...b,
    oneLiner: dropHintSentences(b.oneLiner) || TAKE_FALLBACK,
    inContext,
    points: b.points.filter((x) => !ANSWER_HINT.test(x)),
    related: b.related.filter((x) => !ANSWER_HINT.test(x)),
  };
}
