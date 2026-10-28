import { clipContext, isTermLength } from "@/lib/ai/explain/normalize";
import { SOURCES, type Source } from "@/lib/ai/explain/schema";

/*
 * 지금 선택을 「AI에게 물어보기」 후보로 읽는다(D1·D2·D8). 순수 — document 만 받는다(jsdom 테스트).
 * 허용 = data-ask-ai="<source>" 컨테이너 안, anchor·focus 가 같은 컨테이너. 그 안이라도 제외 영역(off·입력·편집·코드·버튼)이면 없음
 */

/** tooLong = 허용 영역 안이지만 용어 길이(D2)를 넘은 선택 — 알약 대신 「40자 이하로」 안내만 띄운다(묻지 않는다) */
export type SelectionPick = { term: string; source: Source; context: string; rect: DOMRect; container: HTMLElement; tooLong?: boolean };

export const BLOCK_SEL = "p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote";
export const DENY_SEL = '[data-ask-ai="off"],input,textarea,[contenteditable=""],[contenteditable="true"],pre,code,button';
export const ALLOW_SEL = '[data-ask-ai]:not([data-ask-ai="off"])';

const elOf = (n: Node | null): Element | null => (!n ? null : n.nodeType === 1 ? (n as Element) : n.parentElement);

/** 제외 영역: 컨테이너 안쪽(또는 컨테이너 자신 아래)에 있는 DENY 조상. 컨테이너 바깥의 off 는 이미 ALLOW 판정에서 걸러진다 */
function denied(el: Element, container: Element): boolean {
  const d = el.closest(DENY_SEL);
  return !!d && container.contains(d);
}

export function readSelection(doc: Document): SelectionPick | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount !== 1 || sel.isCollapsed) return null;
  const a = elOf(sel.anchorNode);
  const f = elOf(sel.focusNode);
  if (!a || !f) return null;
  const ca = a.closest<HTMLElement>(ALLOW_SEL);
  const cf = f.closest<HTMLElement>(ALLOW_SEL);
  if (!ca || ca !== cf) return null;
  // off 가 허용 컨테이너를 감싸면(예: 응시 중 문항 안 MarkdownView 에 다른 속성이 붙어도) 막는다
  if (ca.closest('[data-ask-ai="off"]')) return null;
  const source = ca.dataset.askAi as Source;
  if (!(SOURCES as readonly string[]).includes(source)) return null;
  if (denied(a, ca) || denied(f, ca)) return null;
  const range = sel.getRangeAt(0);
  // 선택 범위 안에 제외 영역이 통째로 들어 있는 경우(앞 문단 ~ 코드 블록 ~ 뒤 문단)도 막는다
  const frag = range.cloneContents();
  if (frag.querySelector?.(DENY_SEL)) return null;
  const term = sel.toString();
  if (!term.trim()) return null;
  if (!isTermLength(term)) return { term: "", source, context: "", rect: range.getBoundingClientRect(), container: ca, tooLong: true };
  const block = a.closest(BLOCK_SEL);
  const ctxSrc = block && ca.contains(block) ? block.textContent : ca.textContent;
  const context = clipContext(ctxSrc ?? "", term);
  return { term: term.replace(/\s+/g, " ").trim(), source, context, rect: range.getBoundingClientRect(), container: ca };
}
