import { clampCp } from "@/components/room-new/validate";
import { stripControl } from "../normalize";

/*
 * 모델이 쓴 회차 글 정규화(D31·§6). 진행목표 설명은 마크다운으로 렌더되므로 평문 + "- " 불릿만 남긴다:
 * 이미지·링크(글만 남김)·HTML 태그·헤딩 기호·맨 URL 을 지우고, 빈 줄은 하나로 접고, 코드 포인트로 자른다
 */
export function sanitizeMd(s: string, max: number): string {
  const lines = stripControl(s)
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .split("\n")
    .map((l) => l.replace(/^\s{0,3}#{1,6}(\s+|$)/, "").replace(/^\s*[*+]\s+/, "- ").replace(/\s+$/, ""));
  const out: string[] = [];
  for (const l of lines) if (l.trim() || (out.length && out.at(-1) !== "")) out.push(l.trim() ? l : "");
  return clampCp(out.join("\n").trim(), max).trim();
}

/** 한 줄 글(회차·과제 제목) — sanitizeMd 뒤 줄바꿈·불릿 기호를 없앤다 */
export function sanitizeLine(s: string, max: number): string {
  const one = sanitizeMd(s, Number.MAX_SAFE_INTEGER).replace(/^-\s+/gm, "").replace(/\s*\n+\s*/g, " ");
  return clampCp(one.replace(/\s{2,}/g, " ").trim(), max).trim();
}
