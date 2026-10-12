import type { Metadata } from "next";
import { ScheduleScreen } from "@/components/schedule/ScheduleScreen";

export const metadata: Metadata = { title: "슥터디 내 일정" };

export default function SchedulePage() {
  return <ScheduleScreen />;
}
