"use client";

import { useEffect, useRef, useState } from "react";

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
type Announce = { hash: string; path: string; search: string };

/** 링크의 해시(# 없이) */
export const hashOf = (href: string): string => {
  const i = href.indexOf("#");
  if (i < 0) return "";
  const raw = href.slice(i + 1);
  // 손으로 만든 깨진 해시(#%E0)는 던진다 — 렌더 경로(peekHashPrefix)에서도 불리므로 날 것 그대로 둔다(어떤 앵커와도 맞지 않는다)
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
const pathOf = (href: string): string => new URL(href, "http://x").pathname;
const searchOf = (href: string): string => new URL(href, "http://x").search;

// 다른 화면으로 넘어갈 때는 새 화면이 마운트되는 시점에 주소 해시가 아직 없을 수 있다 → 링크 경로와 함께 잠깐 기억해 둔다.
// 경로가 다른 화면(다른 방)은 가로채지 않는다 (최종 리뷰 Minor 1)
let pending: (Announce & { at: number }) | null = null;
// accept: 링크 쿼리로 받는 쪽을 가린다(댓글 = 그 노드의 ?task=·?item= 링크만). 없으면 경로만 본다
const livePending = (match: (hash: string) => boolean, accept?: (search: string) => boolean): string | null =>
  !pending || !match(pending.hash) || pending.path !== window.location.pathname || Date.now() - pending.at > 8000 || (accept && !accept(pending.search)) ? null : pending.hash;
/** 맞는 pending 해시를 꺼낸다(꺼내면 지운다) */
const takePending = (match: (hash: string) => boolean, accept?: (search: string) => boolean): string | null => {
  const h = livePending(match, accept);
  if (h !== null) pending = null;
  return h;
};

/** 알림 벨이 이동할 링크를 알린다 — 같은 화면의 앵커는 바로, 새로 열리는 화면의 앵커는 마운트될 때 찾아간다 */
export function announceHash(href: string): void {
  const hash = hashOf(href);
  if (!hash) return;
  const path = pathOf(href);
  const search = searchOf(href);
  pending = { hash, path, search, at: Date.now() };
  window.dispatchEvent(new CustomEvent<Announce>(EVENT, { detail: { hash, path, search } }));
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

const ITEM_EVENT = "sgtudy:item";

/** 알림 벨이 이동할 링크의 ?item= 을 알린다 — 같은 화면에서 같은 item 알림을 다시 누르면 서버 prop(initialItem)이 그대로라
 *  화면이 모른다(상세 안에서 다른 항목으로 옮긴 뒤 등). 화면은 주소가 그 item 이 된 뒤 연다 (백로그 F 재리뷰 m1) */
export function announceItem(href: string): void {
  const u = new URL(href, "http://x");
  const item = u.searchParams.get("item");
  if (item) window.dispatchEvent(new CustomEvent<{ item: string; path: string }>(ITEM_EVENT, { detail: { item, path: u.pathname } }));
}

/** 지금 화면 경로로 알린 item 만 받는다 */
export function useItemAnnounce(fn: (item: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ item: string; path: string }>).detail;
      if (d.path === window.location.pathname) fn(d.item);
    };
    window.addEventListener(ITEM_EVENT, on);
    return () => window.removeEventListener(ITEM_EVENT, on);
  }, [fn]);
}

const TAB_EVENT = "sgtudy:tab";

/** 알림 벨이 이동할 링크의 ?tab= 을 알린다(항목·과제 없는 탭 링크만) — 같은 방 화면 key(page.tsx: tab)가 같으면 다시 마운트되지 않아
 *  다른 탭을 보던 화면이 그 탭으로 옮기지 못한다(공지 알림 ?tab=notice, 0040) */
export function announceTab(href: string): void {
  const u = new URL(href, "http://x");
  const tab = u.searchParams.get("tab");
  if (tab && !u.searchParams.has("item") && !u.searchParams.has("task")) window.dispatchEvent(new CustomEvent<{ tab: string; path: string }>(TAB_EVENT, { detail: { tab, path: u.pathname } }));
}

/** 지금 화면 경로로 알린 탭만 받는다 */
export function useTabAnnounce(fn: (tab: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ tab: string; path: string }>).detail;
      if (d.path === window.location.pathname) fn(d.tab);
    };
    window.addEventListener(TAB_EVENT, on);
    return () => window.removeEventListener(TAB_EVENT, on);
  }, [fn]);
}

const TASK_EVENT = "sgtudy:task";

/** 알림 벨이 이동할 링크의 ?task= 를 알린다 — 같은 과제 key(page.tsx: task)의 화면은 다시 마운트되지 않아, 다른 탭·항목을 보던 화면이
 *  그 과제 상세로 돌아가지 못한다(댓글 멘션 #comment-, 0041). 화면은 주소가 그 task 가 된 뒤 연다 */
