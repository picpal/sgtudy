import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrl, SESSION_INACTIVE } from "./return-to";

/** Supabase 세션 쿠키(sb-<ref>-auth-token, 큰 세션은 .0 .1 … 청크). code-verifier 등 다른 접미사는 제외 */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * 서버가 세션 자체를 지워서(0050 pg_cron 30일 비활성 삭제 등) refresh 가 거절될 때 오는 코드.
 * auth-js(_callRefreshToken)는 재시도 가능한 오류(네트워크·5xx = AuthRetryableFetchError, code 없음)면 세션을 두고,
 * 이처럼 서버가 명시적으로 거절한 경우에만 _removeSession 으로 쿠키를 비운다 — 그래서 이 목록만 보면 일시 오류는 오탐하지 않는다.
 */
const GONE_SESSION_CODES = new Set(["refresh_token_not_found", "session_not_found", "session_expired"]);

/** 세션 쿠키를 들고 왔는데 서버가 세션을 지워 로그아웃된 요청인가 */
export function isInactiveLogout(hadSessionCookie: boolean, claims: unknown, error: unknown): boolean {
  if (!hadSessionCookie || claims) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && GONE_SESSION_CODES.has(code);
}

/**
 * 세션 쿠키 갱신 + 보호 라우트 가드(D6). @supabase/ssr 공식 패턴: 요청 쿠키와 응답 쿠키를 함께 갱신한다.
 * 가드는 로그인 여부만 보면 되므로 getClaims() 로 JWT 를 검증한다 — 호스팅(ES256)은 JWKS(캐시)로 로컬 검증해
 * Auth 왕복이 없고, 대칭키(로컬 HS256)면 내부에서 getUser 와 같은 서버 검증으로 떨어진다. getSession() 은 서명 검증이 없어 쓰지 않는다.
 * getClaims() 도 만료 임박 토큰은 먼저 refresh 하므로 아래 setAll 쿠키 갱신 패턴은 그대로 동작한다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 환경변수가 없으면(아직 Vercel 에 등록 전) 세션 없음으로 취급하고 공개 페이지는 그대로 통과시킨다 — 500 대신 비로그인.
  if (!url || !anonKey) return NextResponse.next({ request });

  // getClaims 가 refresh 실패로 쿠키를 비우기 전에 봐 둔다(setAll 이 request.cookies 를 덮어쓴다)
  const hadSessionCookie = request.cookies.getAll().some((c) => AUTH_COOKIE.test(c.name) && c.value !== "");
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();
  const user = data?.claims.sub ?? null;

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    const reason = isInactiveLogout(hadSessionCookie, data?.claims, error) ? SESSION_INACTIVE : undefined;
    const redirect = NextResponse.redirect(new URL(loginUrl(returnTo, reason), request.url));
    // auth-js 가 비운 세션 쿠키(삭제 Set-Cookie)를 리다이렉트에도 실어 브라우저에서 지운다 — 안 그러면 다음 요청이 또 refresh 를 시도
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}
