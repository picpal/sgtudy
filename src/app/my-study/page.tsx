import { redirect } from "next/navigation";
import { MyStudyEmpty } from "@/components/my-study/MyStudyEmpty";
import { requireMe } from "@/lib/api/me.server";
import { fetchMyStudies } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export default async function MyStudyIndex() {
  await requireMe(routes.myStudy());
  const studies = await fetchMyStudies(await createClient());
  const first = studies.groups.flatMap((g) => g.items)[0];
  if (first) redirect(routes.myStudy(first.slug));
  return <MyStudyEmpty />;
}
