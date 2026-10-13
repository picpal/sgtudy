import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { getServerClient } from "@/lib/api/me.server";
import { fetchRoomDetail } from "@/lib/api/room-view";

/**
 * 방 상세·내 스터디의 <title> = 방 제목(Q1-22). 못 읽으면(없는 방·비공개·오류) 루트 기본 제목을 둔다 —
 * 404/오류 처리는 페이지 본문이 한다. 요청 안에서는 React cache 로 한 번만 부른다.
 */
export const roomMetadata = cache(async (slug: string, invite?: string): Promise<Metadata> => {
  try {
    const d = await fetchRoomDetail(slug, await getServerClient(), invite);
    return { title: d.title };
  } catch {
    return {};
  }
});
