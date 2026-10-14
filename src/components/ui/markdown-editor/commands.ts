/**
 * 툴바·단축키 서식 명령 — 문서 문자열과 선택 범위만 받아 "무엇을 바꿀지"를 돌려주는 순수 함수.
 * CodeMirror 의존이 없어 vitest 로 바로 검증한다. 뷰에 적용하는 건 cm.ts 의 run().
 * work-note(frontend/src/editor/cm.ts 의 wrap/prefix/heading/block)를 이식하면서 토글·다중 줄을 보탰다.
 */
import { serializeGfmTable } from "@/lib/markdown/gfmTable";

export type Change = { from: number; to: number; insert: string };
export type Edit = { changes: Change[]; anchor: number; head?: number };

type Line = { from: number; to: number; text: string };

/** pos 가 속한 줄 */
export function lineAt(doc: string, pos: number): Line {
  const from = doc.lastIndexOf("\n", pos - 1) + 1;
  const nl = doc.indexOf("\n", pos);
  const to = nl === -1 ? doc.length : nl;
  return { from, to, text: doc.slice(from, to) };
}

/** [from, to] 선택이 걸친 줄들 (끝이 줄 맨 앞이면 그 줄은 뺀다 — 여러 줄 드래그의 흔한 모양) */
export function linesIn(doc: string, from: number, to: number): Line[] {
  const out: Line[] = [];
  let l = lineAt(doc, from);
  for (;;) {
    out.push(l);
    if (l.to >= to || l.to >= doc.length) break;
    const next = lineAt(doc, l.to + 1);
    if (next.from === to && to > from) break;
    l = next;
  }
  return out;
}

/** 줄 맨 앞부터 잡힌 선택이면 블록 표식(#, >, -, 1., - [ ])은 빼고 글자만 감싼다 — Shift+Home 선택이 흔하다 */
const BLOCK_MARK = /^(?:\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+))+/;
function skipLineMark(doc: string, from: number, to: number): number {
  const line = lineAt(doc, from);
  if (from !== line.from) return from;
  const m = BLOCK_MARK.exec(line.text);
  return m ? Math.min(from + m[0].length, Math.max(from, to)) : from;
}

/** pos 에서 dir 쪽으로 이어진 ch 개수 */
function runOf(s: string, pos: number, dir: 1 | -1, ch: string): number {
  let n = 0;
  for (let i = dir === 1 ? pos : pos - 1; i >= 0 && i < s.length && s[i] === ch; i += dir) n++;
  return n;
}

/** 굵게·기울임·취소선·인라인 코드 — 선택을 left/right 로 감싼다. 이미 감싸져 있으면 벗긴다(토글). */
export function wrapInline(doc: string, start: number, to: number, left: string, right: string, placeholder: string): Edit {
  const from = skipLineMark(doc, start, to);
  const sel = doc.slice(from, to);
  // 기울임(*)은 굵게(**)와 글자를 나눠 쓴다 — 붙은 * 가 홀수 개(*, ***)일 때만 기울임으로 본다. **굵게** 안쪽에 기울임을 누르면 ***굵게*** 가 된다
  const italic = left === "*" && right === "*";
  const outer = italic ? runOf(doc, from, -1, "*") % 2 === 1 && runOf(doc, to, 1, "*") % 2 === 1 : true;
  const inner = italic ? runOf(sel, 0, 1, "*") % 2 === 1 && runOf(sel, sel.length, -1, "*") % 2 === 1 : true;
  // 선택 바깥에 표식이 붙어 있음: **|굵게|**
  if (outer && doc.slice(from - left.length, from) === left && doc.slice(to, to + right.length) === right && from - left.length >= 0) {
    return {
      changes: [{ from: from - left.length, to: to + right.length, insert: sel }],
      anchor: from - left.length,
      head: to - left.length,
    };
  }
  // 선택 안쪽이 표식으로 시작·끝남: |**굵게**|
  if (inner && sel.length >= left.length + right.length && sel.startsWith(left) && sel.endsWith(right)) {
    const inner = sel.slice(left.length, sel.length - right.length);
    return { changes: [{ from, to, insert: inner }], anchor: from, head: from + inner.length };
  }
  const text = sel || placeholder;
  return {
    changes: [{ from, to, insert: left + text + right }],
    anchor: from + left.length,
    head: from + left.length + text.length,
  };
}

/** 링크 — 선택(없으면 자리 글자)을 [글자](https://) 로 만들고 주소 부분을 선택해 바로 입력하게 한다 */
export function link(doc: string, start: number, to: number): Edit {
  const from = skipLineMark(doc, start, to);
  const sel = doc.slice(from, to);
  if (/^https?:\/\/\S+$/.test(sel)) {
    const insert = `[링크 텍스트](${sel})`;
    return { changes: [{ from, to, insert }], anchor: from + 1, head: from + 7 };
  }
  const text = sel || "링크 텍스트";
  const insert = `[${text}](https://)`;
  const urlFrom = from + text.length + 3;
  return { changes: [{ from, to, insert }], anchor: urlFrom, head: urlFrom + "https://".length };
}

