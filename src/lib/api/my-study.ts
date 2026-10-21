import { rpc, type Db } from "@/lib/api/errors";
import { requestedOn } from "@/lib/api/leave";
import { ARCHIVED_CUR, ARCHIVED_DDAY, ARCHIVED_ROUND_STATE, curIndexOf, curOf, dateShort, foldArchived, ddayOf, mmdd, periodLong, roundRow, roundsWindow, rulesOf, uiStatus } from "@/lib/api/format";
import type { Curriculum, MeState, MeStudies, MyPermissions, NodePatch, RoomDetail, RoomMemberAdminDto, ShiftedCounts } from "@/lib/api/types";
import { dday, diffDays, weekdayKo } from "@/lib/date";
import { routes } from "@/lib/routes";
import { JOIN_MODE_LABEL, MEMBERSHIP_LABEL } from "@/lib/types";
import type { MemberInfo, NextDue, Room, RoundRow, SidebarGroup } from "@/data/my-study";
import type { Overrides, Tree, TreeNode } from "@/components/my-study/model";

export const fetchCurriculum = (slug: string, client?: Db) => rpc<Curriculum>("curriculum_get", { p_slug: slug, p_include_archived: true }, client);
/** includeArchived: 보관된 방도 끝 "archived" 그룹으로 (0024 — 시나리오 QA #5) */
export const fetchMyStudies = (client?: Db, includeArchived = false) => rpc<MeStudies>("me_studies", includeArchived ? { p_include_archived: true } : {}, client);
/** /my-study 진입 규칙의 단일 출처: me_studies 그룹 순서(진행 → 모집 → 종료)대로 첫 스터디. 보관된 방은 다른 스터디가 없을 때만. 없으면 null */
export const firstStudySlug = (studies: MeStudies): string | null => {
  const items = studies.groups.flatMap((g) => g.items.map((it) => ({ ...it, archived: it.archived || g.kind === "archived" })));
  return (items.find((it) => !it.archived) ?? items[0])?.slug ?? null;
};
/** 헤더 "내 스터디" 링크 — 첫 스터디로 바로(리다이렉트 왕복 없이). 없으면 /my-study(빈 화면) */
export const myStudyHrefOf = (studies: MeStudies): string => routes.myStudy(firstStudySlug(studies) ?? undefined);
/** taskType: 하위 과제의 유형 — 서버 기본은 common 이라 designated 일 때만 보낸다 (빠른 추가 공통/지정, 시나리오 QA #12·D4) */
export const nodeCreate = (slug: string, parentId: string | null, title?: string, client?: Db, taskType?: "common" | "designated") =>
  rpc<Curriculum>("node_create", { p_slug: slug, p_parent_id: parentId, ...(title ? { p_title: title } : {}), ...(taskType === "designated" ? { p_task_type: "designated" } : {}) }, client);
/** 다른 부모(회차)로 옮기기 · 같은 부모 안 순서. index = 자기를 뺀 새 형제 기준, 없으면 끝 */
export const nodeMove = (slug: string, nodeId: string, parentId: string, index?: number, client?: Db) =>
  rpc<Curriculum>("node_move", { p_slug: slug, p_node_id: nodeId, p_parent_id: parentId, p_index: index ?? null }, client);
/** shifted: patch.shiftDescendants 로 함께 옮긴 하위 수 (0024 D2 — 없거나 false 면 days 0) */
export const nodeUpdate = (slug: string, nodeId: string, patch: NodePatch) => rpc<Curriculum & { shifted?: ShiftedCounts }>("node_update", { p_slug: slug, p_node_id: nodeId, p_patch: patch });
export const nodeDelete = (slug: string, nodeId: string) => rpc<Curriculum>("node_delete", { p_slug: slug, p_node_id: nodeId });
export const nodeArchive = (slug: string, nodeId: string, archived: boolean) => rpc<Curriculum>(archived ? "node_archive" : "node_unarchive", { p_slug: slug, p_node_id: nodeId });
/** 그룹장 전용: ACTIVE 멤버에게 커리큘럼 편집을 맡기거나(allow=true) 거둔다. 멱등 */
export const setCurriculumEditor = (slug: string, userId: string, allow: boolean, client?: Db) =>
  rpc<RoomMemberAdminDto>("member_set_curriculum_editor", { p_slug: slug, p_user: userId, p_allow: allow }, client);

