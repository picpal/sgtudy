import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

/** /my-study → 기본 방(aws)으로 */
export default function MyStudyIndex() {
  redirect(routes.myStudy("aws"));
}
