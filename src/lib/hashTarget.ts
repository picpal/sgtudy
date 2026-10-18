"use client";

import { useEffect, useState } from "react";

/**
 * 알림 딥링크 앵커 (0024 계약 §7) — 서버가 만든 링크의 해시로 화면 안 영역을 찾아간다.
 *   #applications   개요 탭 승인 대기(그룹장 패널)
 *   #submissions    과제 상세(?task=)의 제출 현황
 *   #leave-requests 개요 탭 멤버 관리의 탈퇴 요청
 * 영역은 비동기로 채워지므로 "준비됨(ready)" 뒤에 스크롤·포커스한다. 한 번 찾아가면 주소에서 해시를 지운다 —
 * 탭을 갔다 와 다시 마운트되거나 다른 과제를 열 때 또 포커스를 가져가지 않게 (최종 리뷰 I1).
 * 같은 화면에서 알림을 다시 누르면 Next 는 화면을 그대로 두므로 알림 벨이 announceHash 로 알린다(주소 해시가 바뀌는 시점에 기대지 않는다).
 */
export const OVERVIEW_ANCHORS = ["applications", "leave-requests"] as const;

const EVENT = "sgtudy:hash";
type Announce = { hash: string; path: string };

/** 링크의 해시(# 없이) */
export const hashOf = (href: string): string => {
  const i = href.indexOf("#");
  return i < 0 ? "" : decodeURIComponent(href.slice(i + 1));
};
const pathOf = (href: string): string => new URL(href, "http://x").pathname;

// 다른 화면으로 넘어갈 때는 새 화면이 마운트되는 시점에 주소 해시가 아직 없을 수 있다 → 링크 경로와 함께 잠깐 기억해 둔다.
// 경로가 다른 화면(다른 방)은 가로채지 않는다 (최종 리뷰 Minor 1)
let pending: (Announce & { at: number }) | null = null;
const takePending = (id: string): boolean => {
  if (!pending || pending.hash !== id || pending.path !== window.location.pathname || Date.now() - pending.at > 8000) return false;
  pending = null;
  return true;
};

/** 알림 벨이 이동할 링크를 알린다 — 같은 화면의 앵커는 바로, 새로 열리는 화면의 앵커는 마운트될 때 찾아간다 */
export function announceHash(href: string): void {
  const hash = hashOf(href);
  if (!hash) return;
  const path = pathOf(href);
  pending = { hash, path, at: Date.now() };
  window.dispatchEvent(new CustomEvent<Announce>(EVENT, { detail: { hash, path } }));
}

/** 다른 화면 상태(탭 전환 등)를 앵커에 맞추고 싶을 때 — 지금 화면 경로로 알린 해시만 받는다 */
export function useHashAnnounce(fn: (hash: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      if (d.path === window.location.pathname) fn(d.hash);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [fn]);
}

/** 주소에서 해시만 지운다 (기록은 그대로) */
const dropHash = () => {
  if (!window.location.hash) return;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
};

/** 주소 해시(또는 알린 해시)가 id 면 true — 찾아가기 전까지. ready 가 되면 그 영역으로 스크롤하고 포커스(tabIndex=-1 을 붙여 둔다), 해시를 지운다 */
export function useHashTarget(id: string, ready: boolean): boolean {
  // seq: 같은 해시로 다시 알려도 다시 찾아가게
  const [hit, setHit] = useState<{ on: boolean; seq: number }>({ on: false, seq: 0 });
  useEffect(() => {
    // 다른 화면에서 넘어오면 주소 갱신이 이 화면 마운트보다 늦을 수 있어 잠깐 뒤에 한 번 더 본다
    const first = () => (hashOf(window.location.hash) === id || takePending(id)) && setHit((p) => (p.on ? p : { on: true, seq: p.seq + 1 }));
    first();
    const late = window.setTimeout(first, 120);
    const on = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      if (d.hash !== id || d.path !== window.location.pathname) return;
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
    if (hashOf(window.location.hash) === id) dropHash();
    // 찾아간 뒤 끈다 — 같은 화면에 남은 소비자(제출 현황 포커스 등)가 다음 과제에서 다시 쓰지 않게. 한 번 더 그려질 뿐 연쇄되지 않는다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHit((p) => ({ on: false, seq: p.seq }));
  }, [hit, ready, id]);
  return hit.on;
}
