import type { StatusFilter, Tab } from "./FilterBar";

const BODY = "채팅방 만들듯 30초면 충분해요. 첫 스터디를 열어 보세요.";
const STATUS_LABEL: Record<Exclude<StatusFilter, "all">, string> = { recruit: "모집중", active: "진행중", ended: "종료" };

/** create: 방 만들기 · browse: 전체 공개 방 탭으로 · reset: 상태·태그 필터(와 검색어) 초기화 · clear: 검색어 지우기(방 만들기는 보조) */
export type EmptyAction = "create" | "browse" | "reset" | "clear";
export type EmptyCopy = { title: string; body: string; action: EmptyAction };

/**
 * 빈 상태 문구 — spec main §4 우선순위에, 걸려 있는 상태·태그 필터를 알려 주는 갈래를 더했다(Q3-15).
 * 필터가 원인일 수 있으면 무엇이 걸려 있는지 말하고 초기화를 바로 옆에 둔다.
 * "내가 참가한 방" 이 비면 참가할 방을 찾는 게 다음 행동이다(Q3-16).
 */
export function emptyCopy(q: string, tab: Tab, status: StatusFilter, tagLabels: string[]): EmptyCopy {
  const filters = [...(status === "all" ? [] : [STATUS_LABEL[status]]), ...tagLabels.map((t) => `#${t}`)].join(" · ");
  if (q) {
    if (filters) return { title: `‘${q}’ 검색 결과가 없어요`, body: `${filters} 필터가 함께 걸려 있어요. 필터를 풀고 다시 찾아보세요.`, action: "reset" };
    return { title: `‘${q}’ 검색 결과가 없어요`, body: "다른 키워드나 태그로 다시 찾아보세요.", action: "clear" };
  }
  if (filters) return { title: "조건에 맞는 방이 없어요", body: `${filters} 필터에 맞는 방이 없어요.`, action: "reset" };
  if (tab === "created") return { title: "아직 만든 방이 없어요", body: BODY, action: "create" };
  if (tab === "mine") return { title: "참가한 방이 없어요", body: "마음에 드는 스터디를 찾아 참가해 보세요.", action: "browse" };
  return { title: "조건에 맞는 방이 없어요", body: BODY, action: "create" };
}
