"use client";

import { useEffect } from "react";

/**
 * iOS Safari 는 16px 보다 작은 입력칸에 포커스하면 화면을 확대한다. 입력칸 글자를 키우면 톤이 깨지니(내 목표 추가 등 14px),
 * iOS 에서만 viewport 에 maximum-scale=1 을 더한다 — iOS 10+ 는 이 값으로 손가락 확대를 막지 않고 포커스 자동 확대만 멈춘다.
 * 안드로이드는 이 값이 손가락 확대까지 막아 붙이지 않는다(자동 확대도 없다)
 */
export function IosNoInputZoom() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    if (!ios) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta || /maximum-scale/.test(meta.content)) return;
    meta.content = `${meta.content}, maximum-scale=1`;
  }, []);
  return null;
}
