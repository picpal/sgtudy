import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoomViewScreen } from "@/components/room-view/RoomViewScreen";
import { toApiError } from "@/lib/api/errors";
import { getServerClient } from "@/lib/api/me.server";
import { getRoomDetail, roomMetadata } from "@/lib/api/room-meta.server";
import { firstParam } from "@/lib/api/room-view";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import { homeHref, parseHomeFilters } from "@/components/main/homeUrl";
import type { RoomDetail } from "@/lib/api/types";

/** room_get 실패 중 ROOM_NOT_FOUND 만 404 로 바꾼다 (notFound() 는 try 밖에서) */
async function loadDetail(slug: string, invite?: string): Promise<RoomDetail | null> {
  try {
    return await getRoomDetail(slug, invite); // generateMetadata 와 같은 요청 메모 — room_get 한 번
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") return null;
    throw e;
  }
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string | string[] }> }): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return roomMetadata(id, firstParam(sp.invite));
}

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const invite = firstParam(sp.invite);
  // 둘러보기에서 이어받은 필터(?tab=·status=·q=·tag=) — 왼쪽 목록을 같은 조건으로 (시나리오 QA #19)
  const filters = parseHomeFilters(sp);
  const client = await getServerClient();
  // 상세와 사이드바 목록은 서로 독립 → 병렬
  const [detail, list] = await Promise.all([loadDetail(id, invite), fetchRooms({ ...DEFAULT_PARAMS, ...filters }, client)]);
  if (!detail) notFound();
  return <RoomViewScreen key={`${id}${homeHref(filters)}`} detail={detail} list={list} invite={invite} filters={filters} />;
}
