"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { signOut } from "@/lib/api/me";
import { useMe } from "@/lib/me";
import { AVATAR_PAL } from "@/lib/palette";
import { routes } from "@/lib/routes";

export type NavKey = "home" | "myStudy" | "schedule";

const NAV: { key: NavKey; label: string; href: string; authOnly: boolean; icon: ReactNode }[] = [
  {
    key: "home",
    label: "방 둘러보기",
    href: routes.home(),
    authOnly: false,
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
    authOnly: true,
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
    authOnly: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" />
      </svg>
    ),
  },
];

type Props = {
  /** 생략하면 어느 메뉴도 강조하지 않는다 (/me, /rooms/new 처럼 nav 키가 없는 화면) */
  active?: NavKey;
  /** flat: Main 처럼 전폭 흰 바. card: 나머지 화면처럼 둥근 카드 */
  variant?: "flat" | "card";
  /** nav 와 알림 사이에 끼울 요소 (Main 의 검색창 등) */
  children?: ReactNode;
  /** 알림 벨 (Task 4 의 <NotificationBell/>). 없으면 벨을 그리지 않는다 */
  bell?: ReactNode;
};

export function AppHeader({ active, variant = "card", children, bell }: Props) {
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = async () => {
    setOpen(false);
    try {
      await signOut();
    } catch (e) {
      console.error("[header] signOut failed", e); // 로컬 세션은 지워지므로 그래도 새로고침해 익명 상태를 반영한다
    }
    router.push(routes.home());
    router.refresh();
  };

  const round = variant === "flat" ? "rounded-[12px]" : "rounded-full";
  const inner = (
    <>
      <Logo />
      <nav aria-label="주 메뉴" className="flex gap-1 max-sm:order-last max-sm:w-full max-sm:overflow-x-auto">
        {NAV.filter((n) => me || !n.authOnly).map((n) => {
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
      <div className="flex-[1_1_24px] max-sm:flex-1" />
      {children && <div className="flex min-w-0 max-sm:order-9 max-sm:w-full [&>*]:max-sm:w-full">{children}</div>}
      {me ? (
        <>
          {bell}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={`내 프로필: ${me.nickname ?? me.email}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-bold"
              style={{ background: AVATAR_PAL[me.tone].bg, color: AVATAR_PAL[me.tone].fg }}
            >
              {me.initial}
            </button>
            {open && (
              <div role="menu" className="absolute right-0 top-[52px] z-20 flex w-[180px] flex-col rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.14)]">
                <div className="truncate px-3 py-2 text-[12px] text-muted">{me.email}</div>
                <Link role="menuitem" href={routes.me()} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-ink hover:bg-bg">
                  내 프로필
                </Link>
                <button role="menuitem" type="button" onClick={logout} className="flex h-11 items-center rounded-[10px] px-3 text-left text-[14px] font-medium text-ink hover:bg-bg">
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <Link href={routes.login(pathname)} className={`flex h-11 items-center ${round} bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white`}>
          로그인
        </Link>
      )}
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
