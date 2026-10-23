import type { Ask, ChatLine, Dropped, Field, RequiredField, TurnResponse } from "@/lib/ai/schema";
import type { TurnError } from "./api";

/* 인터뷰 화면 상태(순수 리듀서) — 대화는 페이지 안에만 있다(D8). 모드를 오가도 NewRoomScreen 이 들고 있어 남는다(D13) */

/**
 * 인터뷰가 끝난 뒤의 로컬 질문(2단계 D33·D36) — AI 호출 없이 화면이 묻는다.
 * idle(아직 안 끝남) → asking(회차 초안 잡을까요?) → busy → recruitAsking(바로 모집할까요?) → settled([미리보기로]).
 * 아니요·그냥 미리보기로는 바로 settled. 실패는 error(다시 시도 → busy)
 */
export type RoundsStep = "idle" | "asking" | "busy" | "error" | "recruitAsking" | "settled";

/** local = 화면이 물은 로컬 질문과 그 답(D33·D36) — 대화 로그에는 남기되 서버(인터뷰·회차 입력)로는 보내지 않는다 */
export type Bubble = { id: number; role: "user" | "assistant"; text: string; local?: true };
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
  /** 진행 방식 칩(multi) 답 — 회차 초안 입력(D27). 마지막 답이 덮는다 */
  style: string[];
  rounds: RoundsStep;
  roundsError: TurnError | null;
  /** 바로 모집 시작 답(D36) — null = 안 물음 */
  openRecruit: boolean | null;
};

export const INITIAL: InterviewState = { lines: [], ask: null, missing: [], dropped: [], done: false, busy: false, started: false, lastAnswer: null, error: null, limit: false, turnsLeft: 12,
  style: [], rounds: "idle", roundsError: null, openRecruit: null,
};

export type Action =
  | { type: "start" }
  | { type: "send"; text: string; answer: { field: Field; value: string } | null }
  | { type: "retry" }
  | { type: "turn"; res: TurnResponse }
  | { type: "fail"; err: TurnError }
  | { type: "roundsStart" }
  | { type: "roundsFail"; err: TurnError }
  | { type: "roundsDone" }
  | { type: "roundsSkip" }
  | { type: "recruitAnswer"; yes: boolean }
  /** 로컬 질문에 칩으로 답했다 — 질문과 답을 말풍선으로 남긴다 */
  | { type: "localAnswer"; question: string; answer: string };

const nextId = (s: InterviewState) => (s.lines.at(-1)?.id ?? 0) + 1;

export function reduce(s: InterviewState, a: Action): InterviewState {
  switch (a.type) {
    case "start":
      return { ...s, started: true, busy: true, error: null };
    case "send":
      return {
        ...s, busy: true, error: null, lastAnswer: a.answer, ask: null, lines: [...s.lines, { id: nextId(s), role: "user", text: a.text }],
        ...(a.answer?.field === "style" ? { style: a.answer.value.split(",").map((v) => v.trim()).filter(Boolean) } : {}),
      };
    case "retry":
      return { ...s, busy: true, error: null };
    case "turn":
      return {
        ...s, busy: false, error: null, ask: a.res.ask, missing: a.res.missing, dropped: a.res.dropped, done: a.res.done, turnsLeft: a.res.turnsLeft,
        lines: [...s.lines, { id: nextId(s), role: "assistant", text: a.res.say }],
        // 끝나면 회차 질문 — 이미 답했으면(settled) 다시 묻지 않는다. 기간이 바뀌면 미리보기 섹션이 [다시 생성] 을 안내한다
        rounds: a.res.done ? (s.rounds === "settled" ? "settled" : "asking") : s.rounds === "settled" ? "settled" : "idle",
      };
    case "fail":
      return { ...s, busy: false, error: a.err, limit: s.limit || a.err.error === "AI_TURN_LIMIT" };
    case "roundsStart":
      return { ...s, rounds: "busy", roundsError: null };
    case "roundsFail":
      return { ...s, rounds: "error", roundsError: a.err };
    case "roundsDone":
      return { ...s, rounds: "recruitAsking", roundsError: null };
    case "roundsSkip":
      return { ...s, rounds: "settled", roundsError: null };
    case "recruitAnswer":
      return { ...s, rounds: "settled", openRecruit: a.yes };
    case "localAnswer": {
      const id = nextId(s);
      return { ...s, lines: [...s.lines, { id, role: "assistant", text: a.question, local: true }, { id: id + 1, role: "user", text: a.answer, local: true }] };
    }
  }
}

/** 서버로 보낼 대화(지난 say 와 사용자 글만 — 로컬 질문·답은 뺀다) */
export const toMessages = (s: InterviewState): ChatLine[] => s.lines.filter((l) => !l.local).map((l) => ({ role: l.role, text: l.text }));
/** 이탈 가드 — 사용자가 한 번이라도 답했으면 */
export const isDirty = (s: InterviewState) => s.lines.some((l) => l.role === "user");
/** 회차 초안에 보낼 사용자 발화(D27) — user 줄만, 뒤에서 12개 */
export const userLines = (s: InterviewState): string[] => s.lines.filter((l) => l.role === "user" && !l.local).map((l) => l.text).slice(-12);
