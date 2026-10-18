"use client";

import { useEffect, useState } from "react";

/**
 * 알림 딥링크 앵커 (0024 계약 §7) — 서버가 만든 링크의 해시로 화면 안 영역을 찾아간다.
 *   #applications   개요 탭 승인 대기(그룹장 패널)
 *   #submissions    과제 상세(?task=)의 제출 현황
 *   #leave-requests 개요 탭 멤버 관리의 탈퇴 요청
 * 영역은 비동기로 채워지므로 "준비됨(ready)" 뒤에 스크롤·포커스한다. 같은 화면에서 알림을 다시 누르면 Next 는 화면을 그대로 두므로
 * 알림 벨이 announceHash 로 알린다(주소 해시가 바뀌는 시점에 기대지 않는다).
 */
export const OVERVIEW_ANCHORS = ["applications", "leave-requests"] as const;

const EVENT = "sgtudy:hash";

/** 링크의 해시(# 없이) */
export const hashOf = (href: string): string => {
  const i = href.indexOf("#");
  return i < 0 ? "" : decodeURIComponent(href.slice(i + 1));
};

// 다른 화면으로 넘어갈 때는 새 화면이 마운트되는 시점에 주소 해시가 아직(또는 화면의 주소 정리로) 없을 수 있다 → 잠깐 기억해 둔다
let pending: { hash: string; at: number } | null = null;
const takePending = (id: string): boolean => {
  if (!pending || pending.hash !== id || Date.now() - pending.at > 8000) return false;
  pending = null;
  return true;
};

/** 알림 벨이 이동할 링크를 알린다 — 같은 화면의 앵커는 바로, 새로 열리는 화면의 앵커는 마운트될 때 찾아간다 */
export function announceHash(href: string): void {
  const h = hashOf(href);
  if (!h) return;
  pending = { hash: h, at: Date.now() };
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: h }));
}

/** 다른 화면 상태(탭 전환 등)를 앵커에 맞추고 싶을 때 — 알린 해시를 받는다 */
export function useHashAnnounce(fn: (hash: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => fn((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [fn]);
}

/** 주소 해시(또는 알린 해시)가 id 면 true. ready 가 되면 그 영역으로 스크롤하고 포커스(tabIndex=-1 을 붙여 둔다) */
export function useHashTarget(id: string, ready: boolean): boolean {
  // seq: 같은 해시로 다시 알려도 다시 찾아가게
  const [hit, setHit] = useState<{ on: boolean; seq: number }>({ on: false, seq: 0 });
  useEffect(() => {
    // 다른 화면에서 넘어오면 주소 갱신이 이 화면 마운트보다 늦을 수 있어 잠깐 뒤에 한 번 더 본다
    const first = () => (hashOf(window.location.hash) === id || takePending(id)) && setHit((p) => (p.on ? p : { on: true, seq: p.seq + 1 }));
    first();
    const late = window.setTimeout(first, 120);
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      pending = null; // 이 화면이 받았다
      setHit((p) => ({ on: true, seq: p.seq + 1 }));
    };
    const onHash = () => hashOf(window.location.hash) === id && setHit((p) => ({ on: true, seq: p.seq + 1 }));
    window.addEventListener(EVENT, on);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener(EVENT, on);
      window.removeEventListener("hashchange", onHash);
    };
  }, [id]);
  useEffect(() => {
    if (!hit.on || !ready) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [hit, ready, id]);
  return hit.on;
}
