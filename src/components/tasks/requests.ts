/**
 * 재조회 순번 — 보낸 순서대로 번호를 주고, 이미 반영한 것보다 나중에 보낸 성공 응답만 반영한다.
 * 늦게 보낸 요청이 실패해도 그 앞의 성공 응답은 버리지 않는다 → 화면에는 "가장 나중에 보낸 성공 응답"이 남는다.
 */
export function latestApplied() {
  let sent = 0;
  let applied = 0;
  return {
    next: () => ++sent,
    /** 이 번호의 성공 응답을 반영해도 되나 — 된다면 반영한 것으로 기록한다 */
    accept: (id: number) => {
      if (id <= applied) return false;
      applied = id;
      return true;
    },
  };
}

/** 첫 대상이 문서에 붙어 있으면 그쪽, 아니면(한도로 버튼이 사라짐 등) 대체 대상에 포커스 */
export function focusFirst(primary: HTMLElement | null | undefined, fallback: HTMLElement | null | undefined) {
  (primary?.isConnected ? primary : fallback)?.focus();
}
