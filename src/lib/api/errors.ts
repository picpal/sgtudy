import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/** 03-api.md §0 — PostgrestError { message: CODE, details: 한국어, hint: json } */
export type ApiError = { code: string; message: string; details?: Record<string, string> };

export class ApiException extends Error {
  code: string;
  details?: Record<string, string>;
  constructor(e: ApiError) {
    super(e.message);
    this.name = "ApiException";
    this.code = e.code;
    this.details = e.details;
  }
}

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

const isPostgrest = (e: unknown): e is PostgrestError =>
  typeof e === "object" && e !== null && "message" in e && "code" in e && "hint" in e;

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiException) return { code: e.code, message: e.message, details: e.details };
  if (isPostgrest(e)) {
    const isCode = CODE_RE.test(e.message);
    let details: Record<string, string> | undefined;
    if (isCode && e.hint) {
      try {
        const parsed = JSON.parse(e.hint);
        // 서버 fail() 은 hint 가 없으면 '{}' 를 보낸다 — 빈 객체는 details 없음으로 취급
        details = parsed && Object.keys(parsed).length > 0 ? parsed : undefined;
      } catch {
        details = undefined;
      }
    }
    return { code: isCode ? e.message : "UNKNOWN", message: isCode ? e.details || e.message : e.message, details };
  }
  if (e instanceof Error) return { code: "UNKNOWN", message: e.message };
  return { code: "UNKNOWN", message: "알 수 없는 오류가 발생했어요" };
}

let browser: Db | null = null;
const browserClient = (): Db => (browser ??= createClient() as Db);

type RpcFn = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

/**
 * supabase.rpc 래퍼. 실패 시 ApiException(ApiError) 을 throw.
 * client 생략 → 브라우저 클라이언트. 서버 컴포넌트에서는 `await createClient()`(server.ts) 를 넘긴다.
 * 주의: client.ts 는 "use client" 라 서버 파일에서는 client 참조(reference)가 된다.
 * 서버 파일의 모든 rpc()/fetch*() 호출은 반드시 server createClient() 를 3번째 인자로 넘길 것
 * (생략하면 타입체크는 통과하지만 런타임에 throw).
 */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}, client?: Db): Promise<T> {
  const c = client ?? browserClient();
  const { data, error } = await (c.rpc as unknown as RpcFn)(name, args);
  if (error) throw new ApiException(toApiError(error));
  return data as T;
}
