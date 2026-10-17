/**
 * 앱 안 링크 이동 가드 (Q2-1) — 진행목표 편집 화면에 저장하지 않은 수정이 있으면 헤더 메뉴·로고·옆 목록 링크의 이동을 보류하고
 * 편집 화면의 "저장하지 않은 수정이 있어요" 확인을 띄운다. 링크는 <Link onNavigate={(e) => guardNavigate(href, e)}> 로 묻는다
 * (onNavigate 는 클라이언트 이동에만 불린다 — 새 탭(⌘클릭)·외부 주소는 막지 않는다. 전체 다시 불러오기는 beforeunload 가 맡는다).
 * 가드는 화면에 하나 — 편집 화면이 걸고 떠나며 푼다. 가드가 true 를 돌려주면 이동을 막는다(목적지는 가드가 기억했다가 확인 뒤 이동).
 */
type Guard = (href: string) => boolean;

let guard: Guard | null = null;

/** 가드를 건다. 돌려준 함수로 푼다 — 그새 다른 가드가 걸렸으면 그대로 둔다 */
export function setLeaveGuard(g: Guard): () => void {
  guard = g;
  return () => {
    if (guard === g) guard = null;
  };
}

export function guardNavigate(href: string, e: { preventDefault: () => void }): void {
  if (guard?.(href)) e.preventDefault();
}
