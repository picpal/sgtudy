import { routes, safeReturnTo } from "@/lib/routes";

export type AuthLink = { key: "signup" | "login"; label: string; href: string; primary: boolean };

/**
 * 비로그인 헤더 버튼 — 회원가입(보조) + 로그인(주) (시나리오 QA D4·#21). 둘 다 지금 주소로 돌아온다.
 * returnTo 는 허용 접두사만 남긴다(safeReturnTo) — 없는 최상위 주소의 404 는 / 로 (V1-03)
 */
export function anonAuthLinks(here: string): AuthLink[] {
  const back = safeReturnTo(here);
  return [
    { key: "signup", label: "회원가입", href: routes.signup(back), primary: false },
    { key: "login", label: "로그인", href: routes.login(back), primary: true },
  ];
}