/** 호출자가 커리큘럼을 편집할 수 있나 — RoomDetail·Curriculum 의 myPermissions. 없으면(구 응답) 그룹장만 */
export const canEditCurriculumOf = (d: { myPermissions?: MyPermissions; me?: MeState }): boolean =>
  d.myPermissions?.canEditCurriculum ?? d.me?.state === "leader";

/**
 * 편집 모드에 들어가기 전에 권한을 다시 묻는다 — 화면을 연 뒤 그룹장이 권한을 거뒀을 수 있다 (시나리오 QA #10).
 * 조회가 실패하면 막지 않는다(저장 때 서버가 NOT_CURRICULUM_EDITOR 로 다시 막는다).
 */
export async function recheckCurriculumEdit(
  slug: string,
  me: MeState | undefined,
  fetcher: (slug: string) => Promise<Curriculum> = fetchCurriculum,
): Promise<{ allowed: boolean; cur: Curriculum | null }> {
  try {
    const cur = await fetcher(slug);
    return { allowed: canEditCurriculumOf({ myPermissions: cur.myPermissions, me }), cur };
  } catch {
    return { allowed: true, cur: null };
  }
}

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
/** archived: 보관된 방(시나리오 QA #6 — 모든 표기를 "보관된 스터디" 로). leaveRequest: 진행 중 내 탈퇴 요청(D3) */
export type StudyRoom = Omit<Room, "action"> & { action: StudyAction; draft: boolean; archived: boolean; leaveRequest: { on: string; reason: string | null } | null };


function studyActionOf(d: RoomDetail): StudyAction {
  const st = d.me?.state;
  if (st === "leader") return "owner";
  if (st === "pending") return "pending";   // 보관된 방도 승인 대기 본인은 신청 취소 (백로그 F①)
  if (d.archived) return "closed";
  if (st === "active") return d.status === "recruit" || d.status === "draft" ? "leave" : d.status === "active" ? "joined" : "closed";
  return "closed";
}

/** room_get → 내 스터디 Room (mystudy §1.2–1.4). 숫자 집계(members done/total, rounds sub/total)는 화면이 tree 로 덮어쓴다. */
export function toStudyRoom(dto: RoomDetail, tree: Tree, today: string, meId: string): StudyRoom {
  // 보관된 방은 회차·일정 표기를 종료와 같은 규칙으로(진행중·마감 D-n 이 섞이지 않게), 문구는 "보관" 으로 (#6)
  const d: RoomDetail = foldArchived(dto);
  const dd = dto.archived ? ARCHIVED_DDAY : ddayOf(d.status, today, d.startDate, d.endDate);
  const cur = dto.archived ? ARCHIVED_CUR : curOf(d, today);
  const win = roundsWindow(d.rounds, d.status, today);
  const ci = curIndexOf(d.rounds, today);
  // 서버 currentRound 는 공백 구간에서 직전 회차를 준다(room_current_round_id) → 오늘을 포함하는 회차만 현재 (preflight C2)
  const curId = ci?.inside ? d.rounds[ci.index].id : null;
  const recruit = d.status === "recruit" || d.status === "draft";
  const members: MemberInfo[] = d.members.map((m) => ({
    name: m.nickname, done: 0, total: 0, leader: m.role === "leader", me: m.userId === meId, left: m.status === "inactive", pending: m.status === "pending",
    noBar: m.role === "leader" && !d.leaderDoesTasks, userId: m.userId, tone: m.tone,
    editor: m.role === "member" && m.status === "active" && !!m.canEditCurriculum,
  }));
  const rounds: RoundRow[] = win.rows.map((r) => {
    const rr = roundRow(r, d.status, today, r.id === curId);
    // 보관된 방은 회차를 "완료" 라 부르지 않는다(끝나지 않은 회차도 있다) (#6)
    const row: RoundRow = { label: rr.label, title: rr.title, dates: rr.dates, state: dto.archived ? ARCHIVED_ROUND_STATE : recruit ? "예정" : rr.state, sub: rr.sub ?? 0, total: rr.total ?? 0, current: rr.current, roundId: r.id };
    if (recruit) row.alt = rr.state;
    return row;
  });
  const draft = d.status === "draft";
  const lr = dto.me?.leaveRequest;
  return {
    id: d.slug, title: d.title, intro: d.intro, status: uiStatus(d.status), draft, archived: dto.archived,
    leaveRequest: lr ? { on: requestedOn(lr.requestedAt, today), reason: lr.reason } : null,
    period: periodLong(d.startDate, d.endDate), dday: dd.short, ddayLong: draft ? `모집 전 · ${dd.long}` : dd.long,
    joinMode: JOIN_MODE_LABEL[d.joinMode],
    visibility: d.isPublic ? "공개" : "비공개 · 초대 링크로만 참가",
    leader: d.leader.nickname, leaderTone: d.leader.tone, leaderId: d.leader.userId, tags: d.tags.map((t) => ({ label: t.label, tone: t.tone, auto: t.auto })),
    capCur: d.memberCount, capMax: d.maxMembers, ...minTextOf(d), members,
    cur: { pill: cur.pill, title: cur.title, meta: cur.meta, tasks: cur.tasks.map((t) => ({ id: t.id, title: t.title, type: t.type, dates: t.dates, people: t.people.map((p) => [p.name, p.status] as [string, typeof p.status]), tones: Object.fromEntries(t.people.map((p) => [p.name, p.tone])), ids: Object.fromEntries(t.people.map((p) => [p.name, p.userId])) })) },
    about: d.descriptionMd, rules: rulesOf(d.rulesMd), rounds,
    moreRounds: win.more ? `${win.more} · 진행목표 탭에서 전체 보기` : "",
    action: studyActionOf(d), next: nextOf(d, tree, today),
  };
}

