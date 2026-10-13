import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrl } from "./return-to";

/**
 * 세션 쿠키 갱신 + 보호 라우트 가드(D6). @supabase/ssr 공식 패턴: 요청 쿠키와 응답 쿠키를 함께 갱신한다.
 * getUser() 는 Auth 서버에 토큰을 검증시키므로 getSession() 대신 쓴다.
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

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    return NextResponse.redirect(new URL(loginUrl(returnTo), request.url));
  }
  return response;
}
