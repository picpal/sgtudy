/**
 * 아주 작은 마크다운 파서 — 제목(#~###)·문단(줄바꿈 유지)·목록(-, *, 1.)·굵게·기울임·코드·http(s) 링크만.
 * 결과는 데이터일 뿐이고 화면은 React 요소로 그린다(dangerouslySetInnerHTML 없음) → 원문 HTML 은 글자로 남는다 (Q2-10).
 */
export type MdBlock = { type: "h"; level: 1 | 2 | 3; text: string } | { type: "p"; lines: string[] } | { type: "ul" | "ol"; items: string[] };
export type MdInline = { t: "text" | "b" | "i" | "code"; v: string } | { t: "a"; v: string; href: string };

const H = /^(#{1,3})\s+(.+)$/;
const UL = /^[-*]\s+(.*)$/;
const OL = /^\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  let cur: MdBlock | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = H.exec(line);
    if (h) {
      flush();
      out.push({ type: "h", level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      const type = ul ? "ul" : "ol";
      const c = cur as MdBlock | null;
      if (c?.type !== type) {
        flush();
        cur = { type, items: [] };
      }
      (cur as unknown as { items: string[] }).items.push((ul ?? ol)![1]);
      continue;
    }
    const c = cur as MdBlock | null;
    if (c?.type !== "p") {
      flush();
      cur = { type: "p", lines: [] };
    }
    (cur as unknown as { lines: string[] }).lines.push(line);
  }
  flush();
  return out;
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\s][^*]*?)\*/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  const push = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev?.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  for (const m of text.matchAll(INLINE)) {
    push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: "a", v: m[3], href: m[4] });
    else out.push({ t: "i", v: m[5] });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}
