"use client";

import { useSyncExternalStore } from "react";
import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { MoreMenu, type MoreMenuItem } from "@/components/ui/MoreMenu";
import { PAL } from "@/lib/palette";
import { roomStatusLabel, type RoomStatus } from "@/lib/types";
import type { StudyRoom } from "@/lib/api/my-study";
import { routes, type MyStudyTab } from "@/lib/routes";
import { INFO_DL, PeriodText } from "@/components/ui/InfoList";
import { RoundIconButton, toneOfName } from "./bits";

export type TabId = MyStudyTab;
export const TABS: [TabId, string][] = [
  ["overview", "개요"],
  ["notice", "공지"],
  ["curriculum", "진행목표"],
  ["board", "보드"],
  ["calendar", "캘린더"],
  ["gantt", "간트"],
  ["wrong", "오답노트"],
];

const STATUS_BG: Record<RoomStatus, string> = { recruit: "#2F5BC2", active: "#0D7A64", ended: "#5B6675" };

/** draft(모집 시작 전)는 방 목록 카드와 같은 "준비중" 회색 배지 (Q2-03). archived 는 "보관됨" 회색 (시나리오 QA #6) */
export function StatusBadge({ status, draft, archived }: { status: RoomStatus; draft?: boolean; archived?: boolean }) {
  if (archived)
    return (
      <Badge bg="#E9EEF0" fg="#4A5563" height={26} px={10} radius={8} fontSize={12} weight={600}>
        보관됨
      </Badge>
    );
  if (draft)
    return (
      <Badge bg="#E9EEF0" fg="#4A5563" height={26} px={10} radius={8} fontSize={12} weight={600}>
        {roomStatusLabel(status, true)}
      </Badge>
    );
  return (
    <Badge bg={STATUS_BG[status]} fg="#FFFFFF" height={26} px={10} radius={8} fontSize={12} weight={600}>
      {roomStatusLabel(status)}
    </Badge>
  );
}

const Dt = ({ children, icon }: { children: string; icon: React.ReactNode }) => (
  <dt className="flex items-center gap-[9px] text-muted">
    {icon}
    {children}
  </dt>
);
const ic = (d: React.ReactNode, extra?: object) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra}>
    {d}
  </svg>
);

// 방 정보(기간·상태·참가 방식…) 펼침 — 참가한 뒤엔 덜 중요해 기본은 접고, 펼친 선택만 이 브라우저에 기억한다(방마다가 아니라 하나).
// 방 둘러보기 방 화면(RoomInfo)은 늘 펼친 그대로
export const META_OPEN_KEY = "sgtudy:room-meta-open";
const META_EVENT = "sgtudy:room-meta-open";
const subscribeMeta = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(META_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(META_EVENT, cb);
  };
};
// 저장소가 막힌 브라우저(사생활 모드 등)에서도 이번 탭에선 눌러서 펼쳐지게 메모리 값을 같이 둔다
let memOpen = false;
const readMeta = () => {
  try {
    return window.localStorage.getItem(META_OPEN_KEY) === "1";
  } catch {
    return memOpen;
  }
};
const writeMeta = (open: boolean) => {
  memOpen = open;
  try {
    if (open) window.localStorage.setItem(META_OPEN_KEY, "1");
    else window.localStorage.removeItem(META_OPEN_KEY);
  } catch {}
  window.dispatchEvent(new Event(META_EVENT));
};

