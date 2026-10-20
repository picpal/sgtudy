import { rpc, type Db } from "@/lib/api/errors";
import { mmdd, periodCard, periodWeeks } from "@/lib/api/format";
import type { RoomCardDto, RoomListResponse } from "@/lib/api/types";
import { MEMBERSHIP_LABEL } from "@/lib/types";
import type { StatusFilter, Tab } from "@/components/main/FilterBar";
import { dday, weekdayKo } from "@/lib/date";
import type { Room, Slot } from "@/data/rooms";

export type RoomsParams = { scope: Tab; status: StatusFilter; q: string; tags: string[]; page?: number; size?: number };
export const DEFAULT_PARAMS: RoomsParams = { scope: "public", status: "all", q: "", tags: [] };

export const fetchRooms = (p: RoomsParams, client?: Db) =>
  rpc<RoomListResponse>(
    "rooms_list",
    { p_scope: p.scope, p_status: p.status, p_q: p.q.trim() || null, p_tags: p.tags, p_page: p.page ?? 0, p_size: p.size ?? 24, p_sort: "default" },
    client,
  );

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** main §3-2 모집 현황 꼬리 우선순위: 승인 대기중 > 정원 마감 > 첫 참가자 > N자리 남음 */
function recruitTail(d: RoomCardDto): string {
  if (d.status === "draft") return "모집 전";
  if (d.membership?.status === "pending") return MEMBERSHIP_LABEL.pending;
  if (d.memberCount >= d.maxMembers) return "정원 마감";
  if (d.memberCount <= 1) return "첫 참가자를 기다려요";
  return `${d.maxMembers - d.memberCount}자리 남음`;
}

function slotOf(d: RoomCardDto, today: string): Slot {
  const p = d.progress;
  switch (p.kind) {
    case "recruit": {
      const start = `${mmdd(d.startDate)}(${weekdayKo(d.startDate)}) 시작${d.status === "draft" ? " 예정" : ""}`;
      return { label: "모집 현황", value: `${d.memberCount}/${d.maxMembers}명`, pct: pct(d.memberCount, d.maxMembers), note: `${start} · ${recruitTail(d)}`, em: d.startDate < today ? "시작일 지남" : dday(today, d.startDate) };
    }
    case "mine": {
      const v = pct(p.submitted, p.assigned);
      // nextTask 는 지금 OPEN 인 과제만 — 없어도 미제출 과제가 남았으면 "다 끝냄" 처럼 읽히지 않게 (Q3-23)
      const none = p.submitted < p.assigned ? "지금 진행 중인 과제가 없어요" : "남은 과제가 없어요";
      return { label: "내 진척률", value: `${v}%`, pct: v, note: p.nextTask?.title ?? none, em: p.nextTask ? dday(today, p.nextTask.dueDate) : "" };
    }
    case "team": {
      const idx = p.currentRound?.index ?? 0;
      return {
        label: "전체 진행",
        value: `${idx}/${p.totalRounds}주`,
        pct: pct(idx, p.totalRounds),
        note: p.currentRound ? `${p.currentRound.label} · ${p.currentRound.title}` : "진행 중인 회차가 없어요",
        em: "",
      };
    }
    case "final": {
      const v = pct(p.submitted, p.assigned);
      // "N주 완주" 의 N 은 기간 주 수(D14) — totalRounds(회차 수)가 아니다
      return { label: "최종 달성률", value: `${v}%`, pct: v, note: `${periodWeeks(d.startDate, d.endDate)}주 완주 · 제출 ${p.submitted}/${p.assigned}건`, em: "" };
    }
  }
}

export function toRoomCard(d: RoomCardDto, today: string): Room {
  const m = d.membership;
  return {
    id: d.slug,
    title: d.title,
    intro: d.intro,
    status: d.status === "draft" ? "draft" : d.status === "recruit" && d.isFull ? "full" : d.status,
    pub: d.isPublic,
    approval: d.joinMode === "approval",
    cur: d.memberCount,
    max: d.maxMembers,
    leader: d.leader.nickname,
    leaderTone: d.leader.tone,
    leaderId: d.leader.userId,
    tags: d.tags.map((t) => t.label),
    created: m?.role === "leader",
    period: periodCard(d.startDate, d.endDate),
    slot: slotOf(d, today),
    extra: d.status === "active" && d.recruitUntil ? (d.isFull ? "full" : "open") : undefined,
  };
}
