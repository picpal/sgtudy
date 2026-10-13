"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { PAL } from "@/lib/palette";
import { ROOM_STATUS_LABEL, type RoomStatus } from "@/lib/types";
import type { Room } from "@/data/my-study";
import { RoundIconButton, toneOfName } from "./bits";

export type TabId = "overview" | "curriculum" | "board" | "calendar" | "gantt";
export const TABS: [TabId, string][] = [
  ["overview", "개요"],
  ["curriculum", "커리큘럼"],
  ["board", "보드"],
  ["calendar", "캘린더"],
  ["gantt", "간트"],
];

const STATUS_BG: Record<RoomStatus, string> = { recruit: "#2F5BC2", active: "#0D7A64", ended: "#5B6675" };

export function StatusBadge({ status }: { status: RoomStatus }) {
  return (
    <Badge bg={STATUS_BG[status]} fg="#FFFFFF" height={26} px={10} radius={8} fontSize={12} weight={600}>
      {ROOM_STATUS_LABEL[status]}
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

export function StudyHeaderInfo({ room, tab, onTab }: { room: Room; tab: TabId; onTab: (t: TabId) => void }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[30px] font-bold leading-[1.3] tracking-[-0.02em]">{room.title}</h1>
          <p className="mt-2 mb-0 text-[15px] leading-[1.6] text-ink-3">{room.intro}</p>
        </div>
        <div className="flex shrink-0 gap-[6px]">
          <RoundIconButton label="공유">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 8l5-5 5 5" />
              <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
          </RoundIconButton>
          <RoundIconButton label="더보기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#1B2230" aria-hidden="true">
              <circle cx="6" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="18" cy="12" r="1.6" />
            </svg>
          </RoundIconButton>
        </div>
      </div>

      {tab === "overview" && (
        <dl className="mt-6 mb-0 grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-3 gap-y-[14px] text-[14px] max-[390px]:grid-cols-[110px_minmax(0,1fr)]">
          <Dt icon={ic(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)}>기간</Dt>
          <dd className="m-0 flex flex-wrap items-center gap-2 font-medium">
            {room.period}
            <span className="rounded-[7px] bg-mint-soft px-2 py-[2px] text-[12px] font-semibold text-mint">{room.dday}</span>
          </dd>
          <Dt icon={ic(<path d="M4 21V4M4 4h12l-2 4 2 4H4" />)}>상태</Dt>
          <dd className="m-0">
            <StatusBadge status={room.status} />
          </dd>
          <Dt icon={ic(<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>)}>참가 방식</Dt>
          <dd className="m-0 font-medium">{room.joinMode}</dd>
          <Dt icon={ic(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>)}>공개 범위</Dt>
          <dd className="m-0 font-medium">{room.visibility}</dd>
          <Dt icon={ic(<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" />)}>그룹장</Dt>
          <dd className="m-0 flex items-center gap-2 font-medium">
            <Avatar name={room.leader} size={26} tone={room.leaderTone ?? toneOfName(room.leader)} />
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
            <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-muted">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
              </svg>
              자동 태그
            </span>
          </dd>
        </dl>
      )}

      <div role="tablist" aria-label="방 상세 탭" className="mt-[26px] flex gap-1 overflow-x-auto border-y border-line-2 py-2">
        {TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTab(id)}
              className={`h-[38px] shrink-0 rounded-[10px] px-[14px] text-[14px] ${on ? "bg-bg font-semibold text-ink" : "bg-transparent font-medium text-ink-3"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}
