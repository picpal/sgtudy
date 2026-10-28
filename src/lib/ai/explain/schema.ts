import { z } from "zod";

/* 용어 해설(스펙 2026-10-27-ask-ai-term-explain-design §5) — 요청·모델 출력 스키마와 상수. 순수 모듈(키·SDK 없음), 클라이언트도 import 한다 */

export const TERM_MAX = 40; // 정규화 뒤 코드 포인트(D2)
export const CONTEXT_MAX = 300; // 서버가 자르는 문맥 길이(D8)
export const REQ_TERM_MAX = 200;
export const REQ_CONTEXT_MAX = 1200;
export const MAX_EXPLAIN_BODY = 16 * 1024;
export const ONE_LINER_MAX = 120;
export const IN_CONTEXT_MAX = 600;
export const POINTS_MAX = 4;
export const POINT_MAX = 120;
export const RELATED_MAX = 4;
export const RELATED_ITEM_MAX = 30;

/** 허용 영역(D1) — data-ask-ai 값 */
export const SOURCES = ["node", "room", "notice", "submission", "exam", "wrong"] as const;
export type Source = (typeof SOURCES)[number];
/** 방 공유 캐시에 남기지 않는 영역 — 시험 결과·오답노트 문맥엔 정답·해설이 들어 있어, 그 문맥으로 쓴 해설이 아직 안 푼 멤버에게 갈 수 있다 */
export const NO_SHARE_SOURCES: ReadonlySet<Source> = new Set(["exam", "wrong"]);

export const ExplainRequest = z.object({
  slug: z.string().min(1).max(60),
  term: z.string().min(1).max(REQ_TERM_MAX),
  source: z.enum(SOURCES),
  context: z.string().max(REQ_CONTEXT_MAX),
});
export type ExplainRequest = z.infer<typeof ExplainRequest>;

/** 모델 출력(D7, Structured Outputs strict — optional 없음, 추가 키 거절). 글 길이는 sanitizeExplain 이 자른다 */
export const ExplainOut = z.strictObject({
  kind: z.enum(["term", "not_term"]),
  term: z.string(),
  oneLiner: z.string(),
  inContext: z.string(),
  points: z.array(z.string()),
  related: z.array(z.string()),
});
export type ExplainOut = z.infer<typeof ExplainOut>;

export type ExplainResponse = { hit: boolean; body: ExplainOut };

/** ai_explain_begin 이 DB 에서 읽어 준 방 메타(D8) — 클라이언트가 보내지 않는다 */
export type RoomMeta = {
  title: string;
  intro: string;
  description: string;
  tags: string[];
  round: { label: string; title: string; goal: string } | null;
};
