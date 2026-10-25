/**
 * 모바일 의견 보내기(/feedback 페이지) ↔ 원래 화면 사이 메모 — 클라이언트 이동 동안만 사는 모듈 변수.
 * openedFrom: 앱 안에서 연 경우의 from — 같으면 「뒤로」가 history.back(스크롤·상태 보존), 아니면(직접 진입) from 으로 replace.
 * sentFlash: 보낸 뒤 돌아간 화면의 FeedbackButton 이 마운트하며 한 번 띄울 토스트
 */
let openedFrom: string | null = null;
let sentFlash = false;

export const markFeedbackOpened = (from: string) => {
  openedFrom = from;
};
export const openedInApp = (from: string) => openedFrom === from;
export const clearFeedbackOpened = () => {
  openedFrom = null;
};
export const setFeedbackSent = () => {
  sentFlash = true;
};
export function takeFeedbackSent(): boolean {
  const v = sentFlash;
  sentFlash = false;
  return v;
}
