import { clampCp, cpLength } from "@/components/room-new/validate";
import { sanitizeLine, sanitizeMd } from "../rounds/sanitize";
import { normTerm } from "./normalize";
import { IN_CONTEXT_MAX, ONE_LINER_MAX, POINT_MAX, POINTS_MAX, RELATED_ITEM_MAX, RELATED_MAX, TERM_MAX, type ExplainOut } from "./schema";

/*
 * 모델 출력 정제(D7·§5.2) — 링크·이미지·HTML·헤딩·URL 제거(rounds 의 sanitizeMd), 상한 적용.
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
