"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { HomeLink } from "./HomeLink";
import { Logo } from "./Logo";
import { signOut } from "@/lib/api/me";
import { useMe, useMyStudyHref } from "@/lib/me";
import { AVATAR_PAL } from "@/lib/palette";
import { anonAuthLinks } from "./headerAuth";
import { FeedbackButton } from "./FeedbackButton";
import { routes } from "@/lib/routes";

// 현재 쿼리(?invite= 등)를 returnTo 에 싣기 위해 읽는다. useSearchParams 는 정적 화면(404 등)에서 Suspense 를 요구해 피한다.
// Next 의 소프트 이동은 popstate 를 내지 않지만, pathname 이 바뀌면 다시 렌더되며 스냅숏을 새로 읽는다.
const subscribeLocation = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};
const getSearch = () => window.location.search;
const getServerSearch = () => "";
const menuItems = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

export type NavKey = "home" | "myStudy" | "tasks" | "schedule";

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
    key: "tasks",
    label: "내 과제",
    href: routes.tasks(),
    authOnly: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 4.2l1.2 1.2 2-2.2M2.5 9.2l1.2 1.2 2-2.2" />
        <path d="M8 4.5h5.5M8 9.5h5.5M3 13h10.5" />
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
  /** nav 와 알림 사이에 끼울 요소 (Main 의 검색창 등) */
  children?: ReactNode;
  /** 알림 벨 (Task 4 의 <NotificationBell/>). 없으면 벨을 그리지 않는다 */
  bell?: ReactNode;
};

