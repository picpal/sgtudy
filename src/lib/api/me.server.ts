import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { rpc } from "@/lib/api/errors";
import type { Me, MetaDto } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/*
 * 요청 단위 메모(React cache): 루트 layout 과 페이지가 같은 요청에서 getUser·me_get·meta_get 을
 * 각각 부르면 Auth/DB 왕복이 중복된다. 여기 함수를 쓰면 요청당 한 번만 나간다(요청 간 공유 없음).
 * 실패(reject)도 같은 요청 안에서는 그대로 공유된다.
 */

/** 서버 클라이언트(쿠키 기반). C6: 서버 파일의 rpc()/fetch*() 에는 이걸 넘긴다 */
export const getServerClient = cache(createClient);

/** 로그인 사용자(Auth). 비로그인이면 null */
export const getAuthUser = cache(async () => {
  const {
    data: { user },
  } = await (await getServerClient()).auth.getUser();
  return user;
});

/** 비로그인이면 null. me_get 은 온보딩 전에도 허용(03-api §1). 실패 시 throw */
export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await getAuthUser())) return null;
  return rpc<Me>("me_get", {}, await getServerClient());
});

/** 서버 KST 오늘(meta_get). 실패 시 throw — 폴백 여부는 호출자가 정한다 */
export const getToday = cache(async (): Promise<string> => (await rpc<MetaDto>("meta_get", {}, await getServerClient())).today);

/**
 * 로그인+온보딩이 필요한 서버 페이지(/me, /rooms/new, /my-study, /schedule)에서 호출.
 * proxy 가 비로그인은 이미 /login 으로 보내지만, 온보딩 미완료는 여기서 잡는다(D7).
 */
export async function requireMe(returnTo: string): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(routes.login(returnTo));
  if (!me.onboarded) redirect(routes.onboarding(returnTo));
  return me;
}
