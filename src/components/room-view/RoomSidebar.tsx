"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { HomeLink } from "@/components/ui/HomeLink";
import { useState } from "react";
import { routes } from "@/lib/routes";
import { PAL } from "@/lib/palette";
import type { RoomStatus } from "@/lib/types";
import { MARK } from "@/data/room-view";
import { groupSidebar, type SidebarRoom } from "@/lib/api/room-view";
import { stickyAside, useStickyFit } from "@/lib/useStickyFit";

type Filter = "all" | RoomStatus;
const CHIPS: { id: Filter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "recruit", label: "모집중" },
  { id: "active", label: "진행중" },
  { id: "ended", label: "종료" },
];

type Props = { selected: string; items: SidebarRoom[]; total: number };

export function RoomSidebar({ selected, items, total }: Props) {
  const [st, setSt] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // ≤900 에서는 상세 아래에 접힌 채로 둔다 — 넓은 화면에선 항상 펼침
  const [open, setOpen] = useState(false);
  // 한 페이지 스크롤: 목록이 화면에 다 들어가면 붙고, 길면 페이지와 함께 내려간다(안쪽 스크롤 없음)
  const [ref, fits] = useStickyFit<HTMLElement>();
  const fold = open ? "" : "max-[901px]:hidden";
  const query = q.trim().toLowerCase();

  const heading = items.length < total ? "공개 스터디" : "전체 스터디";
  const count = items.length < total ? items.length : total;
  const groups = groupSidebar(items.filter((r) => !query || `${r.title} ${r.tags.map((t) => t.label).join(" ")}`.toLowerCase().includes(query))).filter((g) => st === "all" || st === g.status);

  return (
    <aside
      aria-label="전체 스터디 목록"
      ref={ref}
      className={`${stickyAside(fits)} flex flex-[1_1_300px] max-w-[380px] flex-col gap-[14px] rounded-[20px] bg-surface px-5 pb-5 pt-[22px] max-[901px]:max-w-none max-sm:px-4`}
    >
      <HomeLink className="inline-flex min-h-7 items-center gap-[6px] text-[13px] font-medium text-ink-3 hover:text-ink">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        카드 목록으로
      </HomeLink>
      {/* 목록은 첫 페이지(24개)만 받는다 — 잘렸으면 보이는 개수로 적는다 */}
      <h2 className="flex items-baseline gap-2 text-[18px] font-bold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="room-sidebar-list"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left min-[901px]:hidden"
        >
          {heading}
          <span className="text-[13px] font-medium text-muted">{count}개</span>
          <span className="flex-1" />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "rotate-180" : ""}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <span className="contents max-[901px]:hidden">
          {heading}
          <span className="text-[13px] font-medium text-muted">{count}개</span>
        </span>
      </h2>
      <div id="room-sidebar-list" className={`flex flex-col gap-[14px] ${fold}`}>
        <label className="flex h-[42px] items-center gap-2 rounded-[21px] border border-line px-[14px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">스터디 검색</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목, 태그 검색"
            className="w-full border-0 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </label>
        <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-[6px]">
          {CHIPS.map((c) => {
            const on = st === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSt(c.id)}
                className={`h-8 rounded-2xl border px-3 text-[13px] ${on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="-mx-[10px] flex flex-col gap-[14px] px-[10px] py-[6px]">
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-[10px]">
              <div className="mt-1 text-[12px] font-medium text-muted">{g.label}</div>
              {g.items.map((r) => {
                const on = r.id === selected;
                const mark = r.mark ? MARK[r.mark] : undefined;
                const first = r.tags[0];
                return (
                  <Link
                    key={r.id}
                    href={routes.room(r.id)}
                    aria-current={on ? "page" : undefined}
                    title={r.title}
                    className={`flex w-full flex-col rounded-2xl border px-4 py-[14px] text-left text-ink transition-[border-color,background-color,box-shadow] duration-150 hover:text-ink ${
                      on ? "border-[#3FB89C] bg-[#F5FBF9] shadow-[0_0_0_1px_#3FB89C,0_0_0_5px_#E3F6F0]" : "border-line bg-surface hover:border-line-dash"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-[6px]">
                      <span className="inline-flex h-[26px] items-center gap-[5px] rounded-[13px] border border-line bg-surface px-[9px] text-[12px] text-ink">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="16" rx="2.5" />
                          <path d="M3 10h18M8 3v4M16 3v4" />
                        </svg>
                        {r.when}
                      </span>
                      {first && (
                        <span
                          className="inline-flex h-[26px] items-center rounded-[13px] px-[10px] text-[12px] font-semibold"
                          style={{ background: PAL[first.tone].bg, color: PAL[first.tone].fg }}
                        >
                          {first.label}
                        </span>
                      )}
                      {r.tags.length > 1 && (
                        <span className="inline-flex h-[26px] items-center rounded-[13px] border border-line px-[9px] text-[12px] font-semibold text-ink-3">
                          +{r.tags.length - 1}
                        </span>
                      )}
                      <span className="flex-1" />
                      {mark && (
                        <span className="rounded-[7px] px-2 py-[3px] text-[11px] font-bold" style={{ color: mark.fg, background: mark.bg }}>
                          {mark.label}
                        </span>
                      )}
                    </span>
                    <span className="clamp-2 mt-3 text-[15px] font-semibold leading-[1.45]">{r.title}</span>
                    <span className="mt-[6px] flex justify-between gap-2 text-[12px] text-muted">
                      <span>{r.period}</span>
                      <span className="font-semibold text-ink-2">
                        {r.capCur}/{r.capMax}명
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <p className="my-2 text-center text-[13px] text-muted">조건에 맞는 스터디가 없어요</p>}
        </div>
      </div>

      <Link
        href={routes.createRoom()}
        className="mt-[2px] flex h-[50px] shrink-0 items-center justify-center gap-2 rounded-[25px] bg-navy text-[15px] font-semibold text-white hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        방 만들기
      </Link>
    </aside>
  );
}
