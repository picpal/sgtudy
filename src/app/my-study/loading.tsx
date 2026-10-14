import { MyStudySkeleton } from "@/components/ui/Skeleton";

// /my-study(첫 스터디로 리다이렉트)와 /my-study/[id] 공통 골격
export default function Loading() {
  return <MyStudySkeleton />;
}
