import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, httpStatusOf, type ToolError } from "./errors";

/* PAT 경로의 DB 호출 — anon 키 + 쿠키·세션 없는 클라이언트로 api_invoke(token, op, args) 만 부른다.
   service_role(createAdminClient) 금지(Global Constraints). 이 경로의 statement_timeout 은 anon 역할의 3초 */
export type InvokeResult = ({ ok: true; data: unknown } | { ok: false; error: ToolError }) & { meta?: { expiresAt?: string } };
export type Invoke = (op: string, args?: Record<string, unknown>) => Promise<InvokeResult>;

const anonClient = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const INTERNAL: ToolError = { code: "INTERNAL", message: "처리 중 오류가 났어요" };

/** 서버 봉투({ok, data|error, meta}) 그대로. PostgREST 예외(인증·레이트리밋·타임아웃)·네트워크 오류도 {ok:false} 로 — 절대 던지지 않는다 〔C#6〕 */
export function patInvoker(token: string): Invoke {
  const db = anonClient();
  return async (op, args = {}) => {
    const t0 = Date.now();
    try {
      const { data, error } = await db.rpc("api_invoke", { p_token: token, p_op: op, p_args: args });
      if (error) {
        const e = fromPostgrest(error);
        // 〔C#12〕 타임아웃·취소는 DB 감사 행이 없다 — 운영 로그 1줄(토큰·인자·사용자 id 없음)
        if (e.code === "TIMEOUT") console.warn(JSON.stringify({ evt: "mcp_timeout", op, ms: Date.now() - t0 }));
        return { ok: false, error: e };
      }
      const env = data as InvokeResult | null;
      return env && typeof env === "object" && "ok" in env ? env : { ok: false, error: INTERNAL };
    } catch {
      return { ok: false, error: INTERNAL };
    }
  };
}

export type AuthResult =
  | { ok: true; who: { nickname: string; tokenName: string; scopes: string[]; expiresAt: string } }
  | { ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfterSec?: number };

/** HTTP 요청마다 transport 앞에서 1회 — api_invoke(token,'whoami'). DB 가 폐기·만료·형식(401)·분당 한도(429)를 판정하고
    〔N7〕 토큰별 HTTP 요청 카운터(120/분)를 올린다. 예상 밖 코드·INTERNAL·네트워크 오류 → 503. 토큰은 로그·응답에 싣지 않는다 */
export async function authenticatePat(token: string): Promise<AuthResult> {
  const r = await patInvoker(token)("whoami");
  if (r.ok) {
    const w = r.data as { nickname?: string; tokenName?: string; scopes?: string[]; expiresAt?: string } | null;
    if (!w || typeof w.nickname !== "string") return { ok: false, status: 503, code: "INTERNAL" };
    return { ok: true, who: { nickname: w.nickname, tokenName: w.tokenName ?? "", scopes: w.scopes ?? [], expiresAt: w.expiresAt ?? "" } };
  }
  const status = httpStatusOf(r.error.code);
  if (status !== 401 && status !== 403 && status !== 429) return { ok: false, status: 503, code: r.error.code === "TIMEOUT" ? "TIMEOUT" : "INTERNAL" };
  const retry = r.error.details?.retryAfterSec;
  return { ok: false, status, code: r.error.code, ...(typeof retry === "number" ? { retryAfterSec: retry } : {}) };
}
