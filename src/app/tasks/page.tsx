import type { Metadata } from "next";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { getServerClient, requireMe } from "@/lib/api/me.server";
import { fetchMyTasks } from "@/lib/api/personal";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 내 과제" };

export default async function TasksPage() {
  // me_get(가드)과 me_tasks 는 독립 → 병렬. 필터(?scope= 등)는 화면이 useSearchParams 로 읽는다 — 서버 조회는 필터와 무관하다
  const pending = getServerClient().then((client) => fetchMyTasks(client));
  pending.catch(() => {}); // 거절은 아래 await 에서 받는다(가드 리다이렉트가 먼저)
  await requireMe(routes.tasks());
  const initial = await pending;
  return <TasksScreen initial={initial} />;
}
