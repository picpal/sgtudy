import { rpc, type Db } from "@/lib/api/errors";
import { dateShort } from "@/lib/api/format";
import { kstToday } from "@/lib/kst";

/* AI 연동 Task 9 — /me 「AI 연결」 개인 액세스 토큰(PAT). 0033 pat_list / pat_create / pat_revoke.
 * 원문(token)은 pat_create 응답에만 한 번 온다 — 화면 상태에만 두고 저장·로그하지 않는다 */

export type ApiScope = "read" | "curriculum:write" | "personal:write";
export type ApiToken = { id: string; name: string; prefix: string; scopes: ApiScope[]; createdAt: string; expiresAt: string; lastUsedAt: string | null; expired: boolean };
export type CreatedToken = ApiToken & { token: string };
export type TokenList = { today: string; items: ApiToken[] };
export type TokenDays = 30 | 90 | 365;

export const SCOPES: ApiScope[] = ["read", "curriculum:write", "personal:write"];
export const SCOPE_LABEL: Record<ApiScope, string> = { read: "읽기", "curriculum:write": "진행목표 편집", "personal:write": "개인 목표 추가" };
export const TOKEN_DAYS: TokenDays[] = [30, 90, 365];

export const listTokens = (client?: Db) => rpc<TokenList>("pat_list", {}, client);
export const createToken = (name: string, scopes: ApiScope[], days: TokenDays, client?: Db) =>
  rpc<CreatedToken>("pat_create", { p_name: name.trim(), p_scopes: scopes, p_days: days }, client);
export const revokeToken = (id: string, client?: Db) => rpc<TokenList>("pat_revoke", { p_id: id }, client);

export const mcpUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/api/mcp`;

/** 〔D21〕 모든 폴더에서 쓰도록 --scope user */
export function mcpAddCommand(origin: string, token: string): string {
  return `claude mcp add --scope user --transport http sgtudy ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`;
}

/** 〔D21〕 ~/.claude/settings.json 조각 — 읽기 4개 + 미리보기만 자동 허용(적용·개인 목표 추가·삭제·시험 초안 저장은 계속 묻는다) */
export const MCP_ALLOW_SNIPPET = JSON.stringify(
  { permissions: { allow: ["mcp__sgtudy__list_my_studies", "mcp__sgtudy__get_curriculum", "mcp__sgtudy__list_my_tasks", "mcp__sgtudy__get_exam_brief", "mcp__sgtudy__preview_curriculum_plan"] } },
  null,
  2,
);

/** 시각(ISO) → KST 날짜 표기(앱 날짜 규칙 dateShort) */
const dayOf = (iso: string, today: string) => dateShort(kstToday(new Date(iso)), today);
export const lastUsedText = (t: Pick<ApiToken, "lastUsedAt">, today: string) => (t.lastUsedAt ? `${dayOf(t.lastUsedAt, today)} 사용` : "사용 전");
export const expiresText = (t: Pick<ApiToken, "expiresAt">, today: string) => `${dayOf(t.expiresAt, today)} 만료`;
