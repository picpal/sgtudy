import { loginUrl, safeReturnTo } from "@/lib/supabase/return-to";

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
  /** 내 스터디의 한 탭 — overview(기본)면 쿼리 없이. 방 설정 "이전 페이지" 목적지(from)로 쓴다 */
  myStudyTab: (slug: string, tab?: string) => (tab && tab !== "overview" ? `/my-study/${slug}?tab=${encodeURIComponent(tab)}` : `/my-study/${slug}`),
  /**
   * 방 설정 (그룹장) — 정보·태그·참가·기간 수정, 삭제·보관 (QA Q3-1·Q2-2).
   * from = 설정을 연 화면(방 보기·내 스터디). 설정의 "이전 페이지" 가 그리로 돌아간다 — 읽을 때는 settingsBackOf 로 검증한다
   */
  roomSettings: (slug: string, from?: string) => (from ? `/rooms/${slug}/settings?from=${encodeURIComponent(from)}` : `/rooms/${slug}/settings`),
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

/** 내 스터디 탭 키 — StudyHeaderInfo 의 TabId 가 이 목록에서 나온다(설정 "이전 페이지" from 검증이 같은 목록을 쓴다) */
export const MY_STUDY_TABS = ["overview", "curriculum", "board", "calendar", "gantt"] as const;
export type MyStudyTab = (typeof MY_STUDY_TABS)[number];
const isMyStudyTab = (v: string): v is MyStudyTab => (MY_STUDY_TABS as readonly string[]).includes(v);

/** from 길이 상한 — 정상 값(방 보기·내 스터디 탭)은 수십 자 */
const FROM_MAX = 200;

/**
 * 방 설정 "이전 페이지" 목적지 — ?from= 을 이 방(slug)의 두 화면만 허용하는 화이트리스트로 거른다:
 * 방 보기(routes.room(slug), 쿼리 없음) 또는 내 스터디(routes.myStudy(slug), 선택 ?tab=<알려진 탭>).
 * 더미 origin 기준 URL 로 풀어 origin·디코딩한 pathname 을 정확히 비교하고(%73ettings·;a·다른 방·/invite/ 등 거부),
 * 통과하면 원문이 아니라 정규형 주소를 돌려준다. 그 밖(없음·배열·너무 김·거부)은 내 스터디(slug).
 */
export function settingsBackOf(raw: string | string[] | undefined | null, slug: string): string {
  const fallback = routes.myStudy(slug);
  if (typeof raw !== "string" || raw.length === 0 || raw.length > FROM_MAX || !raw.startsWith("/") || safeReturnTo(raw) !== raw) return fallback;
  const origin = "http://settings-back.invalid";
  let url: URL;
  let path: string;
  try {
    url = new URL(raw, origin);
    path = decodeURIComponent(url.pathname);
  } catch {
    return fallback;
  }
  if (url.origin !== origin || url.hash) return fallback;
  const keys = [...url.searchParams.keys()];
  if (path === routes.room(slug)) return url.search === "" ? routes.room(slug) : fallback;
  if (path !== routes.myStudy(slug)) return fallback;
  const tab = url.searchParams.get("tab");
  if (keys.length !== 1 || keys[0] !== "tab" || tab === null || !isMyStudyTab(tab)) return fallback;
  return routes.myStudyTab(slug, tab);
}

/** 404 화면의 <title> — 루트 not-found 와 방 메타데이터(ROOM_NOT_FOUND)가 같이 쓴다 (V1-02) */
export const NOT_FOUND_TITLE = "페이지를 찾을 수 없어요 · 슥터디";
