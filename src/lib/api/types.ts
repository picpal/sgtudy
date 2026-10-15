/** docs/backend/03-api.md 의 RPC 응답 DTO. 서버는 원시 값만 주고 문구 조립은 어댑터가 한다(D13). */
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";

export type Person = { userId: string; nickname: string; tone: Tone };
export type RoomStatusDto = "draft" | "recruit" | "active" | "ended";
export type TaskTypeDto = "common" | "designated";
export type JoinMode = "direct" | "approval";
export type Membership = {
  role: "leader" | "member";
  status: "active" | "pending" | "inactive" | "rejected" | "canceled" | "expired";
} | null;
export type RoomTagDto = { slug: string; label: string; tone: Tone; auto: boolean };
export type MeState = { state: "none" | "pending" | "active" | "inactive" | "leader" } | null;

export type MetaDto = { today: string; serverTime: string };

export type Me = {
  id: string;
  email: string;
  nickname: string | null;
  initial: string;
  tone: Tone;
  onboarded: boolean;
  optionalMailEnabled: boolean;
  unreadCount: number;
};
export type NicknameCheck = { available: boolean; reason?: "taken" | "invalid" | "reserved" };

/* ---------- 방 목록 ---------- */
export type RoomCardProgress =
  | { kind: "recruit" }
  | { kind: "mine"; submitted: number; assigned: number; nextTask: { nodeId: string; title: string; dueDate: string } | null }
  | { kind: "team"; currentRound: { index: number; label: string; title: string } | null; totalRounds: number }
  | { kind: "final"; submitted: number; assigned: number; totalRounds: number };

export type RoomCardDto = {
  id: string;
  slug: string;
  title: string;
  intro: string;
  status: RoomStatusDto;
  isFull: boolean;
  isPublic: boolean;
  joinMode: JoinMode;
  memberCount: number;
  maxMembers: number;
  leader: Person;
  tags: RoomTagDto[];
  startDate: string;
  endDate: string;
  membership: Membership;
  progress: RoomCardProgress;
};

export type RoomListResponse = {
  today: string;
  items: RoomCardDto[];
  page: number;
  size: number;
  totalElements: number;
  tabCounts: { public: number; mine: number; created: number };
  tagFacets: { slug: string; label: string; count: number }[];
};

export type CreateRoom = {
  title: string;
  intro: string;
  startDate: string;
  endDate: string;
  maxMembers: number;
  isPublic: boolean;
  joinMode: JoinMode;
  descriptionMd?: string;
  rulesMd?: string;
  minMembers?: number;
  leaderDoesTasks?: boolean;
  tagSlugs?: string[];
};

/* ---------- 방 상세 ---------- */
export type LeafSummary = {
  id: string;
  title: string;
  type: TaskTypeDto;
  startDate: string;
  endDate: string;
  people: (Person & { status: TaskStatus })[];
};
export type RoundSummary = {
  id: string;
  label: string;
  title: string;
  startDate: string;
  endDate: string;
  leafCount: number;
  assigned: number;
  submitted: number;
  pct: number | null;
  tasks?: LeafSummary[];
};
/** 호출자 권한 (0011). 서버는 room_get·curriculum_get·node_* 응답에 늘 넣는다 — 비로그인은 false */
export type MyPermissions = { canEditCurriculum: boolean };
export type RoomMemberDto = Person & {
  role: "leader" | "member";
  status: "active" | "pending" | "inactive";
  joinedAt: string | null;
  /** 실효 커리큘럼 편집 권한(그룹장 true, ACTIVE 멤버는 위임 여부). 서버는 늘 보낸다 — 선택형은 room-view·membership 테스트 픽스처 호환용 */
  canEditCurriculum?: boolean;
};
/** room_members_get.items · member_set_curriculum_editor 반환 (그룹장 전용 멤버 한 줄) */
export type RoomMemberAdminDto = Person & {
  role: "leader" | "member";
  status: "active" | "pending" | "inactive" | "rejected" | "canceled" | "expired";
  joinedAt: string | null;
  canEditCurriculum: boolean;
};
export type RoomDetail = {
  today: string;
  id: string;
  slug: string;
  title: string;
  intro: string;
  descriptionMd: string;
  rulesMd: string;
  status: RoomStatusDto;
  archived: boolean;
  isPublic: boolean;
  joinMode: JoinMode;
  startDate: string;
  endDate: string;
  maxMembers: number;
  minMembers: number | null;
  memberCount: number;
  leader: Person;
  leaderDoesTasks: boolean;
  tags: RoomTagDto[];
  members: RoomMemberDto[];
  me: MeState;
  currentRound: RoundSummary | null;
  rounds: RoundSummary[];
  stats: {
    roundCount: number;
    leafCount: number;
    commonCount: number;
    designatedCount: number;
    totalAssignments: number;
    totalSubmissions: number;
    overallPct: number | null;
    unassignedCount: number;
    startWeekdays: number[];
  };
  myProgress: {
    submitted: number;
    assigned: number;
    nextDue: { nodeId: string; title: string; roundLabel: string; dueDate: string } | null;
  } | null;
  invite: { url: string } | null;
  pendingCount: number;
  myPermissions: MyPermissions;
};

