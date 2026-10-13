import type { Metadata } from "next";
import { NewRoomForm } from "@/components/room-new/NewRoomForm";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 방 만들기" };

export default async function NewRoomPage() {
  await requireMe(routes.createRoom());
  return <NewRoomForm />;
}
