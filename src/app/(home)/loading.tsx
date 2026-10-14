import { HomeSkeleton } from "@/components/ui/Skeleton";

// 방 둘러보기(/) — 라우트 그룹 안이라 /login 등 다른 화면 이동에는 이 골격이 끼지 않는다
export default function Loading() {
  return <HomeSkeleton />;
}
