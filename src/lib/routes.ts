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
  /** 방 생성 직후 — 커리큘럼 탭 편집 모드 (§4.3) */
  myStudyEdit: (slug: string) => `/my-study/${slug}?tab=curriculum&mode=edit`,
  /** MySchedule.dc.html — 통합 캘린더 */
  schedule: () => "/schedule",
  /** 내 과제 — 쿼리 키는 정렬해서 URL 이 안정적이다 */
  tasks: (q?: Record<string, string>) => {
    const qs = new URLSearchParams(Object.entries(q ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  },
  /** 과제 한 건 진입 (제출 설계 §2.6) */
  task: (slug: string, id: string) => `/my-study/${slug}?task=${id}`,
  /** 방 만들기 (디자인 §4.3) */
  createRoom: () => "/rooms/new",
  /** 방 설정 (그룹장) — 정보·태그·참가·기간 수정, 삭제·보관 (QA Q3-1·Q2-2) */
  roomSettings: (slug: string) => `/rooms/${slug}/settings`,
  /** 이메일+비밀번호 로그인 (§4.1) — returnTo 가 있으면 plan 01 loginUrl 과 같은 값 */
  login: (returnTo?: string) => (returnTo ? loginUrl(returnTo) : "/login"),
  /** 회원가입: 이메일 인증 코드 → 비밀번호 정하기 → 닉네임 */
  signup: (returnTo?: string) => withReturn("/signup", returnTo),
  /** 비밀번호 재설정(코드로만 쓰던 계정의 비밀번호 만들기 포함): 이메일 인증 코드 → 새 비밀번호 */
  resetPassword: (returnTo?: string) => withReturn("/reset-password", returnTo),
  /** 닉네임 설정 (§4.1) */
  onboarding: (returnTo?: string) => withReturn("/onboarding", returnTo),
  /** 내 프로필 (§4.13) */
  me: () => "/me",
  /** 초대 링크 진입 (§4.12) */
  invite: (token: string) => `/invite/${token}`,
} as const;

/** 404 화면의 <title> — 루트 not-found 와 방 메타데이터(ROOM_NOT_FOUND)가 같이 쓴다 (V1-02) */
export const NOT_FOUND_TITLE = "페이지를 찾을 수 없어요 · 슥터디";
