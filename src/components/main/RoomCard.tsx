import Link from "next/link";
import { DEFAULT_FILTERS, roomHrefWith, type HomeFilters } from "./homeUrl";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { routes } from "@/lib/routes";
import { MARK } from "@/data/room-view";
import type { CardStatus, Room } from "@/data/rooms";

const STATUS_BADGE: Record<CardStatus, { label: string; bg: string; fg: string }> = {
  recruit: { label: "모집중", bg: "#3B6FE0", fg: "#FFFFFF" },
  active: { label: "진행중", bg: "#0D7A64", fg: "#FFFFFF" },
  ended: { label: "종료", bg: "#E9EEF0", fg: "#4A5563" },
  full: { label: "정원 마감", bg: "#FDE8E1", fg: "#B4462B" },
  draft: { label: "준비중", bg: "#E9EEF0", fg: "#4A5563" },
};

/** 상태 슬롯 톤 [배경, 라벨색, 막대색, 트랙색] */
const SLOT_TONE: Record<CardStatus, { bg: string; label: string; bar: string; track: string }> = {
  recruit: { bg: "#EFF4FE", label: "#2F5BC2", bar: "#3B6FE0", track: "#D6E2FA" },
  full: { bg: "#FDF1EC", label: "#B4462B", bar: "#C9583A", track: "#F4D9CF" },
  draft: { bg: "#F4F6F7", label: "#4A5563", bar: "#7A8594", track: "#DDE2E5" },
  active: { bg: "#EEF8F4", label: "#0D7A64", bar: "#12A386", track: "#CFE8E0" },
  ended: { bg: "#F4F6F7", label: "#4A5563", bar: "#7A8594", track: "#DDE2E5" },
};

/** anonymous: 비로그인이면 카드를 누를 때 로그인부터 — 로그인 뒤 그 방으로 돌아온다 */
/** filters: 지금 둘러보기 필터 — 상세 화면 왼쪽 목록이 이어받는다 (시나리오 QA #19) */
/** room.mine(그룹장·참가중): 공개 방 대신 그 방의 내 스터디로 — 공개 방 화면은 주소로 바로 열면 그대로 열린다 */
type Props = { room: Room; selectedTags: string[]; anonymous?: boolean; filters?: HomeFilters };

export function RoomCard({ room, selectedTags, anonymous = false, filters = DEFAULT_FILTERS }: Props) {
  const href = room.mine ? routes.myStudy(room.id) : roomHrefWith(room.id, filters);
  // 내 방 표시는 상세 왼쪽 목록(markForScope)과 같은 말·색 — 그룹장은 만든 스터디 목록에서만 뺀다(전부 그룹장 방)
  const mark = room.created ? (filters.scope === "created" ? undefined : MARK.owner) : room.mine ? MARK.joined : undefined;
  const badge = STATUS_BADGE[room.status];
  const tone = SLOT_TONE[room.status];
  const isFull = room.cur >= room.max;

  return (
    <Link
      href={anonymous ? routes.login(routes.room(room.id)) : href}
      aria-label={!anonymous && room.mine ? `${room.title} — 내 스터디로 이동` : undefined}
      className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface text-ink no-underline transition-[transform,box-shadow] duration-[180ms] ease-[ease] hover:-translate-y-1.5 hover:text-ink hover:shadow-[0_14px_28px_rgba(27,34,48,0.10)]"
    >
      <div className="flex flex-[1_1_auto] flex-col gap-[10px] px-[18px] pb-4 pt-[18px]">
        <div className="flex flex-wrap gap-[6px]">
          <Badge bg={badge.bg} fg={badge.fg}>
            {badge.label}
          </Badge>
          {room.extra && (
            <Badge bg="#EEE7FB" fg="#6B45B8">
              {room.extra === "full" ? "추가 모집 · 정원 마감" : "추가 모집"}
            </Badge>
          )}
          {mark && (
            <Badge bg={mark.bg} fg={mark.fg}>
              {mark.label}
            </Badge>
          )}
          {!room.pub && (
            <Badge bg="#E9EEF0" fg="#3A4452">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              비공개
            </Badge>
          )}
        </div>

        <h2
          title={room.title}
          className="clamp-2 m-0 min-h-12 text-[17px] font-bold leading-[1.4] tracking-[-0.01em] [overflow-wrap:anywhere] [word-break:keep-all]"
        >
          {room.title}
        </h2>
        <p className="clamp-2 m-0 min-h-[43px] text-[14px] leading-[1.55] text-muted">{room.intro}</p>

        <div className="flex h-6 flex-nowrap gap-[6px] overflow-hidden">
          {room.tags.map((t) => {
            const on = selectedTags.includes(t);
            return (
              <span
                key={t}
                className={`flex-[0_0_auto] whitespace-nowrap rounded-[7px] px-[9px] py-[3px] text-[12px] ${
                  on ? "bg-mint-soft font-semibold text-mint-deep" : "bg-[#F1F4F6] font-medium text-ink-3"
                }`}
              >
                #{t}
              </span>
            );
          })}
        </div>

        <div className="flex flex-col gap-[7px] rounded-[12px] px-3 py-[10px]" style={{ background: tone.bg }}>
          <div className="flex items-center justify-between text-[12px] font-semibold">
            <span style={{ color: tone.label }}>{room.slot.label}</span>
            <span>{room.slot.value}</span>
          </div>
          <ProgressBar pct={room.slot.pct} track={tone.track} fill={tone.bar} />
          <div className="flex h-[18px] items-center gap-[6px] text-[12px] text-ink-3">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{room.slot.note}</span>
            {room.slot.em && <b className="shrink-0 font-bold text-warn">{room.slot.em}</b>}
          </div>
        </div>

        <div className="mt-auto text-[13px] text-muted">{room.period}</div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line-2 px-[18px] py-3 text-[13px] text-muted">
        <span className="flex items-center gap-2">
          <Avatar name={room.leader} tone={room.leaderTone} id={room.leaderId} size={24} strong />
          <span>
            by <b className="font-semibold text-ink">{room.leader}</b>
          </span>
        </span>
        <span className="flex items-center gap-[10px]">
          {room.approval && (
            <span className="flex items-center gap-1 text-[12px] text-muted" title="그룹장 승인제">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              승인제
            </span>
          )}
          <span className={`flex items-center gap-1 font-semibold ${isFull ? "text-warn" : "text-ink"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
              <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.6 3.5 5.2" />
            </svg>
            {room.cur}/{room.max}
          </span>
        </span>
      </div>
    </Link>
  );
}
