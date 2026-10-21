/** docs/backend/03-api.md 의 RPC 응답 DTO. 서버는 원시 값만 주고 문구 조립은 어댑터가 한다(D13). */
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";

export type Person = { userId: string; nickname: string; tone: Tone };
export type RoomStatusDto = "draft" | "recruit" | "active" | "ended";
export type TaskTypeDto = "common" | "designated" | "personal";
export type JoinMode = "direct" | "approval";
export type Membership = {
  role: "leader" | "member";
  status: "active" | "pending" | "inactive" | "rejected" | "canceled" | "expired";
} | null;
export type RoomTagDto = { slug: string; label: string; tone: Tone; auto: boolean };
/** 탈퇴 요청(0024 D3) — ACTIVE 멤버가 요청 중일 때만 키가 있다(방이 진행중·미보관일 때만) */
export type LeaveRequest = { requestedAt: string; reason: string | null };
export type MeState = { state: "none" | "pending" | "active" | "inactive" | "leader"; leaveRequest?: LeaveRequest } | null;

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
  /** 0032 진행중 추가 모집 마감(창이 열린 방만) */
  recruitUntil?: string | null;
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
  /** 0024 — 진행중 방 ACTIVE 멤버의 탈퇴 요청 시각(없으면 null) */
  leaveRequestedAt?: string | null;
};
/** 0032 — 모집 열림(RECRUIT 또는 추가 모집 창) · 추가 모집 마감일(진행중 + 창 열림일 때만) */
export type RoomRecruit = { open: boolean; extraUntil: string | null };
/** 0032 — 모집 상태와 무관한 "바로 참가". active = 지금 유효(기한 안 · 한도 남음 · 방 모집중/진행중) */
export type InviteBypass = { until: string; max: number | null; used: number; active: boolean };
/** 그룹장에게만 오는 초대 정보(room_detail_json.invite). code 는 0032 전 행이면 null — invite_get 이 채운다 */
export type InviteInfo = { url: string; token: string; code: string | null; bypass: InviteBypass | null };
/** 0032 invite_preview.join — 이 초대로 지금 할 수 있는 것. mode null = 참가 불가 */
export type InviteJoin = { mode: JoinMode | null; via: "recruit" | "extra" | "invite" | null; until: string | null };

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
  invite: InviteInfo | null;
  /** 0032 — 모집 열림 · 추가 모집 마감(진행중 + 창 열림일 때만). 서버는 항상 보낸다 */
  recruit?: RoomRecruit;
  pendingCount: number;
  /** 0024 — 처리할 탈퇴 요청 수(그룹장에게만 실제 수, 그 외 0) */
  leaveRequestCount?: number;
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
    recruitUntil?: string | null;
  };
  leader: Person;
  me: MeState;
  join?: InviteJoin;
};

/* ---------- 커리큘럼 ---------- */
export type CurriculumMember = Person & { role: "leader" | "member"; status: "active" | "inactive"; doesTasks: boolean; canEditCurriculum: boolean;
  /** 0032 중간 합류자 공통 과제 배정 시작일. null·없음 = 처음부터 */
  assignFrom?: string | null };
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
  /** 개인 목표의 소유자 userId — 서버는 항상 보내고 팀 노드는 null (옛 픽스처만 생략) */
  ownerId?: string | null;
  /** 0024 — node_create 로 만든 사람(그 이전 노드·시드·개인 목표는 null) */
  createdBy?: Person | null;
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
  /** 0037 — 시험 리프 요약(정답·점수 없음). 시험 아님·비멤버 → null. 초안을 편집자 아닌 멤버가 보면 {status} 만 */
  exam?: ExamSummary | null;
};
export type Curriculum = {
  today: string;
  room: { slug: string; status: RoomStatusDto; leaderDoesTasks: boolean };
  members: CurriculumMember[];
  nodes: NodeDto[];
  stats: { overallPct: number | null; leafCount: number; unassignedCount: number };
  /** 편집자 전용(0037 EXAM_NOT_PUBLISHED 등). curriculum_get 에서만 믿는다 — 변경 RPC 응답은 자기 경고로 덮는다 */
  warnings?: { code: string; nodeId?: string; message?: string }[];
  myPermissions: MyPermissions;
  /** 0014 — 개인 목표 추가 가능 여부·회차당 한도 */
  personal?: { canAdd: boolean; perRound: number };
};
export type NodePatch = {
  title?: string;
  descriptionMd?: string;
  startDate?: string;
  endDate?: string;
  label?: string;
  taskType?: TaskTypeDto;
  assigneeIds?: string[];
  /** 0024 D2 — 하위가 있는 노드에서만: 시작일이 바뀐 날수만큼 모든 자손(보관 포함)을 함께 옮긴다 */
  shiftDescendants?: boolean;
};
/** node_update(shiftDescendants) 응답 — 함께 옮긴 수(보관 제외, archived 는 따로) */
export type ShiftedCounts = { days: number; tasks: number; personal: number; groups: number; archived: number };

