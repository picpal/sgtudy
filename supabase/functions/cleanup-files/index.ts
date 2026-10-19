// cleanup-files — DELETED 첨부의 Storage 객체를 지우고 files 행을 정리한다(0008 job_cleanup·0015 file_discard 주석의 2단계).
// 0031: 이어서 files 행이 없는 고아 객체(업로드 후 미등록, 24h 지남)도 지운다(file_orphan_candidates).
// 호출: POST + x-cleanup-secret 헤더(= env CLEANUP_FILES_SECRET). 예약 실행은 0019 의 pg_cron → pg_net.
// SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 는 Edge Runtime 이 넣어 준다(호스팅·functions serve 모두).
import { createClient } from "supabase-js";
import { supabaseStore } from "./cleanup.ts";
import { createHandler } from "./handler.ts";

const store = () =>
  supabaseStore(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));

Deno.serve(createHandler({ secret: Deno.env.get("CLEANUP_FILES_SECRET"), store }));
