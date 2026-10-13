import "server-only";
import { createClient } from "@supabase/supabase-js";

/** service_role 클라이언트. RLS 를 우회한다 — 시드·관리 스크립트·서버 전용. 브라우저 번들에 들어가면 안 된다(server-only). */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
