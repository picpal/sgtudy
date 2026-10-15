import { redirect } from "next/navigation";
import { MyStudyEmpty } from "@/components/my-study/MyStudyEmpty";
import { getMyStudies, requireMe } from "@/lib/api/me.server";
import { firstStudySlug } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";

/** 헤더 링크는 레이아웃이 고른 첫 스터디로 바로 간다(myStudyHrefOf). 여기는 주소 직접 입력·스터디 없음·낡은 링크용 폴백 */
export default async function MyStudyIndex() {
  // me_studies 는 가드(me_get)를 기다리지 않고 함께 출발 — 거절은 아래 await 에서 받는다
  const pending = getMyStudies();
  pending.catch(() => {});
  await requireMe(routes.myStudy());
  const slug = firstStudySlug(await pending);
  if (slug) redirect(routes.myStudy(slug));
  return <MyStudyEmpty />;
}
