import { ScheduleSkeleton } from "@/components/ui/Skeleton";

// 내 일정 — 메뉴를 누르면 서버 응답 전에 바로 보인다
export default function Loading() {
  return <ScheduleSkeleton />;
}
