import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { ME, routes } from "@/lib/routes";

export type NavKey = "home" | "myStudy" | "schedule";

const NAV: { key: NavKey; label: string; href: string; icon: ReactNode }[] = [
  {
    key: "home",
    label: "방 둘러보기",
    href: routes.home(),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="9" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" />
      </svg>
    ),
  },
  {
    key: "myStudy",
    label: "내 스터디",
    href: routes.myStudy(),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3.5h10v9H3z" />
        <path d="M5.5 6.5h5M5.5 9.5h3" />
      </svg>
    ),
  },
  {
    key: "schedule",
    label: "내 일정",
    href: routes.schedule(),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" />
      </svg>
    ),
  },
];

type Props = {
  /** 현재 화면 — aria-current 와 활성 스타일 */
  active: NavKey;
  /** flat: Main 처럼 전폭 흰 바. card: 나머지 화면처럼 둥근 카드 */
  variant?: "flat" | "card";
  /** nav 와 알림 사이에 끼울 요소 (Main 의 검색창 등) */
  children?: ReactNode;
  unread?: number;
};

export function AppHeader({ active, variant = "card", children, unread = 3 }: Props) {
  const inner = (
    <>
      <Logo />
      <nav aria-label="주 메뉴" className="flex gap-1 max-sm:order-last max-sm:w-full max-sm:overflow-x-auto">
        {NAV.map((n) => {
          const on = n.key === active;
          return (
            <Link
              key={n.key}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-[7px] whitespace-nowrap rounded-[12px] px-[14px] py-[9px] text-[14px] ${
                on ? "bg-bg font-semibold text-ink" : "font-medium text-ink-3 hover:text-ink"
              }`}
            >
              {n.icon}
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-[1_1_24px]" />
      {children}
      <button
        type="button"
        aria-label={`알림 ${unread}개`}
        className={`relative flex h-11 w-11 items-center justify-center border border-line bg-surface ${
          variant === "flat" ? "rounded-[12px]" : "rounded-full"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12.5V8a5 5 0 0 1 10 0v4.5l1 1.5H3z" />
          <path d="M7.5 16a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-[5px] top-[5px] flex h-4 min-w-4 items-center justify-center rounded-lg bg-danger px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`내 프로필: ${ME.name}`}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-avatar text-[15px] font-bold text-blue-text"
      >
        {ME.initial}
      </button>
    </>
  );

  if (variant === "flat") {
    return (
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1376px] flex-wrap items-center gap-4 px-8 py-3 max-sm:px-4">{inner}</div>
      </header>
    );
  }
  return (
    <header className="mx-auto mb-4 flex w-full max-w-[1408px] flex-wrap items-center gap-3 rounded-[18px] bg-surface px-4 py-[10px]">
      {inner}
    </header>
  );
}
