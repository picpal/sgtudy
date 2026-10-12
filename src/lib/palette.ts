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