/* ---------- 내 스터디 · 내 일정 ---------- */
export type StudyItem = {
  slug: string;
  title: string;
  intro: string;
  membership: "leader" | "joined" | "pending";
  when: { kind: "deadline" | "start" | "end" | "recruitEnd"; date: string };
  /** 0024 — 보관된 방(me_studies(p_include_archived) 의 archived 그룹) */
  archived?: boolean;
};
export type MeStudies = { today: string; groups: { kind: "active" | "recruit" | "ended" | "archived"; items: StudyItem[] }[] };

export type ScheduleTask = { id: string; slug: string; title: string; s: string; e: string; st: TaskStatus | null; round: string; personal?: boolean };
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

/* ---------- 내 과제 (me_tasks, 0014) ---------- */
export type MeTaskStudy = {
  slug: string;
  title: string;
  tone: Tone;
  status: RoomStatusDto;
  membership: "leader" | "joined";
  currentRoundId: string | null;
  canAddPersonal: boolean;
};
export type MeTaskRound = {
  id: string;
  slug: string;
  label: string | null;
  title: string;
  startDate: string;
  endDate: string;
  canAdd: boolean;
};
export type MeTaskItem = {
  id: string;
  slug: string;
  roundId: string;
  groupTitle: string | null;
  title: string;
  type: TaskTypeDto;
  startDate: string;
  endDate: string;
  st: TaskStatus;
  submittedAt: string | null;
  /** 회차 아래부터 이 노드까지 조상 경로 [sort_order, id] (0042). 옛 서버엔 없음 → 화면은 옛 정렬 */
  ord?: [number, number][];
};
export type MeTasks = {
  today: string;
  personalPerRound: number;
  studies: MeTaskStudy[];
  rounds: MeTaskRound[];
  items: MeTaskItem[];
};

