"use client";

import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { useSearchParams } from "next/navigation";
import { screenKeyText } from "@/lib/leaveGuard";

/**
 * mount = 지금 마운트된 화면의 세대(이동마다 +1 — 예전 key 로 돌아가도 다시 마운트) · server = 마지막으로 받은 서버 key ·
 * url = 마지막 렌더의 주소 key · full = 마지막 렌더의 쿼리 전체 · pop = 본 뒤로/앞으로 가기 수 ·
 * armed = 뒤로/앞으로 가기 뒤 아직 주소가 바뀌지 않았다 · nav = 뒤로/앞으로 가기로 온 주소 key(서버 key 가 늦게 따라와도 이동으로 본다)
 */
export type MountState = { mount: number; server: string; url: string; full: string; pop: number; armed: boolean; nav: string | null };

export const initialMount = (server: string, url: string, full: string, pop: number): MountState => ({ mount: 0, server, url, full, pop, armed: false, nav: null });

/**
 * 화면을 다시 마운트할지 — 이동만 다시 마운트하고 router.refresh() 는 다시 마운트하지 않는다.
 * 화면은 탭·상세를 열 때 주소의 ?tab=·?task= 를 History API 로 바꾼다(서버 왕복 없음). 그 뒤 제출·완료 등이 router.refresh() 를 부르면
 * 서버는 바뀐 주소로 key 를 다시 만든다 — 그대로 key 로 쓰면 화면 전체(시험·제출·댓글 섹션)가 새로 마운트돼 한꺼번에 다시 불러오고,
 * 그 요청이 실패하면 받아 둔 값 없이 [다시 시도] 만 남는다(2026-10-25 iPhone 시험 제출).
 * - 이동(router.push·알림 링크): 주소와 서버 key 가 한 렌더에서 함께 바뀐다 → 다시 마운트
 * - 뒤로/앞으로 가기: 주소가 먼저, 서버 key 가 뒤 렌더에 올 수 있다 → popstate 뒤 바뀐 주소(nav)로 서버 key 가 오면 다시 마운트
 * - 새로 고침: 화면이 앞서 직접 바꾼 주소를 서버 key 가 뒤늦게 따라온다 → 그대로
 */
export function nextMount(prev: MountState, server: string, url: string, full: string, pop: number): MountState {
  let s = prev;
  // popstate 는 주소 렌더보다 먼저 올 수도, 뒤에 올 수도 있다(Next 가 먼저 받아 주소를 바꾼다) — 이미 서버 key 와 다른 주소면 그 주소가 목적지
  if (pop !== s.pop) s = { ...s, pop, armed: true, nav: s.url !== s.server ? s.url : s.nav };
  // 주소가 바뀌었다 — 뒤로/앞으로 가기 뒤면 그 주소 key 를 기억(nav), 화면이 직접 쓴 주소면 지운다
  if (full !== s.full) s = { ...s, full, url, nav: s.armed ? url : null, armed: false };
  if (server === s.server) return s;
  const refresh = url === prev.url && url === server && s.nav !== url;
  return { ...s, mount: refresh ? s.mount : s.mount + 1, server, url, nav: null };
}

let pops = 0;
const subscribePop = (cb: () => void) => {
  const on = () => {
    pops += 1;
    cb();
  };
  window.addEventListener("popstate", on);
  return () => window.removeEventListener("popstate", on);
};
const getPops = () => pops;
const getServerPops = () => 0;

/** 내 스터디 화면 key 를 들고 있는 껍데기 — 이동이면 children 을 새 key 로 다시 마운트, 새로 고침이면 그대로 */
export function ScreenMount({ room, serverKey, children }: { room: string; serverKey: string; children: ReactElement }) {
  const sp = useSearchParams();
  const pop = useSyncExternalStore(subscribePop, getPops, getServerPops);
  const url = screenKeyText(room, sp);
  const full = sp.toString();
  const [s, setS] = useState<MountState>(() => initialMount(serverKey, url, full, pop));
  const next = nextMount(s, serverKey, url, full, pop);
  if (next !== s) setS(next);
  // 뒤로/앞으로 가기 바로 뒤의 주소 변경만 이동으로 본다 — 화면 안 기록(상세 ↔ 목록)을 오간 뒤 화면이 직접 쓰는 주소까지 이동으로 보지 않게 잠시 뒤 푼다
  const armed = next.armed;
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setS((p) => (p.armed ? { ...p, armed: false } : p)), 500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return <ScreenKeyed key={next.mount}>{children}</ScreenKeyed>;
}

function ScreenKeyed({ children }: { children: ReactElement }) {
  return children;
}
