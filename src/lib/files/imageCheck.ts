import { IMAGE_MIME, type ImageMime } from "./imageMime";

/*
 * 그림 파일 검사 — 웹 업로드(브라우저)·MCP finish(Vercel 함수) 공용 순수 함수 (md-images 스펙 §3.2·D27).
 * Uint8Array·TextDecoder 만 쓴다. 방어 심층일 뿐 경계가 아니다 — 경계는 <img> 로만 그리기(D15)·CSP(D17)·버킷 MIME 목록
 */

export { IMAGE_MIME, type ImageMime };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

// 앞머리를 지나 <svg 가 나오는지 — BOM·공백·<?xml ?>·주석·<!DOCTYPE> 뒤
const SVG_PRELUDE = /^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)/i;

/** 파일 앞부분의 실제 형식 — 래스터는 앞 12바이트 서명, SVG 는 텍스트(앞머리 뒤 <svg). 모르면 null */
export function sniffImage(head: Uint8Array): ImageMime | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) return "image/gif";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "image/webp";
  let t = new TextDecoder("utf-8").decode(head).replace(/^﻿/, "");
  for (let m = SVG_PRELUDE.exec(t); m && m[0]; m = SVG_PRELUDE.exec(t)) t = t.slice(m[0].length);
  return /^<svg[\s>/]/i.test(t) ? "image/svg+xml" : null;
}

/** 그 형식의 사람용 이름 — 오류 문구용 */
export const imageKindLabel = (m: ImageMime) => ({ "image/png": "PNG", "image/jpeg": "JPG", "image/gif": "GIF", "image/webp": "WEBP", "image/svg+xml": "SVG" })[m];

// 안에 둬도 되는 data: — 래스터 그림·글꼴(그림 편집기들이 넣는다). data:image/svg+xml 은 안 된다(안쪽에 또 SVG)
const SAFE_DATA = /^data:(?:image\/(?:png|jpe?g|gif|webp)|font\/[\w.+-]+|application\/(?:x-)?font[\w.+-]*)[;,]/i;
const TAG = /<([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const local = (n: string) => n.slice(n.lastIndexOf(":") + 1).toLowerCase();
const decodeEntities = (s: string) =>
  s.replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)));

/**
 * SVG 금지 규칙(스펙 §3.2, 대소문자 무시) — 걸린 규칙마다 한국어 문구 하나. [] = 통과.
 * 그림 편집기(draw.io·Excalidraw·mermaid) 출력이 통과하도록 좁힌 곳(스펙 D27 표):
 * foreignObject 허용(글자 상자 — <img> 안에서는 그리기만 한다), <a> 의 http(s) 링크·#참조 허용,
 * 래스터·글꼴 data: 허용, 외부 DTD 만 있는 <!DOCTYPE> 허용(내부 DTD [..] 는 거부)
 */
export function svgProblems(text: string): string[] {
  const out = new Set<string>();
  if (/<(?:[\w-]+:)?script\b/i.test(text)) out.add("SVG 에 스크립트가 있어요(<script>)");
  if (/(?:java|vb)script\s*:/i.test(decodeEntities(text))) out.add("SVG 에 스크립트 주소가 있어요(javascript:)");
  if (/<(?:[\w-]+:)?(?:iframe|frame|frameset|embed|object|applet|meta|link|base|form)\b/i.test(text)) out.add("SVG 에 다른 문서를 넣는 요소가 있어요(<iframe> 등)");
  if (/<!ENTITY/i.test(text)) out.add("SVG 에 엔티티 선언이 있어요(<!ENTITY>)");
  if (/<!DOCTYPE[^>[]*\[/i.test(text)) out.add("SVG 에 내부 DTD 가 있어요(<!DOCTYPE [ ]>)");
  if (/@import/i.test(text)) out.add("SVG 에 외부 스타일이 있어요(@import)");
  for (const m of text.matchAll(/url\(\s*['"]?\s*([^'")\s]*)/gi)) {
    const v = decodeEntities(m[1]);
    if (!v.startsWith("#") && !SAFE_DATA.test(v)) out.add("SVG 에 외부 참조가 있어요(url())");
  }
  for (const t of text.matchAll(TAG)) {
    const tag = local(t[1]);
    for (const a of t[2].matchAll(ATTR)) {
      const name = local(a[1]);
      const v = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "").trim();
      if (name.startsWith("on")) out.add("SVG 에 이벤트 속성이 있어요(on…=)");
      else if (name === "href") {
        const ok = v.startsWith("#") || (tag === "a" && /^https?:\/\//i.test(v)) || (tag === "image" && SAFE_DATA.test(v) && v.toLowerCase().startsWith("data:image/"));
        if (!ok) out.add("SVG 에 외부 참조가 있어요(href)");
      } else if (["src", "srcset", "action", "formaction", "poster", "background"].includes(name) && !(SAFE_DATA.test(v) && v.toLowerCase().startsWith("data:image/"))) {
        out.add(`SVG 에 외부 참조가 있어요(${name})`);
      } else if (name === "attributename" && local(v) === "href") out.add("SVG 에 링크를 바꾸는 애니메이션이 있어요(attributeName=href)");
    }
  }
  return [...out];
}

/**
 * 설명에 붙여 넣을 그림 조각 — `![alt](attachment:이름)`. 파서(inline.ts)가 끊는 글자만 퍼센트 인코딩한다:
 * 공백·괄호·`%`(디코딩되므로). 한글 등은 그대로 — 읽히는 조각이 낫다(D25). alt 의 대괄호는 뺀다
 */
export const imageSnippet = (name: string, alt = "") =>
  `![${alt.replace(/[[\]]/g, "")}](attachment:${name.replace(/[\s%]/g, encodeURIComponent).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
