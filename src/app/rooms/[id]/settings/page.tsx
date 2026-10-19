import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RoomSettingsForm } from "@/components/room-settings/RoomSettingsForm";
import { toApiError } from "@/lib/api/errors";
import { requireMe } from "@/lib/api/me.server";
import { getRoomDetail, roomMetadata } from "@/lib/api/room-meta.server";
import type { RoomDetail } from "@/lib/api/types";
import { NOT_FOUND_TITLE, routes, settingsBackOf } from "@/lib/routes";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const m = await roomMetadata((await params).id);
  return typeof m.title === "string" && m.title && m.title !== NOT_FOUND_TITLE ? { title: `방 설정 · ${m.title}` } : m;
}

/** 방 설정 (그룹장 전용, QA Q3-1·Q2-2) — 그룹장이 아니면 방 화면으로 */
export default async function RoomSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string | string[] }> }) {
  const { id } = await params;
  // 로그인 복귀 주소에는 from 을 싣지 않는다 — 인코딩된 슬래시(%2F)가 safeReturnTo 에 걸려 "/" 로 떨어진다
  await requireMe(routes.roomSettings(id));
  const back = settingsBackOf((await searchParams).from, id);
  let detail: RoomDetail;
  try {
    detail = await getRoomDetail(id);
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
  if (detail.me?.state !== "leader") redirect(routes.room(id));
  return <RoomSettingsForm key={id} detail={detail} back={back} />;
}
