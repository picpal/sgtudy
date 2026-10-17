"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { toApiError } from "@/lib/api/errors";
import { DEFAULT_PARAMS, fetchRooms, toRoomCard } from "@/lib/api/rooms";
import type { RoomListResponse } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { EmptyState } from "./EmptyState";
import { FilterBar, type StatusFilter, type Tab } from "./FilterBar";
import { homeHref, parseHomeFilters, urlStep, type HomeFilters } from "./homeUrl";
import { RoomCard } from "./RoomCard";

/** 지금 주소의 필터 — 비로그인은 공개 방 탭만 */
const urlFilters = (anonymous: boolean): HomeFilters => {
  const f = parseHomeFilters(new URLSearchParams(window.location.search));
  return anonymous ? { ...f, scope: "public" } : f;
};

/** filters: 서버가 주소에서 읽어 initial 을 조회한 조건 */
export function MainScreen({ initial, filters }: { initial: RoomListResponse; filters: HomeFilters }) {
  const me = useMe();
  // 처음 값은 주소에서 — 서버 렌더·하이드레이션 때는 서버가 같은 주소로 읽은 값과 같고,
  // 다른 화면에서 뒤로 가기로 돌아와 라우터 캐시가 옛 initial 을 줄 때도 주소의 필터로 시작한다(다르면 아래 조회가 돈다)
  const [start] = useState<HomeFilters>(() => (typeof window === "undefined" ? filters : urlFilters(!me)));
  const [tab, setTab] = useState<Tab>(start.scope);
  const [status, setStatus] = useState<StatusFilter>(start.status);
  const [q, setQ] = useState(start.q);
  const [tags, setTags] = useState<string[]>(start.tags);
  // 검색어 250ms 디바운스 — 뒤로·앞으로 가기는 기다리지 않고 바로 맞춘다(setDq)
  const [dq, setDq] = useState(start.q);
  useEffect(() => {
    const t = q.trim();
    if (t === dq) return;
    const id = setTimeout(() => setDq(t), 250);
    return () => clearTimeout(id);
  }, [q, dq]);
  // attempt: "다시 시도" 를 누르면 올라가 같은 조건으로 재조회한다
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([tab, status, dq, tags, attempt]);
  // 마지막으로 끝난 조회. 첫 화면은 서버가 준 initial(DEFAULT_PARAMS) — 같은 key 면 재조회하지 않는다.
  const [done, setDone] = useState<{ key: string; res: RoomListResponse; error: string }>(() => ({
    key: JSON.stringify([filters.scope, filters.status, filters.q, filters.tags, 0]),
    res: initial,
    error: "",
  }));
  // 진행 중 여부·에러는 key 로 파생 — effect 본문에서 동기 setState 하지 않는다(C10, react-hooks 7).
  const loading = done.key !== key;
  const error = loading ? "" : done.error;
  const res = done.res;

  // 탭·상태·검색·태그 → 서버 재조회. 늦게 도착한 이전 응답은 cleanup 으로 버린다.
  useEffect(() => {
    if (key === done.key) return;
    let alive = true;
    fetchRooms({ ...DEFAULT_PARAMS, scope: tab, status, q: dq, tags })
      .then((r) => alive && setDone({ key, res: r, error: "" }))
      .catch((e) => alive && setDone((prev) => ({ key, res: prev.res, error: toApiError(e).message })));
    return () => {
      alive = false;
    };
  }, [key, done.key, tab, status, dq, tags]);

  // 필터 → 주소 (history API — 서버 컴포넌트를 다시 부르지 않는다). 탭·상태·태그는 push, 검색어만 바뀌면 replace.
  // 첫 실행(주소 정리: 비로그인 ?tab=mine 등)은 replace
  const firstSync = useRef(true);
  useEffect(() => {
    const next: HomeFilters = { scope: tab, status, q: dq, tags };
    const step = urlStep(parseHomeFilters(new URLSearchParams(window.location.search)), next);
    const first = firstSync.current;
    firstSync.current = false;
    if (step === "none") return;
    const href = `${homeHref(next)}${window.location.hash}`;
    if (step === "push" && !first) window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  }, [tab, status, dq, tags]);
  // 뒤로·앞으로 가기 → 그 기록의 필터로
  useEffect(() => {
    const onPop = () => {
      const f = urlFilters(!me);
      setTab(f.scope);
      setStatus(f.status);
      setQ(f.q);
      setDq(f.q);
      setTags(f.tags);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [me]);

  const rooms = useMemo(() => res.items.map((d) => toRoomCard(d, res.today)), [res]);
  const tagCounts = useMemo(() => res.tagFacets.map((f) => ({ slug: f.slug, tag: f.label, count: f.count })), [res.tagFacets]);
  // 결과가 0건이면 facet 에 선택 태그가 빠질 수 있다 — 그땐 slug 를 그대로 보여 준다(빈 상태 문구용)
  const selectedLabels = useMemo(() => tags.map((t) => res.tagFacets.find((f) => f.slug === t)?.label ?? t), [res.tagFacets, tags]);
  const toggleTag = (slug: string) => setTags((prev) => (prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]));
  const createHref = me ? routes.createRoom() : routes.login(routes.createRoom());

  return (
    <div className="min-h-screen bg-bg-main text-ink">
      <AppHeader active="home" variant="flat" bell={<NotificationBell round="rounded-[12px]" />}>
        <label className="flex h-10 min-w-40 flex-[0_1_280px] items-center gap-2 rounded-[12px] border border-line bg-surface-3 px-[14px]">
          <span className="sr-only">스터디 검색</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={50} placeholder="스터디 제목, 태그 검색" className="w-full min-w-0 border-0 bg-transparent text-[14px] outline-none placeholder:text-faint" />
        </label>
      </AppHeader>

      <main className="mx-auto max-w-[1376px] px-8 pb-16 pt-9 max-sm:px-4">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">슥터디 룸</h1>
            <p className="mb-0 mt-[6px] text-[15px] text-muted">함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요.</p>
          </div>
          <Link href={createHref} className="flex h-[46px] items-center gap-2 rounded-[14px] bg-navy px-5 text-[15px] font-semibold text-white hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            방 만들기
          </Link>
        </div>

        <FilterBar tab={tab} tabCounts={res.tabCounts} onTab={setTab} status={status} onStatus={setStatus} tagCounts={tagCounts} tags={tags} onToggleTag={toggleTag} onResetTags={() => setTags([])} anonymous={!me} />

        {error && (
          <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-[12px] bg-[#FFF6F5] px-4 py-3 text-[13px] text-warn">
            <span>{error}</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-9 shrink-0 rounded-[18px] border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink">
              다시 시도
            </button>
          </div>
        )}
        {!loading && !error && rooms.length === 0 && (
          <EmptyState
            q={dq}
            tab={tab}
            status={status}
            tagLabels={selectedLabels}
            // 필터 초기화는 검색어도 지운다 — 남겨 두면 결과가 계속 비어 있다(Q3-5)
            onReset={() => {
              setStatus("all");
              setTags([]);
              setQ("");
              setDq("");
            }}
            onClearQuery={() => {
              setQ("");
              setDq("");
            }}
            onBrowse={() => setTab("public")}
          />
        )}

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]" aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}>
          {rooms.map((r) => (
            <RoomCard key={r.id} room={r} selectedTags={selectedLabels} anonymous={!me} />
          ))}
        </div>
      </main>
    </div>
  );
}
