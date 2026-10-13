"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { badgeText, fetchNotifications, fetchUnreadCount, markAllRead, markRead, relativeTime } from "@/lib/api/notifications";
import type { NotificationDto } from "@/lib/api/types";
import { useMe } from "@/lib/me";

const POLL_MS = 60_000;

export function NotificationBell() {
  const me = useMe();
  const router = useRouter();
  const [unread, setUnread] = useState(me?.unreadCount ?? 0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    fetchUnreadCount().then(setUnread).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!me) return;
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
    fetchNotifications()
      .then((r) => setItems(r.items))
      .catch((e) => setError(toApiError(e).message));
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me) return null;

  const onToggle = () => {
    if (!open) {
      setError("");
      setItems(null);
    }
    setOpen((v) => !v);
  };
  const onItem = async (n: NotificationDto) => {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      markRead(n.id).catch(() => undefined);
    }
    router.push(n.link);
  };
  const onReadAll = async () => {
    try {
      await markAllRead();
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
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface"
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
        <div role="dialog" aria-label="알림" className="absolute right-0 top-[52px] z-20 flex w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-[16px] border border-line bg-surface shadow-[0_16px_40px_rgba(27,34,48,.16)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-bold">알림</span>
            <button type="button" onClick={onReadAll} disabled={unread === 0} className="h-9 rounded-[18px] px-3 text-[13px] font-semibold text-mint disabled:text-faint">
              모두 읽음
            </button>
          </div>
          <div className="thin-scroll max-h-[420px] overflow-y-auto border-t border-line-2">
            {error && <p role="alert" className="m-0 px-4 py-3 text-[13px] text-warn">{error}</p>}
            {items === null && !error && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">불러오는 중…</p>}
            {items?.length === 0 && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">아직 알림이 없어요</p>}
            {items?.map((n) => (
              <Link
                key={n.id}
                href={n.link}
                onClick={(e) => {
                  e.preventDefault();
                  onItem(n);
                }}
                className={`flex flex-col gap-[3px] border-b border-line-2 px-4 py-3 text-ink hover:bg-bg ${n.readAt ? "" : "bg-[#F5FBF9]"}`}
              >
                <span className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-mint" aria-label="읽지 않음" />}
                  <span className="truncate text-[14px] font-semibold">{n.title}</span>
                </span>
                {n.body && <span className="clamp-2 text-[13px] text-ink-2">{n.body}</span>}
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
