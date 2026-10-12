import { Badge } from "@/components/ui/Badge";
import { ROOM_STATUS_LABEL, type RoomStatus } from "@/lib/types";
import { STATUS_BADGE } from "@/data/room-view";

/** 모집중/진행중/종료 흰 글씨 배지 — 정보 dl 과 참가 카드 공용 */
export function StatusBadge({ status }: { status: RoomStatus }) {
  return (
    <Badge bg={STATUS_BADGE[status]} fg="#FFFFFF" height={26} px={10} radius={8}>
      {ROOM_STATUS_LABEL[status]}
    </Badge>
  );
}
