import { rpc, type Db } from "@/lib/api/errors";
import { curIndexOf, curOf, ddayOf, glanceOf, periodLong, periodShort, roundRow, roundsWindow, rulesOf, uiStatus } from "@/lib/api/format";
import type { MembershipResult, RoomCardDto, RoomDetail, RoomTagDto } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import type { RoomStatus } from "@/lib/types";
import type { Action, BaseAction, Room, RoomMember } from "@/data/room-view";

export const fetchRoomDetail = (slug: string, client?: Db, inviteToken?: string) =>
  rpc<RoomDetail>("room_get", { p_slug: slug, p_invite_token: inviteToken ?? null }, client);
/** 비공개 방은 room_join_precheck 가 초대 토큰을 검사한다 → ?invite= 로 연 방이면 토큰을 그대로 넘긴다 */
export const joinRoom = (slug: string, inviteToken?: string) => rpc<MembershipResult>("room_join", { p_slug: slug, p_invite_token: inviteToken ?? null });
export const applyRoom = (slug: string, inviteToken?: string) => rpc<MembershipResult>("room_apply", { p_slug: slug, p_invite_token: inviteToken ?? null });

/** 로그인/온보딩 뒤 돌아올 방 주소. 초대 토큰을 유지해야 비공개 방이 다시 열린다 (safeReturnTo 통과: 원문에 %2f·%2e 없음) */
export const roomReturnTo = (slug: string, inviteToken?: string): string =>
  `${routes.room(slug)}${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""}`;

/** ?invite=a&invite=b → 첫 값 */
export const firstParam = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;
export const leaveRoom = (slug: string) => rpc<MembershipResult>("room_leave", { p_slug: slug });
export const cancelApplication = (slug: string) => rpc<MembershipResult>("room_cancel_application", { p_slug: slug });

type ActionInput = Pick<RoomDetail, "status" | "joinMode" | "memberCount" | "maxMembers" | "me">;

/** 지금 참가할 수 없는 방 상태 — 비로그인도 로그인 전에 알 수 있게 먼저 보여 준다 (Q2-11) */
export function closedAction(d: Pick<RoomDetail, "status" | "memberCount" | "maxMembers">): "ended" | "activeClosed" | "full" | null {
  if (d.status === "ended") return "ended";
  if (d.status === "active") return "activeClosed";
  if (d.memberCount >= d.maxMembers) return "full";
  return null;
}

/** 03-api §3: 비로그인→(종료·진행중·정원 마감이면 그 상태, 아니면 login) · leader→owner · active&recruit→leave · active&(active|ended)→joined · pending→pending · inactive→inactive · ended→ended · active→activeClosed · full→full · approval→apply · direct→join */
export function actionOf(d: ActionInput): Action {
  const st = d.me?.state;
  if (!d.me) return closedAction(d) ?? "login";
  if (st === "leader") return "owner";
  const recruiting = d.status === "recruit" || d.status === "draft";
  if (st === "active") return recruiting ? "leave" : "joined";
  if (st === "pending") return "pending";
  // 이탈 처리된 멤버는 서버가 MEMBER_NOT_ACTIVE 로 막는다 → 참가 버튼 대신 비활성 안내 (초대 화면과 같은 규칙)
  if (st === "inactive") return "inactive";
  return closedAction(d) ?? (d.joinMode === "approval" ? "apply" : "join");
}

const baseOf = (act: Action): BaseAction => (act === "join" || act === "apply" || act === "leave" || act === "pending" || act === "login" ? "recruit" : act);

export function toRoom(d: RoomDetail, today: string, meId: string | null): Room {
  const dd = ddayOf(d.status, today, d.startDate, d.endDate);
  const win = roundsWindow(d.rounds, d.status, today);
  const ci = curIndexOf(d.rounds, today);
  // 서버 currentRound 는 공백 구간에서 직전 회차를 준다(room_current_round_id) → 오늘을 포함하는 회차만 현재 (preflight C2)
  const curId = ci?.inside ? d.rounds[ci.index].id : null;
  const members: RoomMember[] = d.members
    .filter((m) => m.status === "active")
    .map((m) => ({ userId: m.userId, name: m.nickname, tone: m.tone, leader: m.role === "leader", me: m.userId === meId }));
  const myPending = d.members.find((m) => m.status === "pending" && m.userId === meId);
  if (myPending) members.push({ userId: myPending.userId, name: myPending.nickname, tone: myPending.tone, leader: false, me: true, pending: true });
  const cur = curOf(d, today);
  return {
    id: d.slug,
    title: d.title,
    intro: d.intro,
    status: uiStatus(d.status),
    base: baseOf(actionOf(d)),
    approval: d.joinMode === "approval",
    pub: d.isPublic,
    period: periodLong(d.startDate, d.endDate),
    when: dd.short,
    dday: dd.short,
    ddayLong: dd.long,
    leader: d.leader.nickname,
    leaderTone: d.leader.tone,
    leaderId: d.leader.userId,
    tags: d.tags.map((t) => ({ label: t.label, tone: t.tone, auto: t.auto })),
    capCur: d.memberCount,
    capMax: d.maxMembers,
    minNeed: d.minMembers ?? 0,
    members,
    cur: { pill: cur.pill, title: cur.title, meta: cur.meta, tasks: cur.tasks.map((t) => ({ title: t.title, type: t.type, dates: t.dates, people: t.people.map((p) => ({ name: p.name, status: p.status, tone: p.tone, userId: p.userId })) })) },
    about: d.descriptionMd,
    rules: rulesOf(d.rulesMd),
    rounds: win.rows.map((r) => roundRow(r, d.status, today, r.id === curId)),
    moreRounds: win.more,
    glance: glanceOf(d.stats, d.status),
  };
}

/** 쓰기 RPC 응답(MembershipResult)으로 교체 — 프론트가 +1 하지 않는다(roomview §3.5) */
export const applyMembership = (d: RoomDetail, r: MembershipResult): RoomDetail => ({ ...d, me: r.me, memberCount: r.memberCount, members: r.members, pendingCount: r.pendingCount });

export type SidebarRoom = { id: string; title: string; status: RoomStatus; when: string; period: string; tags: RoomTagDto[]; capCur: number; capMax: number; mark?: "leave" | "pending" | "joined" | "owner" };

function markOf(d: RoomCardDto): SidebarRoom["mark"] {
  const m = d.membership;
  if (!m) return undefined;
  if (m.role === "leader") return "owner";
  if (m.status === "pending") return "pending";
  if (m.status === "active") return d.status === "recruit" || d.status === "draft" ? "leave" : "joined";
  return undefined;
}

export function toSidebarRoom(d: RoomCardDto, today: string): SidebarRoom {
  return {
    id: d.slug,
    title: d.title,
    status: uiStatus(d.status),
    when: ddayOf(d.status, today, d.startDate, d.endDate).short,
    period: periodShort(d.startDate, d.endDate),
    tags: d.tags,
    capCur: d.memberCount,
    capMax: d.maxMembers,
    mark: markOf(d),
  };
}

const GROUP_ORDER: { key: RoomStatus; label: string }[] = [{ key: "recruit", label: "모집중" }, { key: "active", label: "진행중" }, { key: "ended", label: "종료" }];

export const groupSidebar = (items: SidebarRoom[]) =>
  GROUP_ORDER.map((g) => ({ ...g, items: items.filter((i) => i.status === g.key) })).filter((g) => g.items.length > 0);
