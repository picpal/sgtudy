import "server-only";
import { redirect } from "next/navigation";
import { rpc } from "@/lib/api/errors";
import type { Me } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * 로그인+온보딩이 필요한 서버 페이지(/me, /rooms/new, /my-study, /schedule)에서 호출.
 * proxy 가 비로그인은 이미 /login 으로 보내지만, 온보딩 미완료는 여기서 잡는다(D7).
 */
export async function requireMe(returnTo: string): Promise<Me> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect(routes.login(returnTo));
  // C6: 서버 파일이므로 server client 를 3번째 인자로 넘긴다
  const me = await rpc<Me>("me_get", {}, client);
  if (!me.onboarded) redirect(routes.onboarding(returnTo));
  return me;
}
