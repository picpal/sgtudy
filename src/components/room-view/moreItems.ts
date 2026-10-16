import type { Action } from "@/data/room-view";
import type { StudyAction } from "@/lib/api/my-study";

/**
 * 방 헤더 "더보기" 메뉴 항목. 있는 API 로 할 수 있는 것만 — 방 설정(room_update)은 화면·클라이언트 API 가 아직 없어 넣지 않는다.
 * 링크 복사는 바로 옆 공유 버튼이 한다.
 */
export type MoreItem = "myStudy" | "room" | "leave" | "cancel";

export const MORE_LABEL: Record<MoreItem, string> = { myStudy: "내 스터디에서 보기", room: "방 정보 보기", leave: "참가 취소", cancel: "신청 취소" };

/** 방 상세(/rooms/[slug]) — 빈 배열이면 더보기 버튼을 숨긴다 */
export function roomMoreItems(act: Action): MoreItem[] {
  switch (act) {
    case "owner":
    case "joined":
      return ["myStudy"];
    case "leave":
      return ["myStudy", "leave"];
    case "pending":
      return ["myStudy", "cancel"];
    default:
      return [];
  }
}

/** 내 스터디(/my-study/[slug]) */
export function studyMoreItems(act: StudyAction): MoreItem[] {
  if (act === "leave") return ["room", "leave"];
  if (act === "pending") return ["room", "cancel"];
  return ["room"];
}
