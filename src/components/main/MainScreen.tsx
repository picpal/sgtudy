"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { routes } from "@/lib/routes";
import { ROOMS, type Room } from "@/data/rooms";
import { EmptyState } from "./EmptyState";
import { FilterBar, type StatusFilter, type Tab } from "./FilterBar";
import { RoomCard } from "./RoomCard";

const inTab = (r: Room, tab: Tab) => (tab === "public" ? r.pub : tab === "mine" ? r.mine : r.created);
/** '정원 마감' 은 상태 필터상 '모집중' 으로 묶인다 */
const statusOf = (r: Room): StatusFilter => (r.status === "full" ? "recruit" : r.status);

/** 탭 카운트 — 필터와 무관한 고정 총계 */
const TAB_COUNTS: Record<Tab, number> = {
  public: ROOMS.filter((r) => r.pub).length,
  mine: ROOMS.filter((r) => r.mine).length,
  created: ROOMS.filter((r) => r.created).length,
};

export function MainScreen() {
  const [tab, setTab] = useState<Tab>("public");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const tabRooms = useMemo(() => ROOMS.filter((r) => inTab(r, tab)), [tab]);

  // 태그 칩 목록/카운트: 현재 탭의 방만 기준. 카운트 내림차순, 동률 시 ko localeCompare
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of tabRooms) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko"));
  }, [tabRooms]);

  // 적용 순서: 탭 → 상태 → 검색 → 태그
  const rooms = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tabRooms
      .filter((r) => status === "all" || statusOf(r) === status)
      .filter((r) => !needle || `${r.title} ${r.tags.join(" ")}`.toLowerCase().includes(needle))
      .filter((r) => tags.length === 0 || r.tags.some((t) => tags.includes(t)));
  }, [tabRooms, status, q, tags]);

  const toggleTag = (t: string) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className="min-h-screen bg-bg-main text-ink">
      <AppHeader active="home" variant="flat" bell={<NotificationBell />}>
        <label className="flex h-10 min-w-40 flex-[0_1_280px] items-center gap-2 rounded-[12px] border border-line bg-surface-3 px-[14px]">
          <span className="sr-only">스터디 검색</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="스터디 제목, 태그 검색"
            className="w-full min-w-0 border-0 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </label>
      </AppHeader>

      <main className="mx-auto max-w-[1376px] px-8 pb-16 pt-9 max-sm:px-4">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">스터디 방</h1>
            <p className="mb-0 mt-[6px] text-[15px] text-muted">함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요.</p>
          </div>
          <Link
            href={routes.createRoom()}
            className="flex h-[46px] items-center gap-2 rounded-[14px] bg-navy px-5 text-[15px] font-semibold text-white hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            방 만들기
          </Link>
        </div>

        <FilterBar
          tab={tab}
          tabCounts={TAB_COUNTS}
          onTab={setTab}
          status={status}
          onStatus={setStatus}
          tagCounts={tagCounts}
          tags={tags}
          onToggleTag={toggleTag}
          onResetTags={() => setTags([])}
        />

        {rooms.length === 0 && <EmptyState q={q} tab={tab} />}

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {rooms.map((r) => (
            <RoomCard key={r.id} room={r} selectedTags={tags} />
          ))}
        </div>
      </main>
    </div>
  );
}
