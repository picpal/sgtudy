/**
 * Cloudflare Turnstile CAPTCHA — 기능 플래그와 순수 로직.
 *
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY 가 있을 때만 위젯을 그리고 토큰을 보낸다. 없으면 지금과 똑같이 동작한다
 * (호스팅에서 CAPTCHA 를 켜기 전에 이 코드를 먼저 배포해도 안전하다 — README "CAPTCHA 켜기").
 *
 * GoTrue 가 CAPTCHA 를 검사하는 곳(security_captcha_enabled = true 일 때, service_role 은 제외):
 *   POST /signup · /otp · /magiclink · /recover · /resend · /sso, POST /token 은 grant_type=password 일 때만.
 *   /verify(코드 확인)·/user(비밀번호 저장)·/reauthenticate(로그인한 사용자, 본문 없음)는 검사하지 않는다.
 * 이 앱에서 해당하는 호출: signInWithPassword(/login) · signInWithOtp(/signup·/reset-password 코드 발송·재전송).
 */

/** next 는 `process.env.NEXT_PUBLIC_*` 를 이 모양 그대로 써야 빌드 때 값으로 바꿔 넣는다(구조 분해·동적 키 금지) */
export const TURNSTILE_SITE_KEY: string | undefined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** 빈 문자열·공백만 있는 값은 꺼진 것으로 본다(Vercel 에 빈 값으로 등록돼도 위젯이 깨진 채 뜨지 않게) */
export function captchaSiteKey(raw: string | undefined = TURNSTILE_SITE_KEY): string | null {
  const key = raw?.trim();
  return key ? key : null;
}

export const CAPTCHA_MISSING_TEXT = "보안 확인이 끝나지 않았어요 · 잠시 기다리거나 확인 상자를 눌러 주세요";
export const CAPTCHA_FAILED_TEXT = "보안 확인이 만료됐거나 실패했어요 · 다시 확인한 뒤 시도해 주세요";
export const CAPTCHA_LOAD_TEXT = "보안 확인을 불러오지 못했어요 · 새로고침하거나 잠시 후 다시 시도해 주세요";

/**
 * 보내기 전에 확인: CAPTCHA 가 켜져 있는데 토큰이 없으면(아직 안 끝남·만료) 막을 문구, 아니면 null.
 * 꺼져 있으면 언제나 null — 지금 동작 그대로.
 */
export function captchaBlock(enabled: boolean, token: string | null): string | null {
  return enabled && !token ? CAPTCHA_MISSING_TEXT : null;
}

/**
 * supabase-js auth 호출의 options 에 펼쳐 넣을 값. 토큰이 없으면 아무것도 넣지 않는다
 * (꺼진 상태에서 요청 본문이 지금과 같게 — supabase-js 가 captcha_token: undefined 는 JSON 에서 뺀다).
 */
export function captchaOptions(token: string | null): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}
