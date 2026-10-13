import { notFound } from "next/navigation";
import { RoomViewScreen } from "@/components/room-view/RoomViewScreen";
import { toApiError } from "@/lib/api/errors";
import { fetchRoomDetail } from "@/lib/api/room-view";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import type { RoomDetail } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/server";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string }> }) {
  const [{ id }, { invite }] = await Promise.all([params, searchParams]);
  const client = await createClient();
  let detail: RoomDetail;
  try {
    detail = await fetchRoomDetail(id, client, invite);
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
  const list = await fetchRooms(DEFAULT_PARAMS, client);
  return <RoomViewScreen key={id} detail={detail} list={list} />;
}