const HEADING = /^(#{1,6})\s+/;

/** 제목 — 줄 앞 #표식을 갈아 끼운다. 같은 단계면 제거(토글). */
export function heading(doc: string, pos: number, level: number): Edit {
  const line = lineAt(doc, pos);
  const m = HEADING.exec(line.text);
  const want = "#".repeat(level) + " ";
  const removed = m ? m[0].length : 0;
  const insert = m && m[1].length === level ? "" : want;
  return {
    changes: [{ from: line.from, to: line.from + removed, insert }],
    anchor: Math.max(line.from, pos - removed + insert.length),
  };
}

export type LineKind = "quote" | "bullet" | "ordered" | "task";

/** 줄 앞 표식 — 목록 계열은 서로 갈아 끼울 수 있도록 함께 인식한다 */
const LIST_MARK = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const QUOTE_MARK = /^(\s*)>\s?/;

function markOf(kind: LineKind, i: number): string {
  return kind === "quote" ? "> " : kind === "bullet" ? "- " : kind === "ordered" ? `${i + 1}. ` : "- [ ] ";
}

function hasKind(text: string, kind: LineKind): boolean {
  if (kind === "quote") return QUOTE_MARK.test(text);
  const m = LIST_MARK.exec(text);
  if (!m) return false;
  const mark = m[0].trim();
  if (kind === "task") return /\[[ xX]\]$/.test(mark);
  if (kind === "ordered") return /^\d/.test(mark);
  return /^[-*+]$/.test(mark);
}

/** 인용·목록·번호 목록·체크리스트 — 선택한 모든 줄에 적용. 모든 줄이 이미 그 모양이면 벗긴다(토글). */
export function toggleLines(doc: string, from: number, to: number, kind: LineKind): Edit {
  const lines = linesIn(doc, from, to);
  const off = lines.every((l) => hasKind(l.text, kind));
  const re = kind === "quote" ? QUOTE_MARK : LIST_MARK;
  const changes: Change[] = [];
  let delta = 0;
  let caretDelta = 0;
  let i = 0;
  for (const l of lines) {
    const m = re.exec(l.text);
    const indent = m ? m[1] : "";
    const removed = m ? m[0].length : 0;
    // 빈 줄은 여러 줄 선택일 때 건너뛴다(빈 줄에 "- " 만 남지 않게)
    if (!off && l.text.trim() === "" && lines.length > 1) continue;
    const insert = off ? indent : indent + markOf(kind, i++);
    changes.push({ from: l.from, to: l.from + removed, insert });
    const d = insert.length - removed;
    if (l.from <= from) caretDelta = delta + d;
    delta += d;
  }
  const single = lines.length === 1;
  return single
    ? { changes, anchor: Math.max(lines[0].from, from + caretDelta) }
    : { changes, anchor: lines[0].from, head: lines[lines.length - 1].to + delta };
}

/**
 * 블록(표·구분선·코드 블록) 삽입 — 빈 줄이면 그 자리에, 아니면 다음에 빈 줄을 두고 넣는다.
 * 뒤에도 빈 줄이 남게 해서, 바로 다음 문단이 표의 행으로 빨려 들어가지 않게 한다(GFM).
 * caret: 삽입 텍스트 안에서 캐럿을 둘 위치(없으면 블록 다음 줄).
 */
export function insertBlock(doc: string, pos: number, text: string, caret?: number): Edit {
  const line = lineAt(doc, pos);
  const atEmpty = line.text.trim() === "";
  const before = atEmpty ? (line.from > 0 && lineAt(doc, line.from - 1).text.trim() !== "" ? "\n" : "") : "\n\n";
  const at = atEmpty ? line.from : line.to;
  const rest = doc.slice(atEmpty ? line.to : at);
  const after = rest === "" || rest.startsWith("\n") ? "\n" : "\n\n";
  const insert = before + text + after;
  const start = at + before.length;
  return {
    changes: [{ from: at, to: atEmpty ? line.to : at, insert }],
    anchor: caret === undefined ? start + text.length + 1 : start + caret,
  };
}

/** 코드 블록 — 선택이 있으면 그 줄들을 펜스로 감싸고, 없으면 빈 블록을 넣고 안쪽에 캐럿 */
export function codeBlock(doc: string, from: number, to: number): Edit {
  if (to > from) {
    const lines = linesIn(doc, from, to);
    const a = lines[0].from;
    const b = lines[lines.length - 1].to;
    const body = doc.slice(a, b);
    return { changes: [{ from: a, to: b, insert: "```\n" + body + "\n```" }], anchor: a + 4, head: a + 4 + body.length };
  }
  return insertBlock(doc, from, "```\n\n```", 4);
}

/** 새 표 마크다운 — 열 이름은 자리 글자, 본문은 빈 칸 */
export function tableTemplate(cols = 3, rows = 2): string {
  const header = Array.from({ length: cols }, (_, i) => `제목 ${i + 1}`);
  return serializeGfmTable({
    align: header.map(() => "none" as const),
    header,
    rows: Array.from({ length: rows }, () => header.map(() => "")),
  });
}

export const insertTable = (doc: string, pos: number): Edit => insertBlock(doc, pos, tableTemplate());
export const insertRule = (doc: string, pos: number): Edit => insertBlock(doc, pos, "---");
