import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isUrlItem } from "@/components/my-study/editUrl";
import { MyStudyScreen } from "@/components/my-study/MyStudyScreen";
import type { TabId } from "@/components/my-study/StudyHeaderInfo";
import { toApiError } from "@/lib/api/errors";
import { getMyStudies, getServerClient, requireMe } from "@/lib/api/me.server";
import { fetchCurriculum } from "@/lib/api/my-study";
import { getRoomDetail, roomMetadata } from "@/lib/api/room-meta.server";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { screenKeyOf } from "@/lib/leaveGuard";
import { routes } from "@/lib/routes";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return roomMetadata((await params).id);
}

export default async function MyStudyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; mode?: string; task?: string; item?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // 데이터 RPC 는 로그인·온보딩 확인(me_get)을 기다리지 않고 함께 출발한다 — 거절은 아래 try 에서 받으므로 미리 삼켜 둔다.
  // room_get 은 generateMetadata 와 같은 요청 메모(getRoomDetail)를 쓴다.
  const pending = getServerClient().then((client) =>
    Promise.all([getRoomDetail(id), fetchCurriculum(id, client), getMyStudies()]),
  );
  pending.catch(() => {});
  await requireMe(routes.myStudy(id));
  let data: [RoomDetail, Curriculum, MeStudies];
  try {
    data = await pending;
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
  const [detail, curriculum, studies] = data;
  // 내 스터디는 그룹장·참가자(이탈 포함)·승인 대기만 — 비참가자는 공개 방 화면으로 (T12 ruling, 승인 대기는 대기 카드가 있다)
  const st = detail.me?.state;
  if (st !== "leader" && st !== "active" && st !== "inactive" && st !== "pending") redirect(routes.room(id));
  // 탭·?task= 정규화는 leaveGuard.screenKeyOf 하나로 — 이탈 가드의 "같은 화면" 판정과 같은 규칙 (E 리뷰 minor 1)
  // ?task= 는 알림(D8) 진입 — 리프 포커스. 숫자 id 가 아니면 무시
  const key = screenKeyOf(sp);
  const tab = key.tab as TabId;
  const task = key.task || undefined;
  // ?item= 은 그룹장 편집 화면에 열린 항목 — 새로고침하면 다시 연다(없는 id 는 화면이 목록으로 돌린다)
  const item = isUrlItem(sp.item) ? sp.item : undefined;
  // key 로 방 변경 시 화면 상태(탭·편집 오버라이드 등)를 리셋한다. ?tab= 도 넣어, 같은 방에서 알림 링크(?tab=curriculum)를 눌러도 그 탭으로 연다
  return (
    <MyStudyScreen key={`${id}:${task ?? ""}:${tab}`} detail={detail} curriculum={curriculum} studies={studies}
      initialTab={tab} initialMode={sp.mode === "edit" ? "edit" : "view"} initialLeaf={task} initialItem={item} />
  );
}
