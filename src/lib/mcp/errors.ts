export type ToolError = { code: string; message: string; details?: Record<string, unknown> };
type Pg = { message: string; details?: string | null; hint?: string | null; code?: string };
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

/** PostgREST 오류 → 도구 오류. fail() 형식만 그대로, 그 밖은 INTERNAL(원문 비노출) */
export function fromPostgrest(e: Pg): ToolError {
  // 〔C#12〕 statement_timeout·취소는 DB 감사 행이 없다(롤백) — 호출자(invoke.ts)가 토큰 없이 운영 로그를 남긴다.
  // PAT 경로의 실제 상한은 anon 역할의 3초(0034 의 15s 설정은 적용되지 않는다)
  if (e.code === "57014") return { code: "TIMEOUT", message: "처리 시간(3초)을 넘어 취소됐어요. 계획을 나눠 다시 미리 봐 주세요" };
  if (e.code !== "P0001" || !CODE_RE.test(e.message)) return { code: "INTERNAL", message: "처리 중 오류가 났어요" };
  let details: Record<string, unknown> | undefined;
  try {
    const h = e.hint ? JSON.parse(e.hint) : null;
    if (h && typeof h === "object" && !Array.isArray(h) && Object.keys(h).length > 0) details = h;
  } catch { /* hint 가 JSON 이 아니면 무시 */ }
  return { code: e.message, message: e.details || e.message, ...(details ? { details } : {}) };
}

const STATUS: Record<string, number> = {
  API_TOKEN_INVALID: 401, API_TOKEN_EXPIRED: 401, AUTH_REQUIRED: 401, API_AUTH_CONFLICT: 401,
  API_SCOPE_DENIED: 403, API_RATE_LIMITED: 429, PAYLOAD_TOO_LARGE: 413,
};
/** 전송 수준 상태. 그 밖의 코드는 MCP 도구 결과(isError)로 200 */
export const httpStatusOf = (code: string) => STATUS[code] ?? 200;

/* ---------- 다음 행동 〔UX 재검토 §4.3 · T2·D12·T4〕 ---------- */
export type NextStep = { kind: "fix" | "reread" | "stop"; hint: string };

const FIX_PLAN = "표시한 경로를 고쳐 preview_curriculum_plan 을 다시 부르세요";
const FIX_ARG = "표시한 값을 고쳐 같은 도구를 다시 부르세요";
const FIX: Record<string, string> = {
  PLAN_INVALID: FIX_PLAN, INVALID_TITLE: FIX_PLAN, INVALID_PERIOD: FIX_PLAN, VALIDATION_FAILED: FIX_ARG,
  UNKNOWN_REF: FIX_PLAN, DUPLICATE_REF: FIX_PLAN, NODE_NOT_FOUND: FIX_PLAN, NODE_DEPTH_EXCEEDED: FIX_PLAN,
  PLAN_TOO_LARGE: "계획을 회차 몇 개씩 나눠 preview_curriculum_plan 을 여러 번 부르세요",
  ROUND_NOT_FOUND: FIX_ARG, ROUND_AMBIGUOUS: FIX_ARG, TASK_NOT_FOUND: FIX_ARG, TASK_AMBIGUOUS: FIX_ARG, ASSIGNEE_NOT_MEMBER: FIX_PLAN, ASSIGNEE_AMBIGUOUS: FIX_PLAN,
  STUDY_NOT_FOUND: "list_my_studies 로 slug 를 확인해 study 에 넣고 다시 부르세요",
  STUDY_AMBIGUOUS: "사용자에게 어느 스터디인지 물어본 뒤 study 에 그 slug 를 넣어 다시 부르세요",
};
const REREAD = "같은 계획으로 preview_curriculum_plan 을 다시 부르세요(재시도 가능)";
const REREAD_CODES = new Set(["STALE_VERSION", "PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND"]);
const TOKEN = "사용자에게 /me 「AI 연결」에서 새 토큰을 만들어 다시 연결하도록 안내하세요(연결 중에 토큰이 폐기·만료됐을 수 있어요)";
const SPLIT = "계획을 회차 몇 개씩 나눠 preview_curriculum_plan 을 여러 번 부르세요";
const STOP: Record<string, string> = {
  NOT_CURRICULUM_EDITOR: "사용자에게 그룹장에게 진행목표 편집자 지정을 요청하라고 안내하세요",
  ROOM_NOT_EDITABLE: "종료·보관된 스터디는 바꿀 수 없어요 — 사용자에게 그대로 알리세요",
  ROOM_NOT_FOUND: "스터디를 볼 수 없어요 — list_my_studies 로 참가 중인 스터디를 확인하세요",
  NOT_ACTIVE_MEMBER: "참가 중인 멤버만 개인 목표를 바꿀 수 있어요 — 사용자에게 알리세요",
  API_SCOPE_DENIED: "사용자에게 /me 「AI 연결」에서 필요한 권한이 있는 토큰을 새로 만들도록 안내하세요",
  API_TOKEN_EXPIRED: TOKEN, API_TOKEN_INVALID: TOKEN, AUTH_REQUIRED: TOKEN, API_AUTH_CONFLICT: TOKEN,
  API_RATE_LIMITED: "잠시 기다렸다가 다시 부르세요",
  DESTRUCTIVE_OP_NOT_ALLOWED: "보관·삭제는 웹에서만 할 수 있어요 — 사용자에게 웹에서 하도록 안내하세요",
  NODE_HAS_SUBMISSIONS: "제출이 있는 항목은 웹에서 고쳐야 해요 — 사용자에게 안내하세요",
  NOT_OWNER: "본인 개인 목표만 지울 수 있어요 — 사용자에게 알리세요",
  PERSONAL_LIMIT_EXCEEDED: "회차당 개인 목표 한도를 넘어요 — 개수를 줄이거나 다른 회차에 넣으세요",
  EXAM_PUBLISHED: "발행된 시험은 덮어쓸 수 없어요 — 사용자에게 웹에서 초안으로 되돌리거나 새 과제를 만들도록 안내하세요",
  EXAM_LOCKED: "응시가 시작된 시험은 AI 초안으로 바꿀 수 없어요 — 사용자에게 그대로 알리세요",
  NOTHING_TO_UNDO: "되돌리기는 일정 변경만 돼요 — 그 밖에 바뀐 것은 사용자에게 웹에서 고치도록 안내하세요",
  UNDO_STALE: "되돌리기는 일정 변경만 돼요 — 그 뒤 바뀐 것은 사용자에게 웹에서 고치도록 안내하세요",
  TIMEOUT: SPLIT, PAYLOAD_TOO_LARGE: SPLIT,
  INTERNAL: "잠시 뒤 한 번 다시 시도하고, 계속되면 사용자에게 알리세요",
};

