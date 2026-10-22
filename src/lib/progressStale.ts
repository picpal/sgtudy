/**
 * 진척이 바뀐 뒤(제출·시험 제출·개인 목표 완료 등) 다시 마운트되는 화면이 옛 서버 props 를 그대로 보이지 않게.
 * Next 는 브라우저 뒤로·앞으로 가기에서 클라이언트 캐시의 페이지(그때의 서버 props)를 되살린다 — 화면 state 는 그 props 로 시작한다.
 * 쓰기가 끝나면 bumpProgress, 화면은 마운트할 때 progressChangedSince(자기 범위)로 물어 true 면 한 번 다시 받는다.
 * 메모리에만 둔다 — 새로 고침하면 서버가 새 값을 주므로 처음부터 다시 센다.
 */
let gen = 0;
const seen = new Map<string, number>();

export function bumpProgress(): void {
  gen += 1;
}

/** 이 범위의 화면을 지난번 받은 뒤 진척이 바뀌었나 — 묻는 순간 지금 세대로 적는다(처음 묻는 화면은 세대 0 기준) */
export function progressChangedSince(scope: string): boolean {
  const last = seen.get(scope) ?? 0;
  seen.set(scope, gen);
  return last !== gen;
}

export const progressScope = { tasks: "tasks", room: (slug: string) => `room:${slug}` } as const;
