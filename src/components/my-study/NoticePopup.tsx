"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { markNoticesRead } from "@/lib/api/notices";
import { relativeTime } from "@/lib/api/notifications";
import type { Notice } from "@/lib/api/types";
import { MarkdownView } from "./MarkdownView";

/** "나중에" 로 넘긴 공지 `id:rev` — 이번 브라우저 탭(세션)에서만 다시 띄우지 않는다 (D7). 다시 알리기(rev+1)는 다시 뜬다 */
export const laterKey = (slug: string) => `notice-later:${slug}`;
const readLater = (slug: string): string[] => {
  try {
    const v: unknown = JSON.parse(window.sessionStorage.getItem(laterKey(slug)) ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const laterId = (n: Notice) => `${n.id}:${n.rev}`;
const writeLater = (slug: string, ids: string[]) => {
  try {
    window.sessionStorage.setItem(laterKey(slug), JSON.stringify([...new Set([...readLater(slug), ...ids])]));
  } catch {}
};

type Props = {
  slug: string;
  /** notice_inbox.popups — 고정 → 오래된 순(D5). 서버가 그룹장·이탈·종료/보관 방엔 [] 를 준다(D12·D17) */
  popups: Notice[];
  /** 다른 확인 대화상자·이탈 확인이 떠 있으면 기다린다 */
  hold: boolean;
  /** [확인] 뒤 남은 안 읽은 공지가 있나 — 탭 점(D9) */
  onAck: (unread: boolean) => void;
};

/**
 * 방 진입 공지 팝업 (스펙 §6.4) — 흐린 배경 위 대화상자(모바일은 아래 시트), 여러 개면 1/N 순서대로.
 * [확인] = 읽음(notice_read, 다시 안 뜸) · Esc·X·[나중에] = 지금 장만 이번 세션 숨기고 다음 장 · 배경 클릭은 무반응.
 */
export function NoticePopup({ slug, popups, hold, onAck }: Props) {
  // 처음 받은 큐에서 이번 세션에 넘긴 것은 뺀다. 확인·나중에 한 것은 앞에서 하나씩 지운다
  const [queue, setQueue] = useState<Notice[]>([]);
  const [total, setTotal] = useState(0);
  const [seen, setSeen] = useState<Notice[] | null>(null);
  if (popups !== seen) {
    setSeen(popups);
    const later = new Set(readLater(slug));
    const q = popups.filter((n) => !later.has(laterId(n)));
    setQueue(q);
    setTotal(q.length);
  }
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // 연타 — 상태가 다시 그려지기 전 두 번째 클릭도 막는다
  const [err, setErr] = useState(false);
  const cur = !hold ? (queue[0] ?? null) : null;
  const open = cur !== null;

  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onTrapKey = useFocusTrap(box);
  const ids = useId();

  // 열리는 동안: 연 곳 포커스를 기억했다가 돌려주고, 바탕은 스크롤·포커스·클릭을 막는다(inert)
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = box.current?.closest<HTMLElement>("[data-notice-popup]") ?? null;
    const others = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== host && !el.hasAttribute("inert"));
    others.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      others.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  // 장마다 제목으로 — 긴 본문을 스크린리더가 처음부터 읽는다
  useEffect(() => {
    if (cur) titleRef.current?.focus({ preventScroll: true });
  }, [cur]);

  // 지금 장만 넘기고 다음 장으로 — 남은 게 없으면 닫힌다
  const later = () => {
    if (busy || !cur) return;
    writeLater(slug, [laterId(cur)]);
    setQueue((q) => q.filter((n) => n.id !== cur.id));
    setErr(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      later();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const ack = async () => {
    if (!cur || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr(false);
    try {
      const r = await markNoticesRead(slug, [cur.id], [cur.rev]); // 본 리비전만 — 그사이 다시 알리기는 다음에 다시 뜬다
      onAck(r.unread);
      setQueue((q) => q.filter((n) => n.id !== cur.id));
    } catch {
      setErr(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!cur) return null;
  const step = total - queue.length + 1;
  return createPortal(
    // 배경 클릭은 아무것도 하지 않는다 — 읽게 하려는 팝업이라 실수로 닫히지 않게 (D7)
    <div data-notice-popup className="fixed inset-0 z-[45] flex items-center justify-center bg-[rgba(27,34,48,.45)] p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-t`}
        aria-describedby={`${ids}-m`}
        onKeyDown={onTrapKey}
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col gap-4 rounded-[18px] bg-surface p-6 shadow-[0_20px_60px_rgba(27,34,48,.25)] motion-safe:animate-[notice-pop_.18s_ease-out] max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[18px] max-sm:px-4 max-sm:pb-[max(16px,env(safe-area-inset-bottom))] max-sm:motion-safe:animate-[notice-sheet_.22s_ease-out]"
      >
        <div className="flex items-center gap-2">
          <span className="rounded-[6px] bg-mint-soft px-[7px] py-px text-[12px] font-semibold text-mint">공지</span>
          {total > 1 && (
            <span className="text-[12px] font-semibold text-muted" aria-label={`${total}개 중 ${step}번째`}>
              {step}/{total}
            </span>
          )}
          <button type="button" aria-label="닫기" title="나중에 보기" onClick={later} className="ml-auto flex size-11 items-center justify-center rounded-full text-ink-3 hover:bg-bg hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="-mt-2 flex flex-col gap-1">
          <h2 ref={titleRef} id={`${ids}-t`} tabIndex={-1} className="m-0 break-words text-[20px] font-bold leading-[1.4] outline-none max-sm:text-[18px]">
            {cur.title}
          </h2>
          <p id={`${ids}-m`} className="m-0 text-[12px] text-muted">
            {cur.author?.nickname ?? "그룹장"} · {relativeTime(cur.createdAt, new Date())}
            {cur.edited && " · 수정됨"}
          </p>
        </div>
        {/* 본문은 대화상자 설명으로 묶지 않는다 — 제목 포커스에서 스크린리더가 본문을 두 번 읽지 않게 */}
        <div className="thin-scroll max-h-[60dvh] overflow-y-auto max-sm:max-h-[55dvh]">
          <MarkdownView src={cur.bodyMd} />
        </div>
        {err && (
          <p role="alert" className="m-0 text-[13px] font-medium text-warn">
            확인 처리에 실패했어요. 다시 시도해 주세요
          </p>
        )}
        <div className="flex justify-end gap-2 max-sm:grid max-sm:grid-cols-2">
          <button type="button" onClick={later} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink">
            나중에 보기
          </button>
          <button type="button" onClick={() => void ack()} disabled={busy} aria-busy={busy || undefined} className="h-11 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-60">
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
