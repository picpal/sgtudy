/** 사람별 과제 상태 — docs/claude-design-prompt.md §2.4 */
export type TaskStatus = "planned" | "open" | "done" | "late" | "missed";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: "예정",
  open: "진행중",
  done: "기한내 제출",
  late: "지각 제출",
  missed: "미제출",
};

/** 방 상태 */
export type RoomStatus = "recruit" | "active" | "ended";

/** 참가 상태 문구 — 배지·목록 마크·참가 카드 공통 (상태 라벨은 붙여 쓴다: 모집중·진행중·참가중·승인 대기중) */
export const MEMBERSHIP_LABEL = { joined: "참가중", pending: "승인 대기중", left: "이탈" } as const;
/** 참가 방식 문구 — 방 만들기·방 상세·내 스터디·초대·카드 공통 */
export const JOIN_MODE_LABEL = { approval: "승인제", direct: "바로 참가" } as const;

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  recruit: "모집중",
  active: "진행중",
  ended: "종료",
};
