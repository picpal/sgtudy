/**
 * 앱 응답 헤더 (md-images 스펙 D17) — 모든 경로에 nosniff + 그림 출처 제한.
 * img-src 만 둔다: 스크립트 CSP 는 nonce·동적 렌더가 필요해 범위 밖. 앱의 <img> 는 Supabase Storage 서명 URL 뿐이라
 * 렌더러에 버그가 있어도 외부 그림(추적 픽셀)은 브라우저가 한 번 더 막는다(T5)
 */
export type Header = { key: string; value: string };

/** NEXT_PUBLIC_SUPABASE_URL 의 출처 — 없거나 잘못된 값이면 null */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function securityHeaders(supabaseUrl: string | undefined): Header[] {
  const origin = supabaseOrigin(supabaseUrl);
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Content-Security-Policy", value: ["img-src", "'self'", "data:", "blob:", ...(origin ? [origin] : [])].join(" ") },
  ];
}
