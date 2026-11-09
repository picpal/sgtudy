/** 캘린더 막대 상세 팝오버 자리 — 화면(viewport) 좌표. 누른 막대 바로 아래, 아래가 모자라면 위, 둘 다 모자라면 넓은 쪽에 높이 제한 */
export type Rect = { top: number; bottom: number; left: number; right: number };
export type Placement = { top: number; left: number; width: number; side: "below" | "above"; maxHeight: number | null };

export const POP_W = 300;
const GAP = 6;
const MARGIN = 8;

/**
 * @param a  누른 막대의 getBoundingClientRect
 * @param x  누른 가로 위치(마우스). 키보드로 열었으면 null — 막대 가운데
 * @param h  팝오버 실제 높이
 * @param vw @param vh 화면 너비·높이
 * @param box 가로로 머물 칸(캘린더 표의 left·right) — 옆 메뉴를 덮지 않게. 팝오버보다 좁으면 화면 전체
 */
export function placeCalPopover(a: Rect, x: number | null, h: number, vw: number, vh: number, box?: { left: number; right: number }): Placement {
  const width = Math.min(POP_W, vw - MARGIN * 2);
  let lo = Math.max(MARGIN, box?.left ?? 0);
  let hi = Math.min(vw - MARGIN, box?.right ?? vw);
  if (hi - lo < width) [lo, hi] = [MARGIN, vw - MARGIN];
  const cx = x ?? (a.left + a.right) / 2;
  const left = Math.max(lo, Math.min(cx - width / 2, hi - width));
  const below = vh - a.bottom - GAP - MARGIN;
  const above = a.top - GAP - MARGIN;
  if (h <= below) return { top: a.bottom + GAP, left, width, side: "below", maxHeight: null };
  if (h <= above) return { top: a.top - GAP - h, left, width, side: "above", maxHeight: null };
  // 둘 다 모자라면(낮은 창) 넓은 쪽에 붙이고 안에서 스크롤
  return below >= above
    ? { top: a.bottom + GAP, left, width, side: "below", maxHeight: Math.max(0, below) }
    : { top: MARGIN, left, width, side: "above", maxHeight: Math.max(0, above) };
}

/** 상자의 원래(제한 전) 높이 — max-height 로 줄어든 높이를 다시 넣으면 다음 계산이 제한을 풀어 상자가 매 프레임 커졌다 줄었다 한다 */
export const naturalHeight = (b: { scrollHeight: number; offsetHeight: number; clientHeight: number }) => b.scrollHeight + (b.offsetHeight - b.clientHeight);

export const samePlacement = (a: Placement | null, b: Placement) =>
  !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.side === b.side && a.maxHeight === b.maxHeight;

/** PC: 바탕을 이만큼(막대가 움직인 거리 누적) 스크롤하면 닫는다 — 휠 한 칸(≈100px) 정도. 살짝 건드린 건 그대로 */
export const SCROLL_CLOSE_PX = 100;
/** 막대가 지난번 자리에서 움직인 거리 */
export const barMoved = (a: Rect, b: Rect) => Math.abs(b.top - a.top) + Math.abs(b.left - a.left);
/** 막대가 화면 밖으로 완전히 나갔는가 */
export const offScreen = (r: Rect, vw: number, vh: number) => r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw;
