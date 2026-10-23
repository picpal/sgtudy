import "server-only";

/* 방 만들기 AI 인터뷰의 서버 env (스펙 D19). 키는 서버에만 — 클라이언트에는 aiEnabled 불리언만 간다 */

export const DEFAULT_AI_MODEL = "claude-haiku-5-5";

/** 로컬·E2E: 키 없이 대본(interview-mock) 으로 응답 */
export const aiMock = () => process.env.AI_INTERVIEW_MOCK === "1";

/** 키가 있거나 목 모드면 세그먼트를 그린다. 아니면 지금 화면 그대로(D12) */
export const aiInterviewEnabled = () => !!process.env.ANTHROPIC_API_KEY || aiMock();

export const aiModel = () => process.env.AI_INTERVIEW_MODEL?.trim() || DEFAULT_AI_MODEL;
