/**
 * 다른 화면(내 과제·내 일정)의 과제 링크(?task=)로 내 스터디 상세에 들어온 출발지 — 상세의 [← 내 과제] 가 그 화면으로 돌아간다.
 * 링크를 누를 때 기억하고(markTaskOrigin), 그 과제 화면이 처음 열릴 때 읽고(taskOriginOf — 상태 초기값이라 여러 번 불려도 같게) 마운트 뒤 지운다(clearTaskOrigin).
 * ?task= 는 첫 화면이 주소에서 지우므로 뒤로·앞으로 가기로 돌아온 기록은 이 기억을 다시 읽지 않는다.
 * 클라이언트 이동은 기록을 하나 쌓으므로 꺼낸 화면 바로 아래 기록이 출발지다. 새로고침·새 탭·알림 링크는 기억이 없어 null (진행목표 목록으로).
 */
export type TaskOrigin = "tasks" | "schedule";

/** 누른 뒤 이 시간 안에 열린 화면만 — 이동이 다른 곳으로 끝난(승인 대기 → 방 화면) 기억이 나중 진입에 묻어나지 않게 */
const TTL_MS = 30_000;

let mark: { kind: TaskOrigin; path: string; task: string; at: number } | null = null;

/** 화면 안 클릭(캡처 단계) — 눌린 것이 ?task= 링크면 출발지를 기억한다. 새 탭(⌘·Ctrl·Shift·가운데 버튼)은 이 탭으로 오지 않아 건너뛴다 */
export function markTaskOrigin(kind: TaskOrigin, e: { target: EventTarget | null; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a) return;
  const u = new URL(a.getAttribute("href") ?? "", "http://x");
  const task = u.searchParams.get("task");
  if (task) mark = { kind, path: u.pathname, task, at: Date.now() };
}

/** 이 화면(path·task)으로 오는 링크를 방금 눌렀으면 그 출발지 */
export function taskOriginOf(path: string, task: string, now: number = Date.now()): TaskOrigin | null {
  const m = mark;
  return m && m.path === path && m.task === task && now - m.at <= TTL_MS ? m.kind : null;
}

/** 읽은 화면이 마운트된 뒤 — 같은 과제로 오는 다른 이동(알림 링크 등)이 이 기억을 쓰지 않게 */
export function clearTaskOrigin(): void {
  mark = null;
}