/** onShare: 공개 방 주소 복사 · more: 더보기 메뉴 · noticeUnread: 안 읽은 공지가 있다(공지 탭 점, D9) */
export function StudyHeaderInfo({ room, tab, onTab, onShare, more, noticeUnread = false }: { room: StudyRoom; tab: TabId; onTab: (t: TabId) => void; onShare: () => void; more: MoreMenuItem[]; noticeUnread?: boolean }) {
  const metaOpen = useSyncExternalStore(subscribeMeta, readMeta, () => false);
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* 긴 제목은 두 줄에서 줄인다(전체는 title·방 화면) — 좁은 폭에서 헤더가 화면을 덮지 않게 (Q3-14) */}
          <h1 title={room.title} className="m-0 line-clamp-2 break-words text-[30px] font-bold leading-[1.3] tracking-[-0.02em] max-sm:text-[22px]">
            {room.title}
          </h1>
          <p className="mt-2 mb-0 line-clamp-3 break-words text-[15px] leading-[1.6] text-ink-3 max-sm:text-[14px]">{room.intro}</p>
        </div>
        <div className="flex shrink-0 gap-[6px]">
          <RoundIconButton label="공유" title="링크 복사" onClick={onShare}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 8l5-5 5 5" />
              <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
          </RoundIconButton>
          <MoreMenu items={more} />
        </div>
      </div>

      {tab === "overview" && (
        // 접힘 = 상태 배지·D-day 한 줄만 — 이번 회차 카드가 바로 아래로 올라온다. 줄 오른쪽 끝에 펼치기 버튼
        <div className="mt-6 flex items-start gap-2 max-sm:mt-4">
          <div className="min-w-0 flex-1">
            {!metaOpen && (
              <div data-room-meta-summary className="flex min-h-11 flex-wrap items-center gap-2">
                <StatusBadge status={room.status} draft={room.draft} archived={room.archived} />
                <span className={`rounded-[7px] px-2 py-[2px] text-[12px] font-semibold ${room.archived ? "bg-slate-soft text-ink-3" : "bg-mint-soft text-mint"}`}>{room.draft ? `모집 전 · ${room.dday}` : room.dday}</span>
              </div>
            )}
            <dl id="my-study-room-meta" hidden={!metaOpen} className={`m-0 ${INFO_DL}`}>
              <Dt icon={ic(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)}>기간</Dt>
              <dd className="m-0 flex flex-wrap items-center gap-x-2 font-medium">
                <PeriodText period={room.period} />
                <span className={`rounded-[7px] px-2 py-[2px] text-[12px] font-semibold ${room.archived ? "bg-slate-soft text-ink-3" : "bg-mint-soft text-mint"}`}>{room.draft ? `모집 전 · ${room.dday}` : room.dday}</span>
              </dd>
              <Dt icon={ic(<path d="M4 21V4M4 4h12l-2 4 2 4H4" />)}>상태</Dt>
              <dd className="m-0">
                <StatusBadge status={room.status} draft={room.draft} archived={room.archived} />
              </dd>
              <Dt icon={ic(<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>)}>참가 방식</Dt>
              <dd className="m-0 font-medium">{room.joinMode}</dd>
              <Dt icon={ic(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>)}>공개 범위</Dt>
              <dd className="m-0 font-medium">{room.visibility}</dd>
              <Dt icon={ic(<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" />)}>그룹장</Dt>
              <dd className="m-0 flex items-center gap-2 font-medium">
                <Avatar name={room.leader} size={26} tone={room.leaderTone ?? toneOfName(room.leader)} id={room.leaderId} />
                {room.leader}
              </dd>
              <Dt icon={ic(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" /></>)}>태그</Dt>
              <dd className="m-0 flex flex-wrap items-center gap-[6px]">
                {room.tags.map((t) => (
                  <span key={t.label} className="inline-flex h-7 items-center gap-1 rounded-[14px] px-[11px] text-[12px] font-semibold" style={{ background: PAL[t.tone].bg, color: PAL[t.tone].fg }}>
                    {t.auto && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
                        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
                      </svg>
                    )}
                    {t.label}
                  </span>
                ))}
                {room.tags.length === 0 && <span className="text-[13px] text-muted">아직 태그가 없어요</span>}
                {room.tags.some((t) => t.auto) && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-muted">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
                    </svg>
                    자동 태그
                  </span>
                )}
                {room.action === "owner" && (
                  <Link href={routes.roomSettings(room.id, routes.myStudyTab(room.id, tab))} className="inline-flex min-h-11 items-center px-1 text-[12px] font-semibold text-mint hover:text-mint-dark">
                    태그 편집
                  </Link>
                )}
              </dd>
            </dl>
          </div>
          <button
            type="button"
            aria-expanded={metaOpen}
            aria-controls="my-study-room-meta"
            aria-label={metaOpen ? "방 정보 접기" : "방 정보 펼치기"}
            title={metaOpen ? "방 정보 접기" : "방 정보 펼치기"}
            onClick={() => writeMeta(!metaOpen)}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-mint"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${metaOpen ? "rotate-180" : ""}`}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      )}

      <div id="my-study-tabs" role="tablist" aria-label="방 상세 탭" className="mt-[26px] scroll-mt-4 max-sm:mt-5 flex gap-1 overflow-x-auto border-y border-line-2 py-[5px]">
        {TABS.map(([id, label]) => {
          const on = tab === id;
          const dot = id === "notice" && noticeUnread;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={dot ? `${label}, 안 읽은 공지 있음` : undefined}
              onClick={() => onTab(id)}
              className={`relative h-11 shrink-0 rounded-[10px] px-[14px] text-[14px] ${on ? "bg-bg font-semibold text-ink" : "bg-transparent font-medium text-ink-3"}`}
            >
              {label}
              {dot && <span data-unread-dot aria-hidden="true" className="absolute right-[6px] top-[11px] size-[6px] rounded-full bg-warn" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
