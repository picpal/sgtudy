import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* MCP 그림 올리기의 Storage 쪽 — anon 키 + 세션 없는 클라이언트(invoke.ts 와 같은 설정)만 쓴다 (md-images 스펙 D21).
   anon 에게 열린 것은 0045 정책의 "열린 업로드 티켓의 그 경로 하나"뿐이다: 서명 업로드 URL 발급(INSERT 판정)과 finish 검사용 읽기(SELECT).
   관리자 키는 이 경로에 들이지 않는다 — 소스 검사 테스트로 고정(storage.test.ts) */
const BUCKET = "attachments";

export type ImageStorage = {
  /** 한 번 쓰는 서명 업로드 URL(2시간, Supabase 고정 수명). 티켓이 없으면 null */
  signUpload(path: string): Promise<string | null>;
  /** 앞 n 바이트(Range) — 래스터 매직바이트용. 못 읽으면 null */
  readHead(path: string, n: number): Promise<Uint8Array | null>;
  /** 통째로(max 바이트 넘으면 null) — SVG 검사용 */
  readAll(path: string, max: number): Promise<Uint8Array | null>;
};

const anonClient = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

/** 던지지 않는다 — 실패는 null(도구가 한국어 오류 + 다음 행동으로 바꾼다) */
export function anonStorage(): ImageStorage {
  const bucket = () => anonClient().storage.from(BUCKET);
  return {
    async signUpload(path) {
      try {
        const { data, error } = await bucket().createSignedUploadUrl(path);
        return error || !data ? null : data.signedUrl;
      } catch {
        return null;
      }
    },
    async readHead(path, n) {
      try {
        const { data, error } = await bucket().createSignedUrl(path, 60);
        if (error || !data) return null;
        const r = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${n - 1}` } });
        if (!r.ok) return null;
        return new Uint8Array(await r.arrayBuffer()).slice(0, n);
      } catch {
        return null;
      }
    },
    async readAll(path, max) {
      try {
        const { data, error } = await bucket().download(path);
        if (error || !data || data.size > max) return null;
        return new Uint8Array(await data.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}
