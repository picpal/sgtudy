import type { Metadata } from "next";
import { ScheduleScreen } from "@/components/schedule/ScheduleScreen";
import { getServerClient, getToday, requireMe } from "@/lib/api/me.server";
import { fetchSchedule, scheduleWindow } from "@/lib/api/schedule";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 내 일정" };

export default async function SchedulePage() {
  await requireMe(routes.schedule());
  const today = await getToday(); // 루트 layout 의 meta_get 과 같은 요청이라 한 번만 나간다
  const client = await getServerClient();
  const w = scheduleWindow(+today.slice(0, 4), +today.slice(5, 7) - 1, today);
  const initial = await fetchSchedule(w.from, w.to, client);
  return <ScheduleScreen initial={initial} />;
}
