"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CAPTCHA_LOAD_TEXT, TURNSTILE_SCRIPT_SRC, captchaBlock, captchaOptions, captchaSiteKey } from "./captcha";

/** challenges.cloudflare.com/turnstile/v0/api.js 가 window 에 거는 것 중 여기서 쓰는 부분 */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Handle = { reset: () => void };

/**
 * Turnstile 위젯(explicit render). 위젯 모드(관리형·비대화형·보이지 않음)는 Cloudflare 대시보드에서 고른다 —
 * 여기서는 appearance: "interaction-only" 라 사람 확인이 필요할 때만 상자가 보이고 평소엔 자리도 차지하지 않는다.
 * 토큰은 한 번만 쓸 수 있고 300초 뒤 만료된다 — 만료되면 refresh-expired: auto 로 새로 받는다.
 */
function TurnstileWidget({
  siteKey,
  action,
  onToken,
  handleRef,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string | null) => void;
  handleRef: RefObject<Handle | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.turnstile);
  const [loadFailed, setLoadFailed] = useState(false);
  const tokenCb = useRef(onToken);
  useEffect(() => {
    tokenCb.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const el = box.current;
    const api = window.turnstile;
    if (!ready || !el || !api) return;
    const id = api.render(el, {
      sitekey: siteKey,
      action,
      theme: "light", // 앱은 라이트 테마만 쓴다(globals.css)
      language: "ko",
      size: "flexible",
      appearance: "interaction-only",
      "refresh-expired": "auto",
      callback: (t: string) => tokenCb.current(t),
      "expired-callback": () => tokenCb.current(null),
      "timeout-callback": () => tokenCb.current(null),
      "error-callback": () => {
        tokenCb.current(null);
        // false 를 돌려주면 Turnstile 이 스스로 다시 시도하고 콘솔에 경고를 남긴다
        return false;
      },
    });
    if (!id) return;
    handleRef.current = {
      reset: () => {
        tokenCb.current(null);
        window.turnstile?.reset(id);
      },
    };
    return () => {
      handleRef.current = null;
      tokenCb.current(null);
      window.turnstile?.remove(id);
    };
  }, [ready, siteKey, action, handleRef]);

  return (
    <>
      <Script src={TURNSTILE_SCRIPT_SRC} onReady={() => setReady(true)} onError={() => setLoadFailed(true)} />
      <div ref={box} data-testid="turnstile" className="empty:hidden" />
      {loadFailed && <p role="alert" className="m-0 text-[13px] text-warn">{CAPTCHA_LOAD_TEXT}</p>}
    </>
  );
}

/**
 * Supabase Auth 호출용 CAPTCHA. NEXT_PUBLIC_TURNSTILE_SITE_KEY 가 없으면 widget = null, block() = null,
 * options = {} — 지금과 똑같다.
 * 쓰는 법: block() 으로 막고 → auth 호출에 `...captcha.options` → 성공·실패 상관없이 reset()(토큰은 한 번만 쓴다).
 */
export function useCaptcha(action: string) {
  const siteKey = captchaSiteKey();
  const [token, setToken] = useState<string | null>(null);
  const handle = useRef<Handle | null>(null);
  const reset = useCallback(() => {
    setToken(null);
    handle.current?.reset();
  }, []);
  const enabled = siteKey !== null;
  return {
    enabled,
    token,
    options: captchaOptions(token),
    block: () => captchaBlock(enabled, token),
    reset,
    widget: siteKey ? <TurnstileWidget siteKey={siteKey} action={action} onToken={setToken} handleRef={handle} /> : null,
  };
}
