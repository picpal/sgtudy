import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { toApiError } from "@/lib/api/errors";
import { getServerClient } from "@/lib/api/me.server";
import { fetchRoomDetail } from "@/lib/api/room-view";
import { NOT_FOUND_TITLE } from "@/lib/routes";

/**
 * 방 상세·내 스터디의 <title> = 방 제목(Q1-22). 없는 방·초대 없는 비공개 방(ROOM_NOT_FOUND)은 페이지가
 * notFound() 를 부르지만 이 메타데이터가 not-found 의 title 을 이기므로 404 제목을 직접 준다(V1-02).
 * 그 밖의 오류는 루트 기본 제목 — 오류 처리는 페이지 본문이 한다. 요청 안에서는 React cache 로 한 번만 부른다.
 */
export const roomMetadata = cache(async (slug: string, invite?: string): Promise<Metadata> => {
  try {
    const d = await fetchRoomDetail(slug, await getServerClient(), invite);
    return { title: d.title };
  } catch (e) {
    return toApiError(e).code === "ROOM_NOT_FOUND" ? { title: NOT_FOUND_TITLE } : {};
  }
});
