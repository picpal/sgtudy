import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { rpc } from "@/lib/api/errors";
import { fetchMyStudies } from "@/lib/api/my-study";
import type { Me, MeStudies, MetaDto } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/*
 * 요청 단위 메모(React cache): 루트 layout 과 페이지가 같은 요청에서 getUser·me_get·meta_get 을
 * 각각 부르면 Auth/DB 왕복이 중복된다. 여기 함수를 쓰면 요청당 한 번만 나간다(요청 간 공유 없음).
 * 실패(reject)도 같은 요청 안에서는 그대로 공유된다.
 */

/** 서버 클라이언트(쿠키 기반). C6: 서버 파일의 rpc()/fetch*() 에는 이걸 넘긴다 */
export const getServerClient = cache(createClient);

/**
 * 로그인 여부·식별만 필요할 때(가드·me_get 전 확인). JWT 를 검증한 claims, 비로그인이면 null.
 * 호스팅은 비대칭키(ES256)라 JWKS 로 로컬 검증 → getUser() 의 Auth 왕복이 없다.
 */
export const getAuthClaims = cache(async () => {
  const { data } = await (await getServerClient()).auth.getClaims();
  return data?.claims ?? null;
});

/**
 * Auth 서버의 최신 사용자 객체(왕복 1회). 비로그인이면 null.
 * /signup·/reset-password 는 비밀번호 설정 여부(user_metadata·identities)를 봐야 하는데 JWT claims 는 발급 시점 값이라
 * updateUser 직후에 낡을 수 있으므로 이쪽을 쓴다.
 */
export const getAuthUser = cache(async () => {
  const {
    data: { user },
  } = await (await getServerClient()).auth.getUser();
  return user;
});

/** 비로그인이면 null. me_get 은 온보딩 전에도 허용(03-api §1). 실패 시 throw */
export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await getAuthClaims())) return null;
  return rpc<Me>("me_get", {}, await getServerClient());
});

/** me_studies 요청 단위 메모 — 루트 layout(헤더 "내 스터디" 링크)과 /my-study 페이지가 한 요청에서 같이 불러도 한 번만 나간다. 실패 시 throw */
export const getMyStudies = cache(async (): Promise<MeStudies> => fetchMyStudies(await getServerClient()));

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
