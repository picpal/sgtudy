/**
 * 인라인 마크다운 파서 — 굵게·기울임·취소선·코드·http(s) 링크. 결과는 데이터일 뿐이다(HTML 주입 없음).
 * 읽기 화면(my-study/MarkdownView)과 에디터 표 셀(ui/markdown-editor/tableWidget)이 같이 쓴다.
 */
export type MdInline = { t: "text" | "b" | "i" | "s" | "code"; v: string } | { t: "a"; v: string; href: string };

// 8: 주소를 안 채운 링크(에디터 자리 글자 "(https://)")·스킴 없는 주소("(x링크)", "()") — 링크 문법을 감추고 글자만 (Q2-9). javascript: 등 다른 스킴은 원문 그대로 둔다
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((?:https?:\/\/|[^\s:()]*)\)|\*([^*\s][^*]*?)\*|~~(.+?)~~|(?<![\p{L}\p{N}_])_([^_\s][^_]*?)_(?![\p{L}\p{N}_])/gu;

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
    else if (m[5] !== undefined) push(m[5]);
    else if (m[6] !== undefined) out.push({ t: "i", v: m[6] });
    else if (m[7] !== undefined) out.push({ t: "s", v: m[7] });
    else out.push({ t: "i", v: m[8] });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}
