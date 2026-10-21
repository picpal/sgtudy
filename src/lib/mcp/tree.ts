import type { Curriculum, NodeDto, RoomStatusDto, TaskTypeDto } from "@/lib/api/types";

/** api_invoke('curriculum_get') 응답 — curriculum_json + 게이트웨이 보강(0035 api_curriculum_view·api_node_file_counts) */
export type GatewayCurriculum = Omit<Curriculum, "nodes"> & {
  nodes: (NodeDto & { isMine?: boolean })[];
  version: string;
  study: { slug: string; title: string; intro?: string; status?: RoomStatusDto; startDate: string; endDate: string };
  currentRoundId?: string | null;
  fileCounts?: Record<string, number>;
  viewer?: { nickname: string };
};

export type TreeKind = "round" | "bundle" | "task" | "personal";
export type TreeNode = {
  id: string;
  kind: TreeKind;
  /** 회차(depth 2)만 */
  label?: string | null;
  title: string;
  startDate: string;
  endDate: string;
  /** 팀 리프(회차 리프 포함)만 */
  taskType?: Exclude<TaskTypeDto, "personal">;
  /** designated 만 — userId(내부 정규화용). 텍스트 출력은 assigneeNicknames */
  assignees?: string[];
  assigneeNicknames?: string[];
  /** 개인 목표는 생략 */
  progress?: { assigned: number; submitted: number };
  /** NODE_DOC 첨부 수(팀 노드) */
  files: number;
  /** 회차만 — currentRoundId */
  current?: boolean;
  archived?: true;
  descriptionMd?: string;
  /** 개인 목표만 */
  ownerId?: string | null;
  ownerNickname?: string;
  /** 〔C#5〕 게이트웨이가 붙인 값 그대로(없으면 생략 — 포맷터는 내 것으로 보지 않는다) */
  isMine?: boolean;
  /** 개인 목표만 — 제출함 */
  done?: true;
  children: TreeNode[];
};

export const CONSTRAINTS = {
  maxDepth: 5, titleMax: 80, labelMax: 20, descriptionMax: 20000, planMaxNodes: 200,
  planMaxUpdates: 50 /* update·move·담당 지정 create 합계 */, dateFormat: "YYYY-MM-DD (KST)", deadline: "endDate 23:59:59 KST",
} as const;

export type CurriculumTree = {
  schema: "sgtudy.curriculum/v1";
  version: string;
  today: string;
  study: { slug: string; title: string; status: RoomStatusDto; startDate: string; endDate: string };
  me: { canEditCurriculum: boolean; canAddPersonal: boolean; personalPerRound: number };
  members: { userId: string; nickname: string; role: "leader" | "member"; status: "active" | "inactive"; doesTasks: boolean; canEditCurriculum: boolean }[];
  rounds: TreeNode[];
  constraints: typeof CONSTRAINTS;
};

export const DESCRIPTION_CLIP = 2000;
const clip = (s: string) => (s.length > DESCRIPTION_CLIP ? s.slice(0, DESCRIPTION_CLIP) + "…" : s);

function kindOf(n: NodeDto): TreeKind {
  if (n.task?.type === "personal") return "personal";
  if (n.depth === 2) return "round";
  return n.task === null ? "bundle" : "task";
}

/** curriculum_get → 스펙 §7.1 내부 정규화 트리. 형제 순서 = 입력 순서(서버 전위 정렬). 보관은 includeArchived 아니면 하위째 제외 */
export function toCurriculumTree(c: GatewayCurriculum, opts: { includeDescriptions: boolean; includeArchived?: boolean }): CurriculumTree {
  const nick = new Map(c.members.map((m) => [m.userId, m.nickname]));
  const byId = new Map<string, TreeNode>();
  const rounds: TreeNode[] = [];
  for (const n of c.nodes) {
    if (n.archived && !opts.includeArchived) continue;
    const parent = n.parentId === null ? null : byId.get(n.parentId);
    if (n.parentId !== null && !parent) continue;            // 부모가 빠졌으면(보관) 하위도 뺀다
    const kind = kindOf(n);
    const t: TreeNode = { id: n.id, kind, title: n.title, startDate: n.startDate, endDate: n.endDate, files: c.fileCounts?.[n.id] ?? 0, children: [] };
    if (kind === "round") {
      t.label = n.label;
      t.current = c.currentRoundId != null && c.currentRoundId === n.id;
    }
    if (n.task && n.task.type !== "personal") {
      t.taskType = n.task.type;
      if (n.task.type === "designated") {
        t.assignees = n.task.people.map((p) => p.userId);
        t.assigneeNicknames = n.task.people.map((p) => p.nickname);
      }
    }
    if (kind === "personal") {
      t.ownerId = n.ownerId ?? null;
      // 〔P8〕 ownerNickname = task.people[0].nickname, 없으면 멤버 목록
      const owner = n.task?.people[0]?.nickname ?? (n.ownerId ? nick.get(n.ownerId) : undefined);
      if (owner) t.ownerNickname = owner;
      if (typeof n.isMine === "boolean") t.isMine = n.isMine;
      if ((n.task?.submitted ?? 0) > 0) t.done = true;
    } else {
      t.progress = { assigned: n.assigned, submitted: n.submitted };
    }
    if (n.archived) t.archived = true;
    if (opts.includeDescriptions && n.descriptionMd) t.descriptionMd = clip(n.descriptionMd);
    byId.set(n.id, t);
    if (parent) parent.children.push(t);
    else if (n.depth === 2) rounds.push(t);
  }
  return {
    schema: "sgtudy.curriculum/v1",
    version: c.version,
    today: c.today,
    study: { slug: c.study.slug, title: c.study.title, status: c.study.status ?? c.room.status, startDate: c.study.startDate, endDate: c.study.endDate },
    me: { canEditCurriculum: c.myPermissions.canEditCurriculum, canAddPersonal: c.personal?.canAdd ?? false, personalPerRound: c.personal?.perRound ?? 20 },
    members: c.members.map((m) => ({ userId: m.userId, nickname: m.nickname, role: m.role, status: m.status, doesTasks: m.doesTasks, canEditCurriculum: m.canEditCurriculum })),
    rounds,
    constraints: CONSTRAINTS,
  };
}
