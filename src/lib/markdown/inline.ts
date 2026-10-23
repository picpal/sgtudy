/**
 * 인라인 마크다운 파서 — 굵게·기울임·취소선·코드·http(s) 링크·그림(![alt](attachment:이름)). 결과는 데이터일 뿐이다(HTML 주입 없음).
 * 읽기 화면(my-study/MarkdownView)과 에디터 표 셀(ui/markdown-editor/tableWidget)이 같이 쓴다.
 */
/** 그림 출처 — attachment 는 같은 노드 첨부의 이름, external 은 불러오지 않고 링크로만 그린다 (md-images 스펙 D1·D2) */
export type MdImgSrc = { kind: "attachment"; name: string } | { kind: "external"; href: string };
export type MdInline =
  | { t: "text" | "b" | "i" | "s" | "code"; v: string }
  | { t: "a"; v: string; href: string }
  | { t: "img"; alt: string; src: MdImgSrc };

const ALT_MAX = 200;
const ATTACHMENT = "attachment:";

/** 퍼센트 인코딩된 이름(공백·괄호) — 잘못된 % 면 원문 그대로 (D1) */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** ![alt](주소) 의 주소 → 그림 출처. attachment·http(s) 가 아니면 null(원문 글자로 남긴다) */
function imgSrc(raw: string): MdImgSrc | null {
  if (raw.startsWith(ATTACHMENT)) {
    const name = safeDecode(raw.slice(ATTACHMENT.length));
    return name ? { kind: "attachment", name } : null;
  }
  return /^https?:\/\/./.test(raw) ? { kind: "external", href: raw } : null;
}

// 1: 그림은 링크보다 먼저 본다(아니면 "!" + 링크로 쪼개진다, D3)
// 9: 주소를 안 채운 링크(에디터 자리 글자 "(https://)")·스킴 없는 주소("(x링크)", "()") — 링크 문법을 감추고 글자만 (Q2-9). javascript: 등 다른 스킴은 원문 그대로 둔다
const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((?:https?:\/\/|[^\s:()]*)\)|\*([^*\s][^*]*?)\*|~~(.+?)~~|(?<![\p{L}\p{N}_])_([^_\s][^_]*?)_(?![\p{L}\p{N}_])/gu;

/** 그림 자리표시·링크 글자 — 대체 글, 없으면 파일 이름(외부는 주소) */
export const imgLabel = (s: Extract<MdInline, { t: "img" }>) => s.alt || (s.src.kind === "attachment" ? s.src.name : s.src.href);

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
    if (m[2] !== undefined) {
      const src = imgSrc(m[2]);
      if (src) out.push({ t: "img", alt: m[1].slice(0, ALT_MAX), src });
      else push(m[0]);
    } else if (m[3] !== undefined) out.push({ t: "b", v: m[3] });
    else if (m[4] !== undefined) out.push({ t: "code", v: m[4] });
    else if (m[5] !== undefined) out.push({ t: "a", v: m[5], href: m[6] });
    else if (m[7] !== undefined) push(m[7]);
    else if (m[8] !== undefined) out.push({ t: "i", v: m[8] });
    else if (m[9] !== undefined) out.push({ t: "s", v: m[9] });
    else out.push({ t: "i", v: m[10] });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}
