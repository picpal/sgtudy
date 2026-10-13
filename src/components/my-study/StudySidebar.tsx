"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";
import type { SidebarGroup } from "@/data/my-study";

export function StudySidebar({ selected, groups }: { selected: string; groups: SidebarGroup[] }) {
  return (
    <aside aria-label="내 스터디 목록" className="flex min-h-0 flex-[1_1_300px] flex-col gap-[14px] rounded-[20px] bg-surface px-5 pb-5 pt-[22px] max-[900px]:max-w-none min-[901px]:max-w-[380px]">
      <h2 className="m-0 text-[18px] font-bold">내 스터디</h2>
      <div className="flex gap-2">
        <label className="flex h-[42px] flex-1 items-center gap-2 rounded-[21px] border border-line px-[14px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">내 스터디 검색</span>
          <input type="search" placeholder="검색" className="w-full border-0 bg-transparent text-[14px] outline-none placeholder:text-faint" />
        </label>
        <button type="button" aria-label="필터" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        </button>
      </div>

      <div className="thin-scroll -mx-[10px] flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[10px] py-[6px] max-[900px]:overflow-visible">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-[10px]">
            <div className="mt-1 text-[12px] font-medium text-muted">{g.label}</div>
            {g.items.map((it) => {
              const on = it.id === selected;
              const hasD = typeof it.left === "number";
              return (
                <Link
                  key={it.id}
                  href={routes.myStudy(it.id)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex w-full flex-col rounded-[16px] border px-4 py-[14px] text-left text-ink transition-[border-color,background-color,box-shadow] duration-150 hover:text-ink ${
                    on ? "border-[#3FB89C] bg-[#F5FBF9] shadow-[0_0_0_1px_#3FB89C,0_0_0_5px_#E3F6F0]" : "border-line bg-surface hover:border-line-dash"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-[6px] overflow-hidden whitespace-nowrap">
                    <span className="inline-flex h-[26px] items-center gap-[5px] rounded-[13px] border border-line bg-surface px-[9px] text-[12px] text-ink">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="16" rx="2.5" />
                        <path d="M3 10h18M8 3v4M16 3v4" />
                      </svg>
                      {it.when}
                    </span>
                    {hasD && (
                      <span
                        title={`다음 마감까지 ${it.left}일`}
                        className="ml-auto inline-flex h-[26px] shrink-0 items-center rounded-[8px] px-[10px] text-[13px] font-bold tracking-[.01em] text-white"
                        style={{ background: it.left! <= 2 ? "#B4462B" : "#22264B" }}
                      >
                        {it.left === 0 ? "D-DAY" : `D-${it.left}`}
                      </span>
                    )}
                  </span>
                  <span className="clamp-2 mt-3 text-[15px] font-semibold leading-[1.45] text-ink" title={it.title}>
                    {it.title}
                  </span>
                  <span className="clamp-2 mt-[6px] text-[13px] leading-[1.55] text-muted">{it.intro}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <Link href={routes.home()} className="mt-[2px] flex h-[50px] shrink-0 items-center justify-center gap-2 rounded-[25px] bg-navy text-[15px] font-semibold text-white hover:text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        새 스터디 찾기
      </Link>
    </aside>
  );
}
