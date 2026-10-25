import type { Metadata } from "next";
import { FeedbackScreen } from "@/components/ui/FeedbackScreen";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 의견 보내기" };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  await requireMe(routes.feedback());
  return <FeedbackScreen from={typeof from === "string" ? from : undefined} />;
}
