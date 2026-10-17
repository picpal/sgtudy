"use client";

import { guardNavigate } from "@/lib/leaveGuard";
import { routes } from "@/lib/routes";
import { HomeLink } from "./HomeLink";

export function Logo() {
  return (
    <HomeLink
      // 누르는 자리 44px (Q1-4 — 보이는 로고는 30px). 저장하지 않은 편집이 있으면 이동 전에 묻는다 (Q2-1)
      className="flex min-h-11 items-center gap-[10px] pr-2 text-ink hover:text-ink"
      aria-label="슥터디 홈"
      onNavigate={(e) => guardNavigate(routes.home(), e)}
    >
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect width="30" height="30" rx="9" fill="#1B2230" />
        <path
          d="M8 11c3-3 7-3 10 0M8 19c3-3 7-3 10 0"
          fill="none"
          stroke="#5FD3B8"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[20px] font-bold tracking-[-0.02em]">슥터디</span>
    </HomeLink>
  );
}
