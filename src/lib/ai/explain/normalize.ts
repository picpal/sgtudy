import { clampCp, cpLength } from "@/components/room-new/validate";
import { stripControl } from "../normalize";
import { CONTEXT_MAX, TERM_MAX } from "./schema";

/* 용어 정규화(D2·D8·D13) — 서버 캐시 키와 클라이언트 선택 판정이 같은 규칙을 쓴다. 클라이언트도 import 하므로 server-only·crypto 금지 */

const EDGE = new Set([..."\"'“”‘’«»()[]{}<>「」『』.,:;!?…·"]);
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">", "「": "」", "『": "』", "“": "”", "‘": "’", "«": "»", '"': '"', "'": "'" };
const OPENERS = new Set(Object.keys(PAIRS));
const CLOSERS = new Map(Object.entries(PAIRS).map(([o, c]) => [c, o]));

const squash = (s: string) => stripControl(s).normalize("NFKC").replace(/\s+/g, " ").trim();

/** 앞뒤 따옴표·괄호·문장부호를 걷는다. 안쪽에 짝이 있는 괄호(예: "AWS(Amazon)")의 닫는 괄호는 남긴다 */
function stripEdges(s: string): string {
  let cps = [...s];
  for (let guard = 0; guard < 200 && cps.length; guard++) {
    const first = cps[0];
    const last = cps[cps.length - 1];
    if (cps.length >= 2 && OPENERS.has(first) && PAIRS[first] === last) {
      cps = cps.slice(1, -1);
    } else if (EDGE.has(first) && !(OPENERS.has(first) && cps.slice(1).includes(PAIRS[first]))) {
      cps = cps.slice(1);
    } else if (EDGE.has(last) && !(CLOSERS.has(last) && cps.slice(0, -1).includes(CLOSERS.get(last)!))) {
      cps = cps.slice(0, -1);
    } else break;
    cps = [...cps.join("").trim()];
  }
  return cps.join("");
}

/** 자르기 전 정규화 결과 — 길이 판정용 */
const normFull = (s: string) => stripEdges(squash(s)).toLowerCase();

/** 캐시 키·세션 메모리 키의 원문: 제어문자 제거 → NFKC → 공백 하나로 → 앞뒤 부호 제거 → 소문자 → 40cp */
export function normTerm(s: string): string {
  return clampCp(normFull(s), TERM_MAX);
}

/** 용어로 받을 길이인가(D2): 정규화 뒤 1~40cp, 줄바꿈 ≤ 1 */
export function isTermLength(s: string): boolean {
  const breaks = (stripControl(s).match(/\r\n|\r|\n/g) ?? []).length;
  if (breaks > 1) return false;
  const n = cpLength(normFull(s));
  return n >= 1 && n <= TERM_MAX;
}

/** 선택 주변 문맥(D8): 공백 정리 뒤 용어 첫 위치 기준 앞뒤 150cp(전체 ≤ 300cp). 용어가 없으면 앞 300cp */
export function clipContext(s: string, term: string): string {
  const text = squash(s);
  const cps = [...text];
  if (cps.length <= CONTEXT_MAX) return text;
  const t = squash(term);
  let idx = t ? text.indexOf(t) : -1;
  if (idx < 0 && t) idx = text.toLowerCase().indexOf(t.toLowerCase());
  if (idx < 0) return cps.slice(0, CONTEXT_MAX).join("").trim();
  const pos = cpLength(text.slice(0, idx));
  const half = CONTEXT_MAX / 2;
  let start = Math.max(0, pos - half);
  const end = Math.min(cps.length, start + CONTEXT_MAX);
  start = Math.max(0, end - CONTEXT_MAX);
  return cps.slice(start, end).join("").trim();
}
