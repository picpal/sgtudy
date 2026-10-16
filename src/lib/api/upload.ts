import { browserDb } from "./errors";
import { BUCKET } from "./submission";

/* 진행률이 보이는 첨부 업로드 — Storage REST 직접 호출 (스펙 R7: supabase-js upload 는 진행률이 없다) */

export type UploadFailure = { status: number; aborted?: true };

export type UploadOptions = {
  url: string;
  anonKey: string;
  token: string;
  key: string;
  body: Blob;
  contentType: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
  /** 테스트용 주입 */
  xhr?: () => XMLHttpRequest;
};

/** POST {url}/storage/v1/object/attachments/{key}. 실패는 UploadFailure 로 reject */
export function uploadObject(o: UploadOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const x = o.xhr ? o.xhr() : new XMLHttpRequest();
    const path = o.key.split("/").map(encodeURIComponent).join("/");
    const fail = (f: UploadFailure) => {
      o.signal?.removeEventListener("abort", onAbort);
      reject(f);
    };
    const onAbort = () => x.abort();

    x.open("POST", `${o.url.replace(/\/+$/, "")}/storage/v1/object/${BUCKET}/${path}`);
    x.setRequestHeader("authorization", `Bearer ${o.token}`);
    x.setRequestHeader("apikey", o.anonKey);
    x.setRequestHeader("content-type", o.contentType);
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = (e) => {
      // 100 은 서버 응답(onload) 뒤에만 — 전송 완료 ≠ 저장 완료
      if (e.lengthComputable && e.total > 0) o.onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        o.signal?.removeEventListener("abort", onAbort);
        o.onProgress?.(100);
        resolve();
      } else fail({ status: x.status });
    };
    x.onerror = () => fail({ status: 0 });
    x.onabort = () => fail({ status: 0, aborted: true });

    if (o.signal?.aborted) {
      x.abort();
      return;
    }
    o.signal?.addEventListener("abort", onAbort, { once: true });
    x.send(o.body);
  });
}

/** HTTP 상태 → 줄 오류 문구 (스펙 §2.3) */
export function uploadErrorText(status: number): string {
  if (status === 413) return "10MB를 넘는 파일이에요";
  if (status === 415 || status === 400) return "올릴 수 없는 형식이에요";
  if (status === 403) return "이 과제에 파일을 올릴 수 없어요";
  if (status === 401) return "로그인이 만료됐어요 · 다시 로그인해 주세요";
  return "올리지 못했어요 · 다시 시도해 주세요";
}

/** 실제 업로드: 세션 토큰을 붙여 uploadObject. 컴포넌트는 이것만 부른다 */
export async function uploadAttachment(key: string, file: Blob, contentType: string, onProgress: (pct: number) => void, signal: AbortSignal): Promise<void> {
  const { data } = await browserDb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw { status: 401 } satisfies UploadFailure;
  await uploadObject({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, token, key, body: file, contentType, onProgress, signal });
}
