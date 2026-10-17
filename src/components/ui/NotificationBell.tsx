"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { badgeText, fetchNotifications, fetchUnreadCount, markAllRead, markRead, panelShift, pollGuard, relativeTime, visibleBody } from "@/lib/api/notifications";
import type { NotificationDto } from "@/lib/api/types";
import { useMe } from "@/lib/me";

const POLL_MS = 60_000;

/** round: 버튼 모서리. Main(flat 헤더)은 rounded-[12px], 나머지 화면은 기본 rounded-full */
export function NotificationBell({ round = "rounded-full" }: { round?: string }) {
  const me = useMe();
  const router = useRouter();
  const [unread, setUnread] = useState(me?.unreadCount ?? 0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // 패널은 벨 오른쪽 끝에 붙는데, 390 폭에선 벨 오른쪽에 아바타가 있어 왼쪽이 화면 밖으로 나간다 — 열 때 오른쪽으로 민다(Q1-02)
  const [shift, setShift] = useState(0);
  // 읽음 처리 직전·직후로 올려, 그 전에 시작한 카운트 조회가 낙관적 감소를 덮어쓰지 않게 한다(Q1-13)
  const [guard] = useState(pollGuard);
  const fetchCount = useCallback(
    () => guard.run(fetchUnreadCount()).then((r) => (r.fresh ? r.value : null)),
    [guard],
  );

  const poll = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    fetchCount()
      .then((n) => n !== null && setUnread(n))
      .catch(() => undefined);
  }, [fetchCount]);

  useEffect(() => {
    if (!me) return;
    poll(); // 화면마다 벨이 새로 마운트되므로 me.unreadCount(루트 레이아웃 시점 값) 대신 현재 값으로 한 번 맞춘다
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [me, poll]);

  // 열 때의 초기화(setError/setItems)는 opener 에서 한다 — effect 본문에서 동기 setState 금지(react-hooks)
  useEffect(() => {
    if (!open) return;
    let live = true; // 열기→닫기→열기를 빠르게 하면 이전 열기의 응답이 새 초기화 뒤에 덮어쓰지 않도록
    fetchNotifications()
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(toApiError(e).message));
    fetchCount()
      .then((n) => live && n !== null && setUnread(n))
      .catch(() => undefined);
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, fetchCount]);

  if (!me) return null;

  const onToggle = () => {
    if (!open) {
      setError("");
      setItems(null);
      setShift(panelShift(boxRef.current?.getBoundingClientRect().right ?? 0, document.documentElement.clientWidth));
    }
    setOpen((v) => !v);
  };
  const markItemRead = (n: NotificationDto) => {
    if (n.readAt) return;
    guard.bump();
    setUnread((u) => Math.max(0, u - 1));
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
    markRead(n.id)
      .catch(() => undefined)
      .finally(guard.bump);
  };
  const onItemClick = (e: ReactMouseEvent<HTMLAnchorElement>, n: NotificationDto) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
      markItemRead(n); // 새 탭으로 열리는 경우: 기본 동작 유지, 읽음만 처리
      return;
    }
    e.preventDefault();
    setOpen(false);
    markItemRead(n);
    router.push(n.link);
  };
  const onReadAll = async () => {
    guard.bump();
    try {
      await markAllRead();
      guard.bump();
      setUnread(0);
      setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
        className={`relative flex h-11 w-11 items-center justify-center ${round} border border-line bg-surface`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12.5V8a5 5 0 0 1 10 0v4.5l1 1.5H3z" />
          <path d="M7.5 16a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-[5px] top-[5px] flex h-4 min-w-4 items-center justify-center rounded-lg bg-danger px-1 text-[10px] font-bold text-white">
            {badgeText(unread)}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="알림" style={{ right: -shift }} className="absolute right-0 top-[52px] z-20 flex w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-[16px] border border-line bg-surface shadow-[0_16px_40px_rgba(27,34,48,.16)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-bold">알림</span>
            {/* 알림이 하나도 없으면 누를 일이 없다 — 숨긴다(Q3-8). 누르는 영역은 위아래로 늘려 44px */}
            {items?.length !== 0 && (
              <button
                type="button"
                onClick={onReadAll}
                disabled={unread === 0 && !items?.some((n) => !n.readAt)}
                className="relative h-9 rounded-[18px] px-3 text-[13px] font-semibold text-mint before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] disabled:text-faint"
              >
                모두 읽음
              </button>
            )}
          </div>
          <div className="thin-scroll max-h-[420px] overflow-y-auto overscroll-contain border-t border-line-2">
            {error && <p role="alert" className="m-0 px-4 py-3 text-[13px] text-warn">{error}</p>}
            {items === null && !error && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">불러오는 중…</p>}
            {items?.length === 0 && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">아직 알림이 없어요</p>}
            {items?.map((n) => (
              <Link
                key={n.id}
                href={n.link}
                onClick={(e) => onItemClick(e, n)}
                className={`flex flex-col gap-[3px] border-b border-line-2 px-4 py-3 text-ink hover:bg-bg ${n.readAt ? "" : "bg-[#F5FBF9]"}`}
              >
                <span className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-mint"><span className="sr-only">읽지 않음</span></span>}
                  <span className="truncate text-[14px] font-semibold">{n.title}</span>
                </span>
                {visibleBody(n) && <span className="clamp-2 text-[13px] text-ink-2">{visibleBody(n)}</span>}
                <span className="text-[12px] text-muted">
                  {n.room ? `${n.room.title} · ` : ""}
                  {relativeTime(n.createdAt, new Date())}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
