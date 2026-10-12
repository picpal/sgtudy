import { notFound } from "next/navigation";
import { MyStudyScreen } from "@/components/my-study/MyStudyScreen";
import { isRoomId, ROOM_IDS } from "@/data/my-study";

export function generateStaticParams() {
  return ROOM_IDS.map((id) => ({ id }));
}

export default async function MyStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRoomId(id)) notFound();
  // key 로 방 변경 시 화면 상태(탭·편집 오버라이드 등)를 리셋한다.
  return <MyStudyScreen key={id} roomId={id} />;
}
