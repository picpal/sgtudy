/** 화면 간 이동 경로. 아트보드 ↔ 라우트 매핑의 단일 출처. */
export const routes = {
  /** Main.dc.html — 방 목록 */
  home: () => "/",
  /** RoomView.dc.html — 둘러보기에서 카드 클릭한 방 상세 */
  room: (id: string) => `/rooms/${id}`,
  /** RoomDetail.dc.html — 참가자 시점 내 스터디. id 생략 시 기본 방으로 */
  myStudy: (id?: string) => (id ? `/my-study/${id}` : "/my-study"),
  /** MySchedule.dc.html — 통합 캘린더 */
  schedule: () => "/schedule",
  /** 방 만들기 — 시안에는 전용 화면이 없어 내 스터디로 보냄 */
  createRoom: () => "/my-study",
} as const;

/** 목업 데이터 기준 '오늘'. 모든 D-day·상태 계산은 이 값을 쓴다. */
export const TODAY = "2026-10-12";

/** 로그인 사용자 (항상 철수) */
export const ME = { name: "철수", initial: "철", tone: "blue" } as const;
