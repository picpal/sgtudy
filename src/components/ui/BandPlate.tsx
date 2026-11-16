/**
 * iOS 26 Safari 는 배치 뷰포트 위 상태바 띠(약 60px)에 스크롤된 본문을 비쳐 보인다. top:0 에 붙는 막대(과제 상세·편집,
 * 방 만들기 초안 카드, 일정 주 제목)는 그 띠에 닿지 못해 막대 위로 본문이 지나가 보였다.
 * 이 판은 뷰포트 바로 위에 고정돼 막대와 상관없이 띠를 늘 덮는다 — 일반 브라우저에서는 화면 밖이라 보이지도 눌리지도 않는다.
 * 색은 globals.css([data-band-plate]) — 전체 화면 막이 떠 있으면 html 바탕과 같이 막 색을 따른다.
 * 붙음 여부를 JS(scroll 리스너)로 재지 않는다: 그 방식은 iPhone Safari 크래시 의심으로 되돌린 적이 있다.
 */
export function BandPlate() {
  return <div aria-hidden="true" data-band-plate="" className="pointer-events-none fixed inset-x-0 top-[-64px] z-[80] h-[64px]" />;
}
