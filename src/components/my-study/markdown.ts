/**
 * 작은 마크다운 파서 — 에디터(ui/markdown-editor)가 만들어 내는 모양을 그대로 읽는다:
 * 제목(#~###, 더 깊으면 ###)·문단(줄바꿈 유지)·목록(-, *, 1.)·체크리스트(- [ ])·인용(>)·코드 블록(```)·구분선(---)·GFM 표,
 * 인라인은 굵게·기울임·취소선·코드·http(s) 링크.
 * 결과는 데이터일 뿐이고 화면은 React 요소로 그린다(dangerouslySetInnerHTML 없음) → 원문 HTML 은 글자로 남는다 (Q2-10).
 */
import { parseGfmTable, type TableModel } from "@/lib/markdown/gfmTable";

export { parseInline, type MdInline } from "@/lib/markdown/inline";

/** 목록 항목 — text 는 이어진 줄을 \n 으로 품는다, sub 는 하위 목록 (md-images 스펙 D10·D11) */
export type MdItem = { text: string; done?: boolean; sub: MdBlock[] };
export type MdBlock =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: MdItem[] }
  | { type: "ol"; items: MdItem[]; start?: number }
  | { type: "task"; items: MdItem[] } // done 필수
  | { type: "quote"; blocks: MdBlock[] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "table"; table: TableModel };

const H = /^(#{1,6})\s+(.+)$/;
// 글자 없는 항목("- [ ]" — 줄 끝 공백은 trim 으로 빠진다)도 체크리스트 (Q1-11)
const TASK = /^[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;
const UL = /^[-*+]\s+(.*)$/;
const OL = /^(\d+)[.)]\s+(.*)$/;
const FENCE = /^(```|~~~)\s*([\w+#-]*)\s*$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?/;
const TABLE_DELIM = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const LIST_DEPTH = 4;

/** 소개 본문은 "스터디 소개" h3 아래에 놓이므로 # → h4, ## → h5, ### → h6 (V2-06) */
export const headingTag = (level: 1 | 2 | 3) => (["h4", "h5", "h6"] as const)[level - 1];

type ListBlock = Extract<MdBlock, { type: "ul" | "ol" | "task" }>;
type ListLine = { type: ListBlock["type"]; item: MdItem; start?: number };
/** 열린 목록 한 단계 — indent 는 그 목록 항목들의 들여쓰기 */
type Level = { indent: number; block: ListBlock };

/** 줄 앞 들여쓰기 폭(탭 = 공백 4) */
function indentOf(raw: string): number {
  let n = 0;
  for (const c of raw) {
    if (c === " ") n++;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
}

function listLine(line: string): ListLine | null {
  const task = TASK.exec(line);
  if (task) return { type: "task", item: { text: task[2] ?? "", done: task[1] !== " ", sub: [] } };
  const ul = UL.exec(line);
  if (ul) return { type: "ul", item: { text: ul[1], sub: [] } };
  const ol = OL.exec(line);
  if (ol) return { type: "ol", item: { text: ol[2], sub: [] }, start: Number(ol[1]) };
  return null;
}

const newList = (l: ListLine): ListBlock => (l.type === "ol" && l.start !== 1 ? { type: "ol", items: [l.item], start: l.start } : { type: l.type, items: [l.item] }) as ListBlock;
const lastItem = (b: ListBlock) => b.items[b.items.length - 1];

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: Extract<MdBlock, { type: "p" }> | null = null;
  // 열린 목록 단계들 — [0] 이 맨 바깥(out 에 이미 들어가 있다)
  let stack: Level[] = [];
  const flush = () => {
    para = null;
    stack = [];
  };

  /** 목록 줄 하나를 들여쓰기에 맞는 단계에 붙인다 (D10) */
  const addListLine = (indent: number, l: ListLine) => {
    para = null;
    if (stack.length === 0) {
      const block = newList(l);
      out.push(block);
      stack = [{ indent, block }];
      return;
    }
    // 더 얕은 줄이면 그 단계까지 닫는다(맨 바깥은 남긴다)
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];
    // 직전 항목의 내용 칸(들여쓰기 + 표식 폭 + 1) 이상 · 또는 2칸 이상 더 들이면 하위 — 2칸이 늘 더 작으므로 2칸으로 판정
    if (indent >= top.indent + 2 && stack.length < LIST_DEPTH) {
      const parent = lastItem(top.block);
      const prev = parent.sub[parent.sub.length - 1] as ListBlock | undefined;
      if (prev?.type === l.type) {
        prev.items.push(l.item);
        stack.push({ indent, block: prev });
      } else {
        const block = newList(l);
        parent.sub.push(block);
        stack.push({ indent, block });
      }
      return;
    }
    if (top.block.type === l.type) {
      top.block.items.push(l.item);
      return;
    }
    // 같은 단계에서 종류가 바뀜 — 맨 바깥이면 새 블록, 하위면 부모 항목 아래 새 하위 목록
    const block = newList(l);
    if (stack.length === 1) {
      out.push(block);
      stack = [{ indent, block }];
    } else {
      lastItem(stack[stack.length - 2].block).sub.push(block);
      stack[stack.length - 1] = { indent, block };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push({ type: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    if (HR.test(line)) {
      flush();
      out.push({ type: "hr" });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1].trim()) && lines[i + 1].includes("|")) {
      const rows = [line];
      for (i++; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(lines[i].trim());
      i--;
      const table = parseGfmTable(rows.join("\n"));
      if (table) {
        flush();
        out.push({ type: "table", table });
        continue;
      }
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i].trim()); i++) body.push(lines[i].trim().replace(QUOTE, ""));
      i--;
      out.push({ type: "quote", blocks: parseMarkdown(body.join("\n")) });
      continue;
    }
    const h = H.exec(line);
    if (h) {
      flush();
      out.push({ type: "h", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() });
      continue;
    }
    const indent = indentOf(raw);
    const l = listLine(line);
    if (l) {
      addListLine(indent, l);
      continue;
    }
    // 목록 바로 뒤 들여쓴 줄은 가장 안쪽 항목의 이어진 줄
    if (stack.length > 0 && indent > 0) {
      const it = lastItem(stack[stack.length - 1].block);
      it.text += `\n${line}`;
      continue;
    }
    stack = [];
    if (!para) {
      para = { type: "p", lines: [] };
      out.push(para);
    }
    para.lines.push(line);
  }
  return out;
}
