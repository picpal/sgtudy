import { MY_STUDY_TABS as SCREEN_TABS } from "./routes";

/**
 * 앱 안 링크 이동 가드 (Q2-1) — 진행목표 편집 화면에 저장하지 않은 수정이 있으면 헤더 메뉴·로고·옆 목록 링크의 이동을 보류하고
 * 편집 화면의 "저장하지 않은 수정이 있어요" 확인을 띄운다. 앱 안 링크는 GuardedLink(src/components/ui/GuardedLink)를 쓰고, 그 안에서 guardNavigate 로 묻는다
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


export type ScreenKey = { tab: string; task: string };

/**
 * 내 스터디 화면 key 정규화 — page.tsx 가 key(`${id}:${task}:${tab}`)를 만드는 규칙의 단일 출처.
 * 모르는 탭은 overview, 숫자가 아닌 task 는 빈 값.
 */
export function screenKeyOf(sp: URLSearchParams | { tab?: string; task?: string }): ScreenKey {
  const get = (k: "tab" | "task") => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) ?? "";
  const tab = get("tab");
  const task = get("task");
  return { tab: (SCREEN_TABS as readonly string[]).includes(tab) ? tab : "overview", task: /^\d+$/.test(task) ? task : "" };
}

let mounted: ScreenKey | null = null;

/** 마운트된 내 스터디 화면이 자기 key(initialTab·initialLeaf)를 알린다. 돌려준 함수로 푼다 */
export function setScreenKey(k: ScreenKey): () => void {
  mounted = k;
  return () => {
    if (mounted === k) mounted = null;
  };
}

/**
 * href 로 가도 지금 화면이 그대로 남는가 — Next 는 같은 경로 이동에서 화면을 다시 마운트하지 않는다.
 * 내 스터디 화면은 key 에 task·tab 을 넣어(page.tsx) 둘 중 하나라도 바뀌면 다시 마운트된다 —
 * 그러니 "경로 같음 + 정규화한 (task, tab ?? overview) 가 지금 화면 key 와 같음" 일 때만 같은 화면으로 본다 (E 리뷰 minor 1).
 * 지금 화면 key 는 마운트된 화면이 알린 값(setScreenKey — 탭을 옮겨도 key 는 그대로), 없으면 지금 주소에서 읽는다.
 * 그 밖의 쿼리(item·mode)·해시는 무시한다.
 */
export function samePage(href: string, current: string = window.location.href, key: ScreenKey | null = mounted): boolean {
  const here = new URL(current);
  const to = new URL(href, current);
  if (to.pathname !== here.pathname) return false;
  const a = screenKeyOf(to.searchParams);
  const b = key ?? screenKeyOf(here.searchParams);
  return a.tab === b.tab && a.task === b.task;
}

/**
 * 편집 화면 가드가 같은 화면 이동을 "편집만 닫고 보류" 할지 — 해시 없는 같은 화면 주소만.
 * 해시가 있는 알림 링크(#applications·#leave-requests·#submissions)는 막지 않아야 벨이 이동·앵커·읽음까지 이어 간다 (최종 리뷰 I2)
 */
export function holdSamePage(href: string, current: string = window.location.href, key: ScreenKey | null = mounted): boolean {
  return samePage(href, current, key) && !new URL(href, current).hash;
}
