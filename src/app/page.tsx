import { MainScreen } from "@/components/main/MainScreen";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const initial = await fetchRooms(DEFAULT_PARAMS, await createClient());
  return <MainScreen initial={initial} />;
}
