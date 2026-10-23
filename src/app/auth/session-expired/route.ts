import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { rpc, type Db } from "@/lib/api/errors";
import { isOrphanSession } from "@/lib/api/me.server";
import { loginUrl, safeReturnTo, SESSION_EXPIRED } from "@/lib/supabase/return-to";
import { createClient } from "@/lib/supabase/server";

/**
 * 고아 세션 정리 — 계정이 지워졌는데 브라우저에 쿠키가 남은 상태. 서버 컴포넌트는 쿠키를 못 지우므로
 * requireMe·로그인·온보딩 가드(getMeOrExpire)가 여기로 보내고, 세션 쿠키를 지운 뒤 /login?reason=session_expired 로 넘긴다.
 * GET 링크 하나로 남의 정상 세션을 끊지 못하게(로그아웃 CSRF) 여기서 me_get 으로 고아인지 다시 확인하고, 아니면 아무것도 지우지 않는다.
 */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  // 상대 Location — new URL(path, req.url) 은 dev 에서 호스트가 localhost 로 바뀌어(os.localhost → localhost) 다른 쿠키 저장소로 넘어간다
  const to = (path: string): never => redirect(path);
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  // 이미 세션이 없으면(다른 탭에서 정리됨 등) 안내만 붙여 로그인으로
  if (!data?.claims) return to(loginUrl(returnTo, SESSION_EXPIRED));
  // redirect() 는 throw 로 동작하므로 try 밖에서 부른다
  const orphan = await rpc("me_get", {}, db as unknown as Db).then(
    () => false,
    (e: unknown) => isOrphanSession(e),
  );
  // 정상 세션·DB 장애 등은 세션 문제가 아니다 — 지우지 않고 원래 가려던 곳으로(장애면 그 화면이 오류를 보여준다)
  if (!orphan) return to(returnTo);
  // scope local: 이 브라우저 세션만. 지워진 사용자라 Auth 의 /logout 이 실패해도 supabase-js 가 로컬 세션(쿠키)은 지운다
  await db.auth.signOut({ scope: "local" }).catch(() => {});
  // signOut 이 못 지운 조각(청크 .0/.1·code-verifier)까지 정리한다
  const store = await cookies();
  for (const c of store.getAll()) if (c.name.startsWith("sb-")) store.delete(c.name);
  return to(loginUrl(returnTo, SESSION_EXPIRED));
}
