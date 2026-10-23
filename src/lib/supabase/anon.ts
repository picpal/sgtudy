import "server-only";
import { createClient } from "@supabase/supabase-js";

/** 세션 없는 anon 클라이언트(서버 전용) — 누구에게나 같은 공개 데이터만 읽는다(사용자별 값이 섞이면 안 되는 모듈 캐시용) */
export function createAnonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
