import { MainScreen } from "@/components/main/MainScreen";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import { getServerClient } from "@/lib/api/me.server";

export default async function Home() {
  const initial = await fetchRooms(DEFAULT_PARAMS, await getServerClient());
  return <MainScreen initial={initial} />;
}
