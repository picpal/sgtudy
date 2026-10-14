import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrl } from "./return-to";

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

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims.sub ?? null;

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    return NextResponse.redirect(new URL(loginUrl(returnTo), request.url));
  }
  return response;
}
