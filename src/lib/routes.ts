import { loginUrl } from "@/lib/supabase/return-to";

/** returnTo 검증·로그인 URL 은 plan 01 return-to.ts 가 단일 출처 — 여기서는 다시 내보내기만 한다 */
export { loginUrl, safeReturnTo } from "@/lib/supabase/return-to";

/** 화면 간 이동 경로. 아트보드 ↔ 라우트 매핑의 단일 출처. */
const withReturn = (path: string, returnTo?: string) =>
  returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;

export const routes = {
  /** Main.dc.html — 방 목록 */
  home: () => "/",
  /** RoomView.dc.html — 둘러보기에서 카드 클릭한 방 상세 (slug) */
  room: (slug: string) => `/rooms/${slug}`,
  /** RoomDetail.dc.html — 참가자 시점 내 스터디. slug 생략 시 첫 스터디로 */
  myStudy: (slug?: string) => (slug ? `/my-study/${slug}` : "/my-study"),
  /** MySchedule.dc.html — 통합 캘린더 */
  schedule: () => "/schedule",
  /** 방 만들기 (디자인 §4.3) */
  createRoom: () => "/rooms/new",
  /** 이메일 OTP 로그인 (§4.1) — returnTo 가 있으면 plan 01 loginUrl 과 같은 값 */
  login: (returnTo?: string) => (returnTo ? loginUrl(returnTo) : "/login"),
  /** 닉네임 설정 (§4.1) */
  onboarding: (returnTo?: string) => withReturn("/onboarding", returnTo),
  /** 내 프로필 (§4.13) */
  me: () => "/me",
  /** 초대 링크 진입 (§4.12) */
  invite: (token: string) => `/invite/${token}`,
} as const;

/** @deprecated 목업 기준 '오늘'. 화면 코드는 useToday() 를 쓴다. 테스트 픽스처 전용. */
export const TODAY = "2026-10-12";

/** @deprecated 목업 로그인 사용자. 화면 코드는 useMe() 를 쓴다. 테스트 픽스처 전용. */
export const ME = { name: "철수", initial: "철", tone: "blue" } as const;