export function announceTask(href: string): void {
  const u = new URL(href, "http://x");
  const task = u.searchParams.get("task");
  if (task) window.dispatchEvent(new CustomEvent<{ task: string; path: string }>(TASK_EVENT, { detail: { task, path: u.pathname } }));
}

/** 지금 화면 경로로 알린 task 만 받는다 */
export function useTaskAnnounce(fn: (task: string) => void): void {
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ task: string; path: string }>).detail;
      if (d.path === window.location.pathname) fn(d.task);
    };
    window.addEventListener(TASK_EVENT, on);
    return () => window.removeEventListener(TASK_EVENT, on);
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
    // 해시와 pending 을 둘 다 본다(단락 평가로 pending 이 남지 않게) — 남으면 늦은 재확인·재마운트가 다시 찾아간다 (재리뷰 Minor A)
    const first = () => {
      const byHash = hashOf(window.location.hash) === id;
      const byPending = takePending((h) => h === id) !== null;
      if (byHash || byPending) setHit((p) => (p.on ? p : { on: true, seq: p.seq + 1 }));
    };
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

/* ---------- 접두사 앵커 (댓글 #comment-{id}, 0041 스펙 D15·D16) ---------- */
export const COMMENT_HASH_PREFIX = "comment-";
/** "comment-12" → "12". 댓글 해시가 아니면 null */
export const commentIdOfHash = (hash: string): string | null => {
  const m = /^comment-(\d+)$/.exec(hash);
  return m ? m[1] : null;
};
const prefixMatch = (prefix: string) => (h: string) => h.length > prefix.length && h.startsWith(prefix);

/**
 * 지금 주소 해시 또는 이 화면 경로로 알린(아직 아무도 받지 않은) 해시 중 접두사가 맞는 것 — 꺼내지 않고 보기만 한다.
 * 화면 첫 상태를 정할 때 쓴다(댓글 딥링크로 들어온 과제 상세는 제출 영역으로 끌어가지 않는다 — state.ts leafFocusForHash)
 */
export function peekHashPrefix(prefix: string): string | null {
  if (typeof window === "undefined") return null;
  const h = hashOf(window.location.hash);
  return prefixMatch(prefix)(h) ? h : livePending(prefixMatch(prefix));
}

/**
 * useHashTarget 의 접두사판 — 고정 id 대신 `{prefix}…` 해시를 받아 **찾은 해시(id)** 를 돌려준다(찾아가기 전까지, 아니면 null).
 * pending·announce·해시 제거 규칙은 같다. 화면은 돌려받은 id 로 데이터를 불러오고(댓글 from=…), ready 가 되면 이 훅이
 * 그 id 의 요소(없으면 fallbackId — 지워진·없는 댓글은 섹션)로 가운데 스크롤 + 포커스하고 해시를 지운 뒤 null 로 돌아간다
 */
export function useHashPrefixTarget(prefix: string, ready: boolean, opts: { fallbackId?: string; accept?: (search: string) => boolean } = {}): string | null {
  const [hit, setHit] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 });
  const { fallbackId, accept } = opts;
  // accept 는 매 렌더 새 함수일 수 있다 — 구독을 다시 걸지 않게 ref 로 본다
  const acceptRef = useRef(accept);
  useEffect(() => {
    acceptRef.current = accept;
  });
  useEffect(() => {
    const match = prefixMatch(prefix);
    const ok = (search: string) => !acceptRef.current || acceptRef.current(search);
    const first = () => {
      const byHash = hashOf(window.location.hash);
      const byPending = takePending(match, acceptRef.current);
      const id = match(byHash) && ok(window.location.search) ? byHash : byPending;
      if (id) setHit((p) => (p.id === id ? p : { id, seq: p.seq + 1 }));
    };
    first();
    const late = window.setTimeout(first, 120);
    const on = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      // 다른 노드의 링크(같은 화면에서 다른 회차 상세로 가는 알림)는 받지 않는다 — pending 은 그 노드 상세가 열리며 받는다
      if (!match(d.hash) || d.path !== window.location.pathname || !ok(d.search)) return;
      pending = null; // 이 화면이 받았다
      setHit((p) => ({ id: d.hash, seq: p.seq + 1 }));
    };
    const onHash = () => {
      const h = hashOf(window.location.hash);
      if (match(h) && ok(window.location.search)) setHit((p) => ({ id: h, seq: p.seq + 1 }));
    };
    window.addEventListener(EVENT, on);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener(EVENT, on);
      window.removeEventListener("hashchange", onHash);
    };
  }, [prefix]);
  useEffect(() => {
    if (!hit.id || !ready) return;
    const el = document.getElementById(hit.id) ?? (fallbackId ? document.getElementById(fallbackId) : null);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    if (hashOf(window.location.hash) === hit.id) dropHash();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHit((p) => ({ id: null, seq: p.seq }));
  }, [hit, ready, fallbackId]);
  return hit.id;
}
