import "server-only";

/* 방 만들기 AI 인터뷰의 서버 env (스펙 D19, 변경: 사용자 지정 OpenAI luna). 키는 서버에만 — 클라이언트에는 aiEnabled 불리언만 간다 */

/** OpenAI 공식 모델 문서(developers.openai.com/api/docs/models/gpt-6-luna, 2026-10-23 확인)의 ID */
export const DEFAULT_AI_MODEL = "gpt-6-luna";

/** 로컬·E2E: 키 없이 대본(interview-mock) 으로 응답 */
export const aiMock = () => process.env.AI_INTERVIEW_MOCK === "1";

export const aiModel = () => process.env.AI_INTERVIEW_MODEL?.trim() || DEFAULT_AI_MODEL;

/** 키와 모델이 있거나 목 모드면 세그먼트를 그린다. 아니면 지금 화면 그대로(D12) */
export const aiInterviewEnabled = () => (!!process.env.OPENAI_API_KEY?.trim() && !!aiModel()) || aiMock();

/** 용어 해설(D17) — 인터뷰와 같은 키·목 조건 + 끄기 스위치 AI_EXPLAIN_OFF=1 */
export const aiExplainEnabled = () => aiInterviewEnabled() && process.env.AI_EXPLAIN_OFF !== "1";