export type MembershipResult = {
  me: MeState;
  memberCount: number;
  members: RoomMemberDto[];
  pendingCount: number;
};

export type InvitePreview = {
  today: string;
  room: {
    slug: string;
    title: string;
    intro: string;
    startDate: string;
    endDate: string;
    memberCount: number;
    maxMembers: number;
    status: RoomStatusDto;
    isPublic: boolean;
    joinMode: JoinMode;
    tags: RoomTagDto[];
  };
  leader: Person;
  me: MeState;
};

/* ---------- 커리큘럼 ---------- */
export type CurriculumMember = Person & { role: "leader" | "member"; status: "active" | "inactive"; doesTasks: boolean; canEditCurriculum: boolean };
export type NodeDto = {
  id: string;
  parentId: string | null;
  roundId: string;
  depth: number;
  sortOrder: number;
  label: string | null;
  title: string;
  descriptionMd: string;
  startDate: string;
  endDate: string;
  archived: boolean;
  task: {
    type: TaskTypeDto;
    people: (Person & { status: TaskStatus })[];
    assigned: number;
    submitted: number;
    state: "unassigned" | "complete" | "planned" | "delayed" | "progress";
  } | null;
  assigned: number;
  submitted: number;
  pct: number | null;
};
export type Curriculum = {
  today: string;
  room: { slug: string; status: RoomStatusDto; leaderDoesTasks: boolean };
  members: CurriculumMember[];
  nodes: NodeDto[];
  stats: { overallPct: number | null; leafCount: number; unassignedCount: number };
  warnings?: { code: string; nodeId?: string }[];
  myPermissions: MyPermissions;
};
export type NodePatch = {
  title?: string;
  descriptionMd?: string;
  startDate?: string;
  endDate?: string;
  label?: string;
  taskType?: TaskTypeDto;
  assigneeIds?: string[];
};

/* ---------- 내 스터디 · 내 일정 ---------- */
export type StudyItem = {
  slug: string;
  title: string;
  intro: string;
  membership: "leader" | "joined" | "pending";
  when: { kind: "deadline" | "start" | "end"; date: string };
};
export type MeStudies = { today: string; groups: { kind: "active" | "recruit" | "ended"; items: StudyItem[] }[] };

export type ScheduleTask = { id: string; slug: string; title: string; s: string; e: string; st: TaskStatus | null; round: string };
export type ScheduleResponse = {
  today: string;
  studies: {
    slug: string;
    title: string;
    membership: "leader" | "joined" | "pending";
    tone: Tone;
    status: RoomStatusDto;
    startDate: string;
    endDate: string;
  }[];
  tasks: ScheduleTask[];
  markers: { date: string; slug: string; round: string }[];
  upcoming: ScheduleTask[];
};

/* ---------- 알림 ---------- */
/** 서버 notification_kinds() (0008 + 0012 CURRICULUM_EDITOR_*). 제목·링크는 서버가 렌더하므로 화면은 kind 로 분기하지 않는다 */
export const NOTIFICATION_KINDS = [
  "ROUND_STARTED", "TASK_ALL_SUBMITTED", "TASK_COMPLETION_DIGEST", "JOIN_REQUESTED", "JOIN_APPROVED", "JOIN_REJECTED",
  "JOIN_EXPIRED", "DEADLINE_REMINDER", "TASK_ASSIGNED", "TASK_UNASSIGNED", "SCHEDULE_CHANGED", "ROOM_STARTED",
  "ROOM_ENDED", "ROOM_START_BLOCKED", "MEMBER_DEACTIVATED", "CURRICULUM_EDITOR_GRANTED", "CURRICULUM_EDITOR_REVOKED",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationDto = {
  id: string;
  /** 모르는 kind 가 와도 깨지지 않게 string 도 받는다 */
  kind: NotificationKind | (string & {});
  title: string;
  body: string | null;
  room: { slug: string; title: string } | null;
  link: string;
  actor: Person | null;
  createdAt: string;
  readAt: string | null;
};
export type NotificationList = { items: NotificationDto[]; nextCursor: string | null };
