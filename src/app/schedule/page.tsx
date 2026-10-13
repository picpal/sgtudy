import type { Metadata } from "next";
import { ScheduleScreen } from "@/components/schedule/ScheduleScreen";
import { rpc } from "@/lib/api/errors";
import { requireMe } from "@/lib/api/me.server";
import { fetchSchedule, scheduleWindow } from "@/lib/api/schedule";
import type { MetaDto } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 내 일정" };

export default async function SchedulePage() {
  await requireMe(routes.schedule());
  const client = await createClient();
  const { today } = await rpc<MetaDto>("meta_get", {}, client);
  const w = scheduleWindow(+today.slice(0, 4), +today.slice(5, 7) - 1, today);
  const initial = await fetchSchedule(w.from, w.to, client);
  return <ScheduleScreen initial={initial} />;
}
