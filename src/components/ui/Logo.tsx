"use client";

import { HomeLink } from "./HomeLink";

export function Logo() {
  return (
    <HomeLink
      // 누르는 자리 44px (Q1-4 — 보이는 로고는 30px). 이탈 확인은 HomeLink(GuardedLink)가 한다 (Q2-1)
      className="flex min-h-11 items-center gap-[10px] pr-2 text-ink hover:text-ink"
      aria-label="슥터디 홈"
    >
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect width="30" height="30" rx="9" fill="#1B2230" />
        {/* 「슥」 심볼(sseuk-logo-02-solid)을 흰색으로 — 1024 원본 좌표를 그대로 두고 viewBox 로 가운데 맞춤 */}
        <svg x="6.5" y="6" width="17" height="18" viewBox="170 133 684 774" fill="#fff">
          <path d="M330 535 512 312 694 535H815Q860 535 828 495L578 183Q512 105 446 183L196 495Q164 535 209 535Z" />
          <path d="M252 609H772Q818 609 818 655V851Q818 897 772 897H694V742H252Q206 742 206 696V655Q206 609 252 609Z" />
        </svg>
      </svg>
      <span className="text-[20px] font-bold tracking-[-0.02em]">슥터디</span>
    </HomeLink>
  );
}