/** 오류 코드 → 다음 행동(분류·한 문장). DB 오류 문구(message)는 그대로 두고 이 문장만 덧붙인다 */
export function nextStep(code: string, details?: Record<string, unknown>): NextStep {
  if (code in FIX) {
    const hasCandidates = Array.isArray(details?.candidates) && details.candidates.length > 0;
    const hint = hasCandidates && code !== "STUDY_AMBIGUOUS" ? "후보 중 하나로 고쳐 같은 도구를 다시 부르세요" : FIX[code];
    return { kind: "fix", hint };
  }
  if (REREAD_CODES.has(code)) return { kind: "reread", hint: REREAD };
  if (code === "API_RATE_LIMITED" && typeof details?.retryAfterSec === "number") {
    return { kind: "stop", hint: `${details.retryAfterSec}초 뒤에 다시 부르세요` };
  }
  return { kind: "stop", hint: STOP[code] ?? "사용자에게 오류 내용을 그대로 알리세요" };
}

const MAX_ERROR_LINES = 20;
const asText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.slug === "string") return typeof o.title === "string" ? `${o.slug}(${o.title})` : o.slug;
    if (typeof o.nickname === "string") return o.nickname;
    if (typeof o.label === "string") return o.label;
    if (typeof o.title === "string") return o.title;
  }
  return "";
};

/** 경로별 오류 한 줄 — `ops[2].title INVALID_TITLE: 제목은 …` */
export function errorLine(e: unknown): string {
  if (!e || typeof e !== "object") return asText(e);
  const o = e as Record<string, unknown>;
  const where = [o.path, o.field].filter((x) => typeof x === "string" && x).join(" ");
  const cand = Array.isArray(o.candidates) ? o.candidates.map(asText).filter(Boolean) : [];
  return `${where ? where + " " : ""}${asText(o.code)}: ${asText(o.message)}${cand.length ? ` (후보: ${cand.join(", ")})` : ""}`;
}

/** 도구 오류 → 텍스트. 오류 한 줄 + 경로별 목록(최대 20) + 후보 + `→ 다음:`. hint 가 있으면 코드별 다음 행동 대신(도구별 문맥) */
export function toolErrorText(e: ToolError, hint?: string): string {
  const lines = [`오류 ${e.code}: ${e.message}`];
  const errors = Array.isArray(e.details?.errors) ? e.details.errors : [];
  for (const x of errors.slice(0, MAX_ERROR_LINES)) lines.push(`- ${errorLine(x)}`);
  if (errors.length > MAX_ERROR_LINES) lines.push(`- … 외 ${errors.length - MAX_ERROR_LINES}건`);
  const cand = Array.isArray(e.details?.candidates) ? e.details.candidates.map(asText).filter(Boolean) : [];
  if (cand.length) lines.push(`후보: ${cand.join(", ")}`);
  lines.push(`→ 다음: ${hint ?? nextStep(e.code, e.details).hint}`);
  return lines.join("\n");
}
