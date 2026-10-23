import type { Metadata } from "next";
import { NewRoomScreen } from "@/components/room-new/NewRoomScreen";
import { aiInterviewEnabled } from "@/lib/ai/env";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 방 만들기" };

/** AI 인터뷰는 서버 키(또는 로컬 목)가 있을 때만 — 클라이언트에는 불리언만 간다(D19). ?mode=ai 로 인터뷰부터 연다(D12) */
export default async function NewRoomPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  await requireMe(routes.createRoom());
  const aiEnabled = aiInterviewEnabled();
  const initialMode = aiEnabled && (await searchParams).mode === "ai" ? "ai" : "manual";
  return <NewRoomScreen aiEnabled={aiEnabled} initialMode={initialMode} />;
}
