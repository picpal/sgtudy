import type { Ask, ChatLine, Dropped, Field, RequiredField, TurnResponse } from "@/lib/ai/schema";
import type { TurnError } from "./api";

/* 인터뷰 화면 상태(순수 리듀서) — 대화는 페이지 안에만 있다(D8). 모드를 오가도 NewRoomScreen 이 들고 있어 남는다(D13) */

export type Bubble = { id: number; role: "user" | "assistant"; text: string };
export type InterviewState = {
  lines: Bubble[];
  ask: Ask | null;
  missing: RequiredField[];
  dropped: Dropped[];
  done: boolean;
  busy: boolean;
  started: boolean;
  /** 마지막 요청의 칩 답 — 다시 시도에 같은 답을 보낸다 */
  lastAnswer: { field: Field; value: string } | null;
  error: TurnError | null;
  /** 409 턴 상한 — 입력을 닫고 [미리보기로]/[직접 입력으로] 만 남긴다 */
  limit: boolean;
  turnsLeft: number;
};

export const INITIAL: InterviewState = { lines: [], ask: null, missing: [], dropped: [], done: false, busy: false, started: false, lastAnswer: null, error: null, limit: false, turnsLeft: 12 };

export type Action =
  | { type: "start" }
  | { type: "send"; text: string; answer: { field: Field; value: string } | null }
  | { type: "retry" }
  | { type: "turn"; res: TurnResponse }
  | { type: "fail"; err: TurnError };

const nextId = (s: InterviewState) => (s.lines.at(-1)?.id ?? 0) + 1;

export function reduce(s: InterviewState, a: Action): InterviewState {
  switch (a.type) {
    case "start":
      return { ...s, started: true, busy: true, error: null };
    case "send":
      return { ...s, busy: true, error: null, lastAnswer: a.answer, ask: null, lines: [...s.lines, { id: nextId(s), role: "user", text: a.text }] };
    case "retry":
      return { ...s, busy: true, error: null };
    case "turn":
      return {
        ...s, busy: false, error: null, ask: a.res.ask, missing: a.res.missing, dropped: a.res.dropped, done: a.res.done, turnsLeft: a.res.turnsLeft,
        lines: [...s.lines, { id: nextId(s), role: "assistant", text: a.res.say }],
      };
    case "fail":
      return { ...s, busy: false, error: a.err, limit: s.limit || a.err.error === "AI_TURN_LIMIT" };
  }
}

/** 서버로 보낼 대화(지난 say 와 사용자 글만) */
export const toMessages = (s: InterviewState): ChatLine[] => s.lines.map((l) => ({ role: l.role, text: l.text }));
/** 이탈 가드 — 사용자가 한 번이라도 답했으면 */
export const isDirty = (s: InterviewState) => s.lines.some((l) => l.role === "user");
