import { notFound } from "next/navigation";
import { RoomViewScreen } from "@/components/room-view/RoomViewScreen";
import { ROOMS, ROOM_IDS, isRoomId } from "@/data/room-view";

export function generateStaticParams() {
  return ROOM_IDS.map((id) => ({ id }));
}

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRoomId(id)) notFound();
  return <RoomViewScreen room={ROOMS[id]} />;
}
