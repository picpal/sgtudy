import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MoreMenu, type MoreMenuItem } from "@/components/ui/MoreMenu";
import { Inline, MarkdownView } from "@/components/my-study/MarkdownView";
import { PAL } from "@/lib/palette";
import { JOIN_MODE_LABEL } from "@/lib/types";
import { type Room } from "@/data/room-view";
import { StatusBadge } from "./StatusBadge";
import { CurrentRoundCard } from "./CurrentRoundCard";
import { ScheduleList } from "./ScheduleList";

const TABS = ["개요", "진행목표", "보드", "캘린더", "간트"];

const dtIcon = (d: ReactNode, extra?: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
    {extra}
  </svg>
);

function Dt({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <dt className="flex items-center gap-[9px] text-muted">
      {icon}
      {children}
    </dt>
  );
}

function H3({ icon, className, children }: { icon: ReactNode; className: string; children: ReactNode }) {
  return (
    <h3 className={`flex items-center gap-2 text-[15px] font-bold ${className}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#1B2230" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        {icon}
      </svg>
      {children}
    </h3>
  );
}

/** onShare: 방 주소(초대 토큰 없이) 복사 — 토스트는 화면이 띄운다. more: 더보기 메뉴(비면 버튼 숨김) */
export function RoomInfo({ room, onShare, more }: { room: Room; onShare: () => void; more: MoreMenuItem[] }) {
  const recruit = room.status === "recruit";
  return (
    <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 title={room.title} className="line-clamp-3 break-words text-[30px] font-bold leading-[1.3] tracking-[-0.02em] max-sm:text-[22px]">
            {room.title}
          </h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-ink-3">{room.intro}</p>
        </div>
        <div className="flex shrink-0 gap-[6px]">
          <button type="button" aria-label="공유" title="링크 복사" onClick={onShare} className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 8l5-5 5 5" />
              <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
          </button>
          <MoreMenu items={more} />
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-3 gap-y-[14px] text-[14px]">
        <Dt icon={dtIcon(<circle cx="12" cy="12" r="9" />, <path d="M12 7v5l3 2" />)}>기간</Dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium">
          {room.period}
          <span
            className="rounded-[7px] px-2 py-[2px] text-[12px] font-semibold"
            style={room.archived ? { color: "#4A5563", background: "#E9EEF0" } : recruit ? { color: "#2F5BC2", background: "#E3ECFD" } : { color: "#0D7A64", background: "#DDF4EE" }}
          >
            {room.dday}
          </span>
        </dd>

        <Dt icon={dtIcon(<path d="M4 21V4M4 4h12l-2 4 2 4H4" />)}>상태</Dt>
        <dd>
          <StatusBadge status={room.status} draft={room.draft} archived={room.archived} />
        </dd>

        <Dt icon={dtIcon(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />, <path d="m9 12 2 2 4-4" />)}>참가 방식</Dt>
        <dd className="font-medium">{JOIN_MODE_LABEL[room.approval ? "approval" : "direct"]}</dd>

        <Dt icon={dtIcon(<circle cx="12" cy="12" r="9" />, <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />)}>공개 범위</Dt>
        <dd className="font-medium">{room.pub === false ? "비공개 · 초대 링크로만 참가" : "공개"}</dd>

        <Dt icon={dtIcon(<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" />)}>그룹장</Dt>
        <dd className="flex items-center gap-2 font-medium">
          <Avatar name={room.leader} tone={room.leaderTone} id={room.leaderId} size={26} />
          {room.leader}
        </dd>

        <Dt icon={dtIcon(<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />, <circle cx="7.5" cy="7.5" r="1.3" />)}>태그</Dt>
        <dd className="flex flex-wrap items-center gap-[6px]">
          {room.tags.map((t) => (
            <span
              key={t.label}
              className="inline-flex h-7 items-center gap-1 rounded-[14px] px-[11px] text-[12px] font-semibold"
              style={{ background: PAL[t.tone].bg, color: PAL[t.tone].fg }}
            >
              {t.auto && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
                  <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
                </svg>
              )}
              {t.label}
            </span>
          ))}
        </dd>
      </dl>

      {/* 스펙상 개요만 있는 탭 모양 — 전환되지 않으므로 탭으로 알리지 않고 나머지는 비활성으로 둔다 */}
      <div role="group" aria-label="방 상세 보기" className="mt-[26px] flex flex-wrap gap-1 border-y border-line-2 py-2">
        {TABS.map((t, i) => (
          <span
            key={t}
            aria-current={i === 0 ? "page" : undefined}
            aria-disabled={i === 0 ? undefined : true}
            className={`inline-flex h-[38px] cursor-default select-none items-center rounded-[10px] px-[14px] text-[14px] ${i === 0 ? "bg-bg font-semibold text-ink" : "bg-transparent text-ink-3"}`}
          >
            {t}
          </span>
        ))}
      </div>

      <CurrentRoundCard cur={room.cur} />

      <H3 className="mb-[10px] mt-[30px]" icon={<><path d="M12 11v6" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.4" fill="#FFFFFF" /></>}>
        스터디 소개
      </H3>
      <MarkdownView src={room.about} />

      <H3 className="mb-[10px] mt-[26px]" icon={<path d="m8 12.2 2.8 2.8L16.5 9" stroke="#FFFFFF" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}>
        운영 규칙
      </H3>
      <ul className="list-disc pl-5 text-[14px] leading-[1.75] text-ink-2">
        {room.rules.map((r) => (
          <li key={r}>
            <Inline text={r} />
          </li>
        ))}
      </ul>

      <H3 className="mb-3 mt-[26px]" icon={<path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />}>
        전체 일정
      </H3>
      <ScheduleList rounds={room.rounds} moreRounds={room.moreRounds} />
    </section>
  );
}
