import { notFound } from "next/navigation";
import { MyStudyScreen } from "@/components/my-study/MyStudyScreen";
import type { TabId } from "@/components/my-study/StudyHeaderInfo";
import { toApiError } from "@/lib/api/errors";
import { requireMe } from "@/lib/api/me.server";
import { fetchCurriculum, fetchMyStudies } from "@/lib/api/my-study";
import { fetchRoomDetail } from "@/lib/api/room-view";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

const TABS: TabId[] = ["overview", "curriculum", "board", "calendar", "gantt"];

export default async function MyStudyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; mode?: string; task?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireMe(routes.myStudy(id));
  const client = await createClient();
  let data: [RoomDetail, Curriculum, MeStudies];
  try {
    data = await Promise.all([fetchRoomDetail(id, client), fetchCurriculum(id, client), fetchMyStudies(client)]);
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
  const [detail, curriculum, studies] = data;
  const tab = TABS.includes(sp.tab as TabId) ? (sp.tab as TabId) : "overview";
  // ?task= 는 알림(D8) 진입 — 리프 포커스. 숫자 id 가 아니면 무시
  const task = sp.task && /^\d+$/.test(sp.task) ? sp.task : undefined;
  // key 로 방 변경 시 화면 상태(탭·편집 오버라이드 등)를 리셋한다.
  return (
    <MyStudyScreen key={`${id}:${task ?? ""}`} detail={detail} curriculum={curriculum} studies={studies}
      initialTab={tab} initialMode={sp.mode === "edit" ? "edit" : "view"} initialLeaf={task} />
  );
}
