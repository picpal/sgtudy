import { MyStudySkeleton } from "@/components/ui/Skeleton";

// 스터디 사이 이동(사이드바)도 서버 응답 전에 골격부터
export default function Loading() {
  return <MyStudySkeleton />;
}