/* ---------- 알림 ---------- */
/** 서버 notification_kinds() (0008 + 0012 CURRICULUM_EDITOR_* + 0018 ROOM_PERIOD_CHANGED + 0024). 제목·링크는 서버가 렌더하므로 화면은 kind 로 분기하지 않는다 */
export const NOTIFICATION_KINDS = [
  "ROUND_STARTED", "TASK_ALL_SUBMITTED", "TASK_COMPLETION_DIGEST", "JOIN_REQUESTED", "JOIN_APPROVED", "JOIN_REJECTED",
  "JOIN_EXPIRED", "DEADLINE_REMINDER", "TASK_ASSIGNED", "TASK_UNASSIGNED", "SCHEDULE_CHANGED", "ROOM_STARTED",
  "ROOM_ENDED", "ROOM_START_BLOCKED", "MEMBER_DEACTIVATED", "CURRICULUM_EDITOR_GRANTED", "CURRICULUM_EDITOR_REVOKED",
  "ROOM_PERIOD_CHANGED",
  // 0024
  "ROUND_SCHEDULE_CHANGED", "ROOM_ARCHIVED", "PERSONAL_ARCHIVED", "LEAVE_REQUESTED", "LEAVE_REQUEST_DISMISSED", "SUBMISSION_DIGEST",
  // 0032
  "MEMBER_JOINED",
  // 0034
  "CURRICULUM_BULK_UPDATED",
  // 0037
  "EXAM_PUBLISHED",
  // 0040
  "NOTICE_POSTED",
  // 0041
  "MENTIONED",
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

/* ---------- 과제 상세 · 제출 (03-api §5, 0007_submissions.sql) ---------- */
export type FileMeta = { id: string; name: string; contentType: string; size: number; status: "pending" | "ready" };
export type Submission = { id: string; bodyMd: string; links: string[]; files: FileMeta[]; firstSubmittedAt: string; isLate: boolean; updatedAt: string };
export type TaskDetail = {
  /** KST 오늘 — 0007:314 (03-api 표에는 없음) */
  today: string;
  node: NodeDto;
  path: { id: string; title: string; label: string | null }[];
  mySubmission: Submission | null;
  isAssignee: boolean;
  allSubmitted: boolean;
  /** can_read_submissions 일 때만 채워진다 — 담당 해제된 사람의 제출도 섞여 온다 */
  submissions: (Submission & { author: Person })[];
};

/* ---------- 회차 시험 (0037_round_exam.sql · 스펙 2026-10-21-round-exam-design §5) ---------- */
export type ExamQType = "single" | "multi" | "ox" | "short";
export type ExamReveal = "after_submit" | "after_deadline";
/** 트리·상세 요약(exam_summary). 편집자 아닌 멤버가 초안을 보면 status 만 온다 → 나머지는 선택 */
export type ExamSummary = { status: "draft" | "published"; questionCount?: number; totalPoints?: number; reveal?: ExamReveal };
/** answer·explanation 은 공개 조건(§3.4)일 때만 키가 있다. ord 는 0부터. ox·short 의 choices 는 null */
export type ExamQuestion = { id: string; ord: number; type: ExamQType; prompt: string; choices: string[] | null; points: number; answer?: unknown; explanation?: string };
export type ExamDifficulty = "easy" | "normal" | "hard";
export type ExamBrief = { topic: string; theory?: string; count: number; types: ExamQType[]; difficulty: ExamDifficulty; note?: string };
export type ExamAttempt = {
  status: "in_progress" | "submitted";
  /** 문항 id → 저장된 답. 제출 뒤 미답 문항은 null */
  answers: Record<string, unknown>;
  score: number | null;
  maxScore: number | null;
  correctCount: number | null;
  submittedAt: string | null;
  isLate: boolean | null;
  /** 공개 조건 + 제출 뒤에만(after_deadline 마감 전 = null, 점수만) */
  results: Record<string, { correct: boolean; earned: number }> | null;
};
/** exam_view v_reason 우선순위 순. closed = after_deadline 마감 뒤(정답 공개 → 응시 불가) */
export type ExamViewerReason = "submitted" | "room_not_active" | "archived" | "not_assignee" | "not_published" | "not_started" | "closed";
export type ExamView = {
  today: string;
  node: { id: string; title: string; startDate: string; endDate: string; archived: boolean };
  /** 편집자 아닌 사람이 초안을 보면 {status:"draft", publishedAt:null, closed:false} 만. source·locked·submittedCount·brief 는 편집자 전용 */
  exam: ExamSummary & {
    publishedAt: string | null;
    closed: boolean;
    source?: "manual" | "ai";
    /** 응시 행 1건~(진행 중 포함) — 구조 잠금 */
    locked?: boolean;
    submittedCount?: number;
    brief?: ExamBrief | null;
  };
  /** exam_attempt_get 에서는 대상 사람 기준(canTake 는 본인일 때만 참) */
  viewer: { canEdit: boolean; isAssignee: boolean; canTake: boolean; reason: ExamViewerReason | null };
  /** 담당 아님 · 초안 · 시작 전(담당자) → null. 편집자는 항상 */
  questions: ExamQuestion[] | null;
  attempt: ExamAttempt | null;
};
export type ExamAnswerSaved = { savedAt: string; answered: number; total: number };
/** exam_results(편집자). 집계는 현재 담당자만(submitted ≤ assigned). correctRate 는 pct(0~100) · 제출 0 → null */
export type ExamResults = {
  submitted: number;
  assigned: number;
  maxScore: number;
  avg: number | null;
  max: number | null;
  questions: { id: string; ord: number; type: ExamQType; points: number; correctRate: number | null }[];
  members: (Person & { status: TaskStatus; score: number | null; submittedAt: string | null; isLate: boolean | null })[];
};

/* ---------- 공지 (0040_room_notices.sql) ---------- */
/** read = 보는 사람이 현재 리비전을 확인했는지("다시 알리기" 뒤엔 false). edited = 제목·본문이 작성 1분 뒤 바뀜(고정·팝업 토글 제외) */
export type Notice = {
  id: string;
  title: string;
  bodyMd: string;
  popup: boolean;
  pinned: boolean;
  /** 탈퇴 등으로 프로필이 지워지면 null */
  author: Person | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  read: boolean;
  /** 팝업 리비전(다시 알리기마다 +1) — [확인] 이 본 리비전을 돌려 보낸다 */
  rev: number;
};
export type NoticeCounts = { total: number; pinned: number; popup: number };
/** notice_list — items 는 고정 → 최신순. canWrite = 그룹장 ∧ 준비·모집·진행중 ∧ 비보관 */
export type NoticeList = { items: Notice[]; canWrite: boolean; limits: NoticeCounts; counts: NoticeCounts };
/** notice_inbox — popups 는 고정 → 오래된 순 최대 5개(ACTIVE 멤버·종료/보관 아닌 방만, 그룹장은 항상 []) */
export type NoticeInbox = { unread: boolean; popups: Notice[] };
export type NoticeInput = { title: string; bodyMd: string; popup?: boolean; pinned?: boolean };
/** renotify=true → 팝업을 켜고 멤버에게 다시 띄움 + 벨 재발행 */
export type NoticePatch = Partial<NoticeInput> & { renotify?: boolean };

/* ---------- 댓글 (0041_node_comments.sql) ---------- */
/** body = 저장 본문(멘션은 `<@uuid>` 토큰 — lib/mention 으로 나눠 그린다). edited = 본문이 작성 1분 뒤 바뀜 */
export type CommentDto = {
  id: string;
  body: string;
  /** 탈퇴 등으로 프로필이 지워지면 null */
  author: Person | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  mine: boolean;
  /** 본인 ∧ 쓰기 가능 */
  canEdit: boolean;
  /** (본인 ∨ 그룹장) ∧ 쓰기 가능 */
  canDelete: boolean;
};
/** 멘션 uid → 사람(그 방의 그룹장·멤버 행이 있는 사람만). 없는 uid 는 "@알 수 없음" */
export type CommentPeople = Record<string, Person>;
export type CommentWriteBlock = "ended" | "inactive" | "archived_node" | "exam_locked";
export type CommentLimits = { bodyMax: number; mentionsMax: number; perNode: number; perMinute: number; perHour: number; page: number; fromMax: number };
/** comment_list — items 는 오래된 → 최신. total = 살아 있는 댓글 수(시험 잠금이어도 센다) */
export type CommentPage = {
  items: CommentDto[];
  people: CommentPeople;
  /** items 보다 오래된 댓글이 있다 → [이전 댓글 더 보기](before = items[0].id) */
  hasOlder: boolean;
  /** from 딥링크가 200개를 넘겨 최신 쪽이 잘렸다 → 기본 쪽(최신 50)을 다시 부르면 된다 */
  hasNewer: boolean;
  total: number;
  canWrite: boolean;
  writeBlock: CommentWriteBlock | null;
  /** 시험 잠금(D4) — items·people 은 비어 온다 */
  locked: { reason: "exam" } | null;
  /** from 을 넘겼을 때만. deleted·missing 이면 items 는 기본 쪽(최신 50) */
  target: { id: string; state: "ok" | "deleted" | "missing" } | null;
  limits: CommentLimits;
};
/** comment_create·comment_update 응답 */
export type CommentSaved = { comment: CommentDto; people: CommentPeople };
