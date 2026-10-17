/**
 * 작은 마크다운 파서 — 에디터(ui/markdown-editor)가 만들어 내는 모양을 그대로 읽는다:
 * 제목(#~###, 더 깊으면 ###)·문단(줄바꿈 유지)·목록(-, *, 1.)·체크리스트(- [ ])·인용(>)·코드 블록(```)·구분선(---)·GFM 표,
 * 인라인은 굵게·기울임·취소선·코드·http(s) 링크.
 * 결과는 데이터일 뿐이고 화면은 React 요소로 그린다(dangerouslySetInnerHTML 없음) → 원문 HTML 은 글자로 남는다 (Q2-10).
 */
import { parseGfmTable, type TableModel } from "@/lib/markdown/gfmTable";

export { parseInline, type MdInline } from "@/lib/markdown/inline";

export type MdBlock =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; lines: string[] }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "task"; items: { text: string; done: boolean }[] }
  | { type: "quote"; blocks: MdBlock[] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "table"; table: TableModel };

const H = /^(#{1,6})\s+(.+)$/;
// 글자 없는 항목("- [ ]" — 줄 끝 공백은 trim 으로 빠진다)도 체크리스트 (Q1-11)
const TASK = /^[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;
const UL = /^[-*+]\s+(.*)$/;
const OL = /^\d+[.)]\s+(.*)$/;
const FENCE = /^(```|~~~)\s*([\w+#-]*)\s*$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?/;
const TABLE_DELIM = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

/** 소개 본문은 "스터디 소개" h3 아래에 놓이므로 # → h4, ## → h5, ### → h6 (V2-06) */
export const headingTag = (level: 1 | 2 | 3) => (["h4", "h5", "h6"] as const)[level - 1];

type ListBlock = Extract<MdBlock, { type: "ul" } | { type: "task" } | { type: "p" }>;
type Body = { p: string[]; ul: string[]; ol: string[]; task: { text: string; done: boolean }[] };

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let cur: ListBlock | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  /** 같은 종류면 이어 붙이고, 아니면 새 블록 — 붙일 배열(문단 줄·목록 항목)을 돌려준다 */
  const open = <T extends keyof Body>(type: T): Body[T] => {
    const c = cur as ListBlock | null;
    if (c?.type !== type) {
      flush();
      cur = (type === "p" ? { type, lines: [] } : { type, items: [] }) as ListBlock;
    }
    const b = cur as unknown as { lines?: Body[T]; items?: Body[T] };
    return (b.lines ?? b.items)!;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
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
    const task = TASK.exec(line);
    if (task) {
      open("task").push({ text: task[2] ?? "", done: task[1] !== " " });
      continue;
    }
    const ul = UL.exec(line);
    if (ul) {
      open("ul").push(ul[1]);
      continue;
    }
    const ol = OL.exec(line);
    if (ol) {
      open("ol").push(ol[1]);
      continue;
    }
    open("p").push(line);
  }
  flush();
  return out;
}
