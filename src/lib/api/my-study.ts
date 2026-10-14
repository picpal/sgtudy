import { rpc, type Db } from "@/lib/api/errors";
import { curIndexOf, curOf, ddayOf, mmdd, periodLong, roundRow, roundsWindow, rulesOf, uiStatus } from "@/lib/api/format";
import type { Curriculum, MeState, MeStudies, MyPermissions, NodePatch, RoomDetail, RoomMemberAdminDto } from "@/lib/api/types";
import { dday, diffDays, weekdayKo } from "@/lib/date";
import type { MemberInfo, NextDue, Room, RoundRow, SidebarGroup } from "@/data/my-study";
import type { Overrides, Tree, TreeNode } from "@/components/my-study/model";

export const fetchCurriculum = (slug: string, client?: Db) => rpc<Curriculum>("curriculum_get", { p_slug: slug, p_include_archived: true }, client);
export const fetchMyStudies = (client?: Db) => rpc<MeStudies>("me_studies", {}, client);
export const nodeCreate = (slug: string, parentId: string | null) => rpc<Curriculum>("node_create", { p_slug: slug, p_parent_id: parentId });
export const nodeUpdate = (slug: string, nodeId: string, patch: NodePatch) => rpc<Curriculum>("node_update", { p_slug: slug, p_node_id: nodeId, p_patch: patch });
export const nodeDelete = (slug: string, nodeId: string) => rpc<Curriculum>("node_delete", { p_slug: slug, p_node_id: nodeId });
export const nodeArchive = (slug: string, nodeId: string, archived: boolean) => rpc<Curriculum>(archived ? "node_archive" : "node_unarchive", { p_slug: slug, p_node_id: nodeId });
/** 그룹장 전용: ACTIVE 멤버에게 커리큘럼 편집을 맡기거나(allow=true) 거둔다. 멱등 */
export const setCurriculumEditor = (slug: string, userId: string, allow: boolean, client?: Db) =>
  rpc<RoomMemberAdminDto>("member_set_curriculum_editor", { p_slug: slug, p_user: userId, p_allow: allow }, client);

/** 호출자가 커리큘럼을 편집할 수 있나 — RoomDetail·Curriculum 의 myPermissions. 없으면(구 응답) 그룹장만 */
export const canEditCurriculumOf = (d: { myPermissions?: MyPermissions; me?: MeState }): boolean =>
  d.myPermissions?.canEditCurriculum ?? d.me?.state === "leader";

function minTextOf(d: RoomDetail): { minText: string; minOk: boolean } {
  if (d.minMembers === null) return { minText: "", minOk: true };
  const full = d.memberCount >= d.maxMembers;
  const ok = d.memberCount >= d.minMembers;
  return ok ? { minText: `최소 ${d.minMembers}명 · 충족${full ? " · 정원 마감" : ""}`, minOk: true } : { minText: `최소 ${d.minMembers}명 · ${d.minMembers - d.memberCount}명 더 필요해요`, minOk: false };
}

function nextOf(d: RoomDetail, tree: Tree, today: string): NextDue | null {
  const nd = d.myProgress?.nextDue;
  if (!nd) return null;
  const leaf = tree.leaves.find((l) => l.id === nd.nodeId);
  return { nodeId: nd.nodeId, title: nd.title, path: leaf ? `${leaf.crumb} · ${leaf.type} 과제` : nd.roundLabel, due: `${mmdd(nd.dueDate)}(${weekdayKo(nd.dueDate)}) 23:59 마감`, dday: dday(today, nd.dueDate) };
}

/** 참가 카드 동작: owner 그룹장 · leave 모집 기간 참가자(취소 가능) · joined 진행·종료 참가자 · pending 승인 대기 · closed 그 외 */
export type StudyAction = "owner" | "leave" | "joined" | "pending" | "closed";
/** draft = 모집 시작 전(준비중). status 는 recruit 로 접히므로 화면은 draft 로 구분한다 (Q2-03) */
export type StudyRoom = Omit<Room, "action"> & { action: StudyAction; draft: boolean };

function studyActionOf(d: RoomDetail): StudyAction {
  const st = d.me?.state;
  if (st === "leader") return "owner";
  if (st === "pending") return "pending";
  if (st === "active") return d.status === "recruit" || d.status === "draft" ? "leave" : d.status === "active" ? "joined" : "closed";
  return "closed";
}

