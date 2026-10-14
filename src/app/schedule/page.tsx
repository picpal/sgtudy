import type { Metadata } from "next";
import { ScheduleScreen } from "@/components/schedule/ScheduleScreen";
import { getServerClient, getToday, requireMe } from "@/lib/api/me.server";
import { fetchSchedule, scheduleWindow } from "@/lib/api/schedule";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 내 일정" };

export default async function SchedulePage() {
  // me_get(가드)과 meta_get→me_schedule 사슬은 독립 → 병렬. getToday 는 루트 layout 의 meta_get 과 같은 요청이라 한 번만 나간다
  const load = async () => {
    const [today, client] = await Promise.all([getToday(), getServerClient()]);
    const w = scheduleWindow(+today.slice(0, 4), +today.slice(5, 7) - 1, today);
    return fetchSchedule(w.from, w.to, client);
  };
  const pending = load();
  pending.catch(() => {}); // 거절은 아래 await 에서 받는다(가드 리다이렉트가 먼저)
  await requireMe(routes.schedule());
  const initial = await pending;
  return <ScheduleScreen initial={initial} />;
}
