import { Badge } from "@/components/ui/Badge";
import { roomStatusLabel, type RoomStatus } from "@/lib/types";
import { STATUS_BADGE } from "@/data/room-view";

/** 모집중/진행중/종료 흰 글씨 배지 — 정보 dl 과 참가 카드 공용. draft(모집 시작 전)는 방 카드·내 스터디와 같은 "준비중" 회색 배지 */
export function StatusBadge({ status, draft }: { status: RoomStatus; draft?: boolean }) {
  if (draft)
    return (
      <Badge bg="#E9EEF0" fg="#4A5563" height={26} px={10} radius={8}>
        {roomStatusLabel(status, true)}
      </Badge>
    );
  return (
    <Badge bg={STATUS_BADGE[status]} fg="#FFFFFF" height={26} px={10} radius={8}>
      {roomStatusLabel(status)}
    </Badge>
  );
}