/** room_get → 내 스터디 Room (mystudy §1.2–1.4). 숫자 집계(members done/total, rounds sub/total)는 화면이 tree 로 덮어쓴다. */
export function toStudyRoom(d: RoomDetail, tree: Tree, today: string, meId: string): StudyRoom {
  const dd = ddayOf(d.status, today, d.startDate, d.endDate);
  const cur = curOf(d, today);
  const win = roundsWindow(d.rounds, d.status, today);
  const ci = curIndexOf(d.rounds, today);
  // 서버 currentRound 는 공백 구간에서 직전 회차를 준다(room_current_round_id) → 오늘을 포함하는 회차만 현재 (preflight C2)
  const curId = ci?.inside ? d.rounds[ci.index].id : null;
  const recruit = d.status === "recruit" || d.status === "draft";
  const members: MemberInfo[] = d.members.map((m) => ({
    name: m.nickname, done: 0, total: 0, leader: m.role === "leader", me: m.userId === meId, left: m.status === "inactive", pending: m.status === "pending",
    noBar: m.role === "leader" && !d.leaderDoesTasks, userId: m.userId, tone: m.tone,
  }));
  const rounds: RoundRow[] = win.rows.map((r) => {
    const rr = roundRow(r, d.status, today, r.id === curId);
    const row: RoundRow = { label: rr.label, title: rr.title, dates: rr.dates, state: recruit ? "예정" : rr.state, sub: rr.sub ?? 0, total: rr.total ?? 0, current: rr.current, roundId: r.id };
    if (recruit) row.alt = rr.state;
    return row;
  });
  const draft = d.status === "draft";
  return {
    id: d.slug, title: d.title, intro: d.intro, status: uiStatus(d.status), draft,
    period: periodLong(d.startDate, d.endDate), dday: dd.short, ddayLong: draft ? `모집 전 · ${dd.long}` : dd.long,
    joinMode: d.joinMode === "approval" ? "그룹장 승인 후 참가" : "바로 참가",
    visibility: d.isPublic ? "공개" : "비공개 · 초대 링크로만 참가",
    leader: d.leader.nickname, leaderTone: d.leader.tone, tags: d.tags.map((t) => ({ label: t.label, tone: t.tone, auto: t.auto })),
    capCur: d.memberCount, capMax: d.maxMembers, ...minTextOf(d), members,
    cur: { pill: cur.pill, title: cur.title, meta: cur.meta, tasks: cur.tasks.map((t) => ({ title: t.title, type: t.type, dates: t.dates, people: t.people.map((p) => [p.name, p.status] as [string, typeof p.status]), tones: Object.fromEntries(t.people.map((p) => [p.name, p.tone])) })) },
    about: d.descriptionMd, rules: rulesOf(d.rulesMd), rounds,
    moreRounds: win.more ? `${win.more} · 커리큘럼 탭에서 전체 보기` : "",
    action: studyActionOf(d), next: nextOf(d, tree, today),
  };
}

const GROUP_LABEL = { active: "진행중", recruit: "모집중 · 신청한 방", ended: "종료" } as const;
/** 시작 전 그룹에서 내가 그룹장인 방(준비중·모집중)은 "신청한 방" 이 아니다 (Q2-27) */
const OWN_LABEL = "내가 만든 방 · 시작 전";

export function toSidebarGroups(ms: MeStudies, today: string): SidebarGroup[] {
  const split = ms.groups.flatMap((g): { kind: MeStudies["groups"][number]["kind"]; label: string; items: MeStudies["groups"][number]["items"] }[] =>
    g.kind === "recruit"
      ? [{ kind: g.kind, label: OWN_LABEL, items: g.items.filter((it) => it.membership === "leader") }, { kind: g.kind, label: GROUP_LABEL.recruit, items: g.items.filter((it) => it.membership !== "leader") }]
      : [{ kind: g.kind, label: GROUP_LABEL[g.kind], items: g.items }],
  );
  return split
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      label: g.label,
      items: g.items.map((it) => {
        const w = it.when;
        // 진행중 방에 열린 과제가 없으면 서버는 kind "end"(방 종료일)를 준다 → "MM.DD 까지" (preflight C5)
        const when = w.kind === "deadline" ? `${mmdd(w.date)} 마감` : w.kind === "start" ? `${mmdd(w.date)} 시작` : g.kind === "active" ? `${mmdd(w.date)} 까지` : `${mmdd(w.date)} 종료`;
        return w.kind === "deadline" ? { id: it.slug, title: it.title, intro: it.intro, when, left: diffDays(today, w.date) } : { id: it.slug, title: it.title, intro: it.intro, when };
      }),
    }));
}

/** 사이드바 검색 — 제목·소개에 포함 (대소문자 무시). 빈 그룹은 뺀다 (Q3-06) */
export function filterSidebarGroups(groups: SidebarGroup[], q: string): SidebarGroup[] {
  const k = q.trim().toLowerCase();
  if (!k) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => `${it.title ?? ""} ${it.intro ?? ""}`.toLowerCase().includes(k)) }))
    .filter((g) => g.items.length > 0);
}

/** 편집 패널 "저장" — 오버라이드가 있는 필드만 NodePatch 로 */
export function patchOf(n: TreeNode, ov: Overrides): NodePatch {
  const p: NodePatch = {};
  if (n.id in ov.titles) p.title = ov.titles[n.id];
  if (n.id in ov.descs) p.descriptionMd = ov.descs[n.id];
  if (ov.dates[n.id]?.s) p.startDate = ov.dates[n.id].s;
  if (ov.dates[n.id]?.e) p.endDate = ov.dates[n.id].e;
  if (n.id in ov.typeOv) p.taskType = ov.typeOv[n.id] === "공통" ? "common" : "designated";
  if (n.id in ov.assignOv) p.assigneeIds = ov.assignOv[n.id];
  return p;
}
