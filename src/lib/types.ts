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

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  recruit: "모집중",
  active: "진행중",
  ended: "종료",
};