const GROUP_LABEL = { active: "진행중", recruit: `모집중 · ${MEMBERSHIP_LABEL.pending}`, ended: "종료", archived: "보관됨" } as const;
/** 시작 전 그룹에서 내가 그룹장인 방(준비중·모집중)은 "신청한 방" 이 아니다 (Q2-27) */
const OWN_LABEL = "내가 만든 방 · 시작 전";
/** 승인된(참가 확정) 시작 전 방 — "신청한 방" 이라 부르면 아직 승인 전으로 읽힌다 (시나리오 QA #17) */
const JOINED_LABEL = `모집중 · ${MEMBERSHIP_LABEL.joined}`;

export function toSidebarGroups(ms: MeStudies, today: string): SidebarGroup[] {
  const split = ms.groups.flatMap((g): { kind: MeStudies["groups"][number]["kind"]; label: string; items: MeStudies["groups"][number]["items"] }[] =>
    g.kind === "recruit"
      ? [
          { kind: g.kind, label: OWN_LABEL, items: g.items.filter((it) => it.membership === "leader") },
          { kind: g.kind, label: JOINED_LABEL, items: g.items.filter((it) => it.membership === "joined") },
          { kind: g.kind, label: GROUP_LABEL.recruit, items: g.items.filter((it) => it.membership === "pending") },
        ]
      : [{ kind: g.kind, label: GROUP_LABEL[g.kind], items: g.items }],
  );
  return split
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      label: g.label,
      items: g.items.map((it) => {
        const w = it.when;
        // 진행중 방에 열린 과제가 없으면 서버는 kind "end"(방 종료일)를 준다 → "MM.DD 까지" (preflight C5). 올해가 아니면 연도까지(Q2-13)
        const d = dateShort(w.date, today);
        const when = w.kind === "deadline" ? `${d} 마감` : w.kind === "start" ? `${d} 시작` : w.kind === "recruitEnd" ? `${d} 모집 마감` : g.kind === "active" ? `${d} 까지` : `${d} 종료`;
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
  // 개인 목표는 편집 패널 대상이 아니다 — 유형·담당은 절대 보내지 않는다(삼항이 "개인"을 지정으로 떨어뜨리지 않게)
  if (n.leaf && n.personal) return p;
  const t = ov.typeOv[n.id];
  if (t === "공통") p.taskType = "common";
  else if (t === "지정") p.taskType = "designated";
  if (n.id in ov.assignOv) p.assigneeIds = ov.assignOv[n.id];
  return p;
}
