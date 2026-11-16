/**
 * 화면 위에 붙는 막대 바로 앞에 둔다. iOS 26 Safari 는 배치 뷰포트 위 상태바 띠(약 60px)로 스크롤된 본문을 비쳐 보이는데,
 * top:0 막대는 그 띠에 닿지 못한다. 이 판은 top:-64px 에 붙어 막대가 붙어 있는 동안 그 띠를 막대 바탕색으로 덮는다.
 * 막대가 붙기 전에는 제자리(막대 뒤)에 있어 보이지 않는다 — 그래서 막대 높이가 64px 이상이어야 한다.
 * 붙음 여부를 JS(scroll 리스너·data 속성)로 재지 않는다: 그 방식은 iPhone Safari 크래시 의심으로 되돌린 적이 있다.
 */
export function StickyTopCap({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" data-sticky-cap="" className={`sticky top-[-64px] z-[2] -mb-16 h-16 shrink-0 bg-surface ${className}`} />;
}
