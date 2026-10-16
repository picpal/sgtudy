import { TasksSkeleton } from "@/components/ui/Skeleton";

// 내 과제 — 메뉴를 누르면 서버 응답 전에 바로 보인다
export default function Loading() {
  return <TasksSkeleton />;
}
