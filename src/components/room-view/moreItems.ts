import type { MoreMenuItem } from "@/components/ui/MoreMenu";
import type { Action } from "@/data/room-view";
import type { StudyAction } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";

/**
 * 방 헤더 "더보기" 메뉴 항목. 그룹장은 방 설정(/rooms/{slug}/settings — 정보·태그·기간 수정, 삭제·보관)까지.
 * 링크 복사는 바로 옆 공유 버튼이 한다.
 */
export type MoreItem = "myStudy" | "roomInfo" | "settings" | "leave" | "cancel" | "leaveRequest" | "leaveRequestCancel";
/** 확인 대화상자를 여는 항목 (나머지는 링크) */
export type MoreAction = Extract<MoreItem, "leave" | "cancel" | "leaveRequest" | "leaveRequestCancel">;

export const MORE_LABEL: Record<MoreItem, string> = {
  myStudy: "내 스터디에서 보기", roomInfo: "방 정보", settings: "방 설정", leave: "참가 취소", cancel: "신청 취소",
  leaveRequest: "탈퇴 요청", leaveRequestCancel: "탈퇴 요청 취소",
};

/**
 * 신청 취소 확인 본문 — 방 화면·내 스터디 공용. 보관된 방은 다시 신청할 수 없으니 되돌릴 수 없다고 알린다 (백로그 F 리뷰 I2)
 */
export const cancelConfirmBody = (archived: boolean): string =>
  archived ? "보관된 스터디라 취소하면 다시 신청할 수 없어요." : "취소해도 모집 중이면 다시 신청할 수 있어요.";

/** 방 상세(/rooms/[slug]) — 빈 배열이면 더보기 버튼을 숨긴다 */
export function roomMoreItems(act: Action): MoreItem[] {
  switch (act) {
    case "owner":
      return ["myStudy", "settings"];
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

/**
 * 내 스터디(/my-study/[slug]) — 빈 배열이면 더보기 버튼을 숨긴다. 진행 중 참가자(canRequestLeave)는 탈퇴 요청 · 요청 중이면 요청 취소 (시나리오 QA D3).
 * 맨 앞은 항상 "방 정보"(방 화면 링크) — 상단 방 정보가 기본으로 접히면서(2026-10-21) 공개 방 화면으로 가는 길을 다시 둔다
 */
export function studyMoreItems(act: StudyAction, o: { canRequestLeave?: boolean; leaveRequested?: boolean } = {}): MoreItem[] {
  if (act === "joined" && o.canRequestLeave) return ["roomInfo", o.leaveRequested ? "leaveRequestCancel" : "leaveRequest"];
  if (act === "leave") return ["roomInfo", "leave"];
  if (act === "pending") return ["roomInfo", "cancel"];
  if (act === "owner") return ["roomInfo", "settings"];
  return ["roomInfo"];
}

const HREF: Partial<Record<MoreItem, (slug: string) => string>> = { myStudy: routes.myStudy, roomInfo: routes.room, settings: routes.roomSettings };

/**
 * 메뉴 항목으로 — 이동 항목은 링크, 참가/신청 취소·탈퇴 요청은 onCancel(확인 대화상자를 연다). 요청 취소는 되돌리는 동작이라 위험 표시 없음.
 * from = 지금 화면 주소 — 방 설정 링크에 실어 설정의 "이전 페이지" 가 이 화면으로 돌아오게 한다
 */
export function menuItemsOf(keys: MoreItem[], slug: string, onCancel: (k: MoreAction) => void, from?: string): MoreMenuItem[] {
  return keys.map((k) => {
    const href = HREF[k];
    return href ? { key: k, label: MORE_LABEL[k], href: k === "settings" ? routes.roomSettings(slug, from) : href(slug) } : { key: k, label: MORE_LABEL[k], danger: k !== "leaveRequestCancel", onSelect: () => onCancel(k as MoreAction) };
  });
}