/** 모든 화면 공통 헤더 — 전폭 흰 바(아래 경계선). 안쪽 폭·좌우 여백은 본문 틀(PageBody·Main)과 같은 1376px·32px(≤640 16px) */
export function AppHeader({ active, children, bell }: Props) {
  const me = useMe();
  const myStudyHref = useMyStudyHref();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSyncExternalStore(subscribeLocation, getSearch, getServerSearch);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  // 키보드(↓/↑)로 열었으면 열린 직후 첫/끝 항목으로 포커스
  const focusOnOpen = useRef<"first" | "last" | null>(null);

  const items = () => menuItems(menuRef.current);
  // "내 프로필" 링크는 메뉴가 열려야 마운트돼 뷰포트 prefetch 를 못 받는다 → 아바타에 손이 가면(hover·focus·열기) /me 를 미리 받아
  // 클릭 즉시 loading 스켈레톤이 뜨게 한다. router.prefetch 는 같은 주소를 캐시에서 재사용한다
  const prefetchMe = () => {
    if (pathname !== routes.me()) router.prefetch(routes.me());
  };

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) {
      const els = menuItems(menuRef.current);
      (focusOnOpen.current === "first" ? els[0] : els[els.length - 1])?.focus();
      focusOnOpen.current = null;
    }
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Esc 로 닫으면 아바타 버튼으로 포커스를 돌려준다(Q3-19)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      avatarRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onAvatarKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (open) {
      const els = items();
      (e.key === "ArrowDown" ? els[0] : els[els.length - 1])?.focus();
      return;
    }
    focusOnOpen.current = e.key === "ArrowDown" ? "first" : "last";
    prefetchMe();
    setOpen(true);
  };
  // role=menu 안에서 ↑/↓/Home/End 로 항목 사이를 돈다
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = items();
    if (els.length === 0) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? (i + 1) % els.length : e.key === "ArrowUp" ? (i - 1 + els.length) % els.length : e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    els[next].focus();
  };

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

  const inner = (
    <>
      <Logo />
      <nav aria-label="주 메뉴" className="flex gap-1 max-sm:order-last max-sm:w-full max-sm:gap-[2px] max-sm:overflow-x-auto">
        {NAV.filter((n) => me || !n.authOnly).map((n) => {
          const on = n.key === active;
          // ≤640: 메뉴 4개가 한 줄(358px)에 들어가게 아이콘을 빼고 좌우 여백을 줄인다 — 높이는 44px 터치 영역
          // 누르는 자리는 모든 폭에서 44px (Q1-4 — 전에는 640 초과에서 39px)
          const cls = `flex min-h-11 shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[12px] px-[14px] py-0 text-[14px] max-sm:px-[10px] max-sm:[&>svg]:hidden ${
            on ? "bg-bg font-semibold text-ink" : "font-medium text-ink-3 hover:text-ink"
          }`;
          // 홈은 뷰포트 프리페치 없이 — 홈을 떠날 때마다 /?_rsc 가 더 나가지 않게 (HomeLink 주석)
          if (n.key === "home")
            return (
              <HomeLink key={n.key} aria-current={on ? "page" : undefined} className={cls}>
                {n.icon}
                {n.label}
              </HomeLink>
            );
          const href = n.key === "myStudy" ? myStudyHref : n.href;
          // 진행목표 편집 화면에 저장하지 않은 수정이 있으면 이동 전에 묻는다 (Q2-1 — GuardedLink)
          return (
            <Link key={n.key} href={href} aria-current={on ? "page" : undefined} className={cls}>
              {n.icon}
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-[1_1_24px] max-sm:flex-1" />
      {/* ≤900: 한 줄에 다 들어가지 않아(768·820 에서 벨·아바타가 둘째 줄로 밀렸다) 검색 등 끼운 요소를 맨 아래 전폭 줄로 내린다 */}
      {children && <div className="flex min-w-0 max-[901px]:order-9 max-[901px]:w-full [&>*]:max-[901px]:flex-auto">{children}</div>}
      {me ? (
        <>
          {/* 의견 보내기(0044) — 벨 왼쪽. 로그인했을 때만(스펙 D1). 390 폭에서도 로고와 한 줄(스펙 D2) */}
          <FeedbackButton />
          {bell}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={`내 프로필: ${me.nickname ?? me.email}`}
              aria-haspopup="menu"
              aria-expanded={open}
              ref={avatarRef}
              onClick={() => {
                if (!open) prefetchMe();
                setOpen((v) => !v);
              }}
              onPointerEnter={prefetchMe}
              onFocus={prefetchMe}
              onKeyDown={onAvatarKey}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-bold"
              style={{ background: AVATAR_PAL[me.tone].bg, color: AVATAR_PAL[me.tone].fg }}
            >
              {me.initial}
            </button>
            {open && (
              <div role="menu" aria-label="내 프로필 메뉴" onKeyDown={onMenuKey} className="absolute right-0 top-[52px] z-20 flex w-[180px] flex-col rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.14)]">
                <div className="truncate px-3 py-2 text-[12px] text-muted">{me.email}</div>
                <Link role="menuitem" href={routes.me()} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-ink hover:bg-bg">
                  내 프로필
                </Link>
                <Link role="menuitem" href={routes.join()} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-ink hover:bg-bg">
                  초대 코드 입력
                </Link>
                <button role="menuitem" type="button" onClick={logout} className="flex h-11 items-center rounded-[10px] px-3 text-left text-[14px] font-medium text-ink hover:bg-bg">
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        // returnTo 는 허용 접두사(/rooms/·/my-study·/schedule·/tasks·/invite/)만 남긴다 — /zzz 같은 없는 최상위 주소의 404 는 일부러 / 로,
        // /rooms/nope 처럼 접두사 안의 404 는 그 주소 그대로 간다(로그인 뒤 비공개 방이 열릴 수 있다). pathname 문제가 아니다 (V1-03)
        <span className="flex shrink-0 items-center gap-2">
          {anonAuthLinks(pathname + search).map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={`flex h-11 items-center whitespace-nowrap rounded-[12px] px-[16px] text-[14px] font-semibold ${l.primary ? "bg-navy text-white hover:text-white" : "border border-line-3 bg-surface text-ink hover:text-ink"}`}
            >
              {l.label}
            </Link>
          ))}
        </span>
      )}
    </>
  );

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1376px] flex-wrap items-center gap-4 px-8 py-3 max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-4 max-sm:py-2">{inner}</div>
    </header>
  );
}
