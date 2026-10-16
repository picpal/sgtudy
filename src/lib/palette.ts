/** 아바타·태그 칩 팔레트 (bg / fg) */
export type Tone = "mint" | "blue" | "peach" | "lav" | "amber" | "slate";

export const PAL: Record<Tone, { bg: string; fg: string }> = {
  mint: { bg: "#DDF4EE", fg: "#0D7A64" },
  blue: { bg: "#E3ECFD", fg: "#2F5BC2" },
  peach: { bg: "#FDE8E1", fg: "#B4462B" },
  lav: { bg: "#EEE7FB", fg: "#6B45B8" },
  amber: { bg: "#FBEFD3", fg: "#7A4F00" },
  slate: { bg: "#E9EEF0", fg: "#4A5563" },
};

/** Main 카드 아바타용 (조금 더 진한 bg) */
export const AVATAR_PAL: Record<Tone, { bg: string; fg: string }> = {
  mint: { bg: "#D3F0E8", fg: "#0D7A64" },
  blue: { bg: "#DCE6FB", fg: "#2F5BC2" },
  peach: { bg: "#FBE3D9", fg: "#B4462B" },
  lav: { bg: "#E9E2FA", fg: "#6B45B8" },
  amber: { bg: "#FBEFD3", fg: "#8A5A00" },
  slate: { bg: "#E3E7EC", fg: "#4A5563" },
};

/** 이름별 고정 아바타 색. 없는 이름은 slate. */
export const NAME_TONE: Record<string, Tone> = {
  // 리더
  철수: "blue", 민수: "mint", 서연: "blue", 지훈: "lav", 현우: "slate", 수민: "peach", 예린: "amber", 태호: "blue", 가은: "amber",
  // 참가자 (원본 COLOR 맵)
  민재: "mint", 보람: "mint", 도현: "mint", 하은: "mint", 시우: "mint",
  지은: "peach", 소율: "peach", 지성: "peach", 은지: "peach",
  하나: "lav", 다은: "lav", 태윤: "lav", 나연: "lav", 다인: "lav",
  도윤: "slate",
  아린: "amber", 유진: "amber", 준서: "amber", 현준: "amber",
  승호: "blue",
};

export const toneOf = (name: string): Tone => NAME_TONE[name] ?? "slate";

/** WCAG 2 대비율 (#RRGGBB) */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 문자열 → 32bit FNV-1a (아바타 변형 고르기용, 결정적) */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/**
 * 아바타 색. tone(서버 DTO, 6색)은 그대로 두고, userId 를 주면 그 해시로 연한(기본)/진한(tone 글자색 바탕 + 흰 글자) 중 하나를 고른다 —
 * 같은 이니셜·같은 tone 인 두 사람이 똑같아 보이는 일을 절반으로 줄인다. 두 변형 모두 대비 4.5:1 이상 (palette.test)
 */
export function avatarColors(tone: Tone, opts: { id?: string; strong?: boolean } = {}): { bg: string; fg: string } {
  const pal = (opts.strong ? AVATAR_PAL : PAL)[tone];
  // Main 카드의 진한 mint 바탕(#D3F0E8)은 #0D7A64 글자가 4.4:1 — 아바타 글자만 한 단계 진하게
  const base = contrastRatio(pal.fg, pal.bg) < 4.5 ? { bg: pal.bg, fg: "#0B6553" } : pal;
  if (!opts.id || hash(opts.id) % 2 === 0) return base;
  return { bg: base.fg, fg: "#FFFFFF" };
}

/** 개인 목표 막대 — 흰 바탕 + slate 글자 + 1.5px slate 점선 (시안 A-8). 내 일정·방 캘린더·간트 공용 (globals.css --personal-*) */
export const PERSONAL_LOOK = { fill: "var(--surface)", color: "var(--personal-ink)", line: "1.5px dashed var(--personal-line)" } as const;
