import { redirect } from "next/navigation";
import { MyStudyEmpty } from "@/components/my-study/MyStudyEmpty";
import { getServerClient, requireMe } from "@/lib/api/me.server";
import { fetchMyStudies } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";

export default async function MyStudyIndex() {
  // me_studies 는 가드(me_get)를 기다리지 않고 함께 출발 — 거절은 아래 await 에서 받는다
  const pending = getServerClient().then(fetchMyStudies);
  pending.catch(() => {});
  await requireMe(routes.myStudy());
  const studies = await pending;
  const first = studies.groups.flatMap((g) => g.items)[0];
  if (first) redirect(routes.myStudy(first.slug));
  return <MyStudyEmpty />;
}
