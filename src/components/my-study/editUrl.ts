/**
 * 커리큘럼 편집·보기 상세 화면의 열린 항목 ↔ URL(?item=) 동기화 규칙.
 * 브라우저 뒤로 가기가 목록으로 돌아가고, 새로고침하면 같은 편집 화면이 다시 열리게 한다.
 * 화면 상태가 원본이고 URL 은 따라간다 — 실제 history 호출은 MyStudyScreen 이 한다.
 */
import type { CurMode } from "./state";

/** 서버 노드 id 만 URL 에 싣는다 (낙관적 임시 노드 "root.new0" 등은 제외) */
export const isUrlItem = (id: string | null | undefined): id is string => !!id && /^\d+$/.test(id);

export function readItem(search: string): string | null {
  const v = new URLSearchParams(search).get("item");
  return isUrlItem(v) ? v : null;
}

/** 현재 주소에서 item(·mode)만 바꾼 주소. 항목이 있으면 진행목표 탭도 싣는다. 보기 상세는 mode 를 빼고, 편집은 mode=edit.
 *  알림·일정 링크의 ?task= 는 첫 화면을 여는 데만 쓰고 지운다 — 남으면 새로고침 때 지금 항목 대신 그 과제가 열린다 */
export function withItem(href: string, item: string | null, mode: CurMode = "edit"): string {
  const u = new URL(href, "http://x");
  u.searchParams.delete("task");
  if (item) {
    u.searchParams.set("tab", "curriculum");
    if (mode === "edit") u.searchParams.set("mode", "edit");
    else u.searchParams.delete("mode");
    u.searchParams.set("item", item);
  } else u.searchParams.delete("item");
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
}

export const readMode = (search: string): CurMode => (new URLSearchParams(search).get("mode") === "edit" ? "edit" : "view");

export type UrlStep = "none" | "push" | "replace" | "back";

/**
 * 화면에 열린 항목(open)이 주소의 항목(url)과 다를 때 history 를 어떻게 맞출지.
 * - 목록 → 편집: push (뒤로 가기 = 목록)
 * - 편집 → 다른 편집: replace (목록 하나 위에 편집 기록 하나만)
 * - 편집 → 목록: 이 화면이 쌓은 기록이면 back(앞으로 가기로 다시 열 수 있게), 아니면(새로고침·외부 링크 진입) replace
 */
export function urlStep(url: string | null, open: string | null, pushedHere: boolean): UrlStep {
  if (open !== null && !isUrlItem(open)) return "none"; // 임시 노드 — 서버 id 가 오면 그때 맞춘다
  if (url === open) return "none";
  if (open === null) return pushedHere ? "back" : "replace";
  return url === null ? "push" : "replace";
}

/** 주소의 항목이 트리에 있으면 그 id, 없거나(삭제됨·잘못된 값) 비었으면 null = 목록 */
export function itemTarget(url: string | null, exists: (id: string) => boolean): string | null {
  return url && exists(url) ? url : null;
}

/** urlStep + 같은 항목의 보기↔편집 전환.
 *  보기 상세 → "편집": push — 뒤로 가기가 상세로 돌아온다 (보드 → 상세 → 편집 → 뒤로 = 상세).
 *  editOverView(지금 편집 기록을 이 화면이 같은 항목의 상세 위에 쌓았음): 편집 → 보기는 back, 그 밖의 이동(닫기·다른 항목)은 replace —
 *  back 하면 목록이 아니라 상세 기록으로 가기 때문이다. 그 밖의 같은 항목 모드 전환은 replace.
 *  fromLink(주소에 ?task=): 알림·일정 링크로 들어와 그 과제를 연 첫 화면 — 아래가 목록 기록이 아니므로 push 대신 replace (새로고침 진입과 같다) */
export function syncStep(url: string | null, urlMode: CurMode, open: string | null, openMode: CurMode, pushedHere: boolean, fromLink = false, editOverView = false): UrlStep {
  const s = urlStep(url, open, pushedHere);
  if (s === "none" && open !== null && isUrlItem(open) && urlMode !== openMode) {
    if (openMode === "edit") return "push";
    return editOverView ? "back" : "replace";
  }
  if (editOverView && s !== "none") return "replace";
  if (s === "push" && fromLink) return "replace";
  return s;
}

/** 주소 → 열 화면. 편집은 권한자만(아니면 같은 항목의 보기 상세). 없는 항목은 목록 */
export function itemFromUrl(search: string, exists: (id: string) => boolean, canEdit: boolean): { id: string | null; mode: CurMode } {
  const id = itemTarget(readItem(search), exists);
  return { id, mode: id && canEdit && readMode(search) === "edit" ? "edit" : "view" };
}
