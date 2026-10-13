# 슥터디 백엔드 Implementation Plan — 05 프론트 통합 (Phase 7a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목업 상수(`src/data/*.ts`)로 돌아가는 4개 화면을 `src/lib/api/*` 어댑터로 Supabase RPC 에 연결하고, 로그인·온보딩·초대·프로필·방 만들기 라우트와 알림 드롭다운을 추가해 Vercel 에 배포한다.

**Architecture:** 화면 컴포넌트는 기존 `src/data/*.ts` 타입을 그대로 받는다. 어댑터가 `03-api.md` DTO → 화면 타입 변환(문구 조립·D-day·회차 창·glance)을 담당하고, 순수 변환 함수는 Vitest 로 목업·시드 숫자(toeic 8주, aws 내 진척률 **33%(2/6, D5)** D-2, algo 87%)를 회귀값으로 검증한다. 세션은 `@supabase/ssr` 쿠키(Phase 0 의 `src/lib/supabase/*`), "오늘"과 로그인 사용자는 루트 레이아웃이 한 번 받아 React Context 로 내려준다. 쓰기는 전부 RPC, 낙관적 갱신은 서버 응답으로 교체한다.

**Tech Stack:** Next.js 16 App Router(기존), React 19, `@supabase/ssr` 0.5 + `supabase-js` 2(Phase 0 설치), Vitest 3(신규 devDependency), ego-browser 스킬(E2E), Vercel CLI.

**Spec:** `docs/superpowers/plans/2026-10-13-backend-00-overview.md`(공통 계약), `docs/backend/01-decisions.md`(D1·D5·D6·D7·D13·D14), `docs/backend/03-api.md`(DTO), `docs/backend/analysis/{main,roomview,mystudy,schedule,cross-cutting}.md` §3·§6, `docs/claude-design-prompt.md` §4.1·§4.3·§4.12·§4.13·§4.14·§5, `docs/specs/*.md`(UI 수치·문구).

> **범위 밖 → plan 06 (`…-06-leader-and-submission-ui.md`, Phase 7b, 00 개요에 등록됨).** 이 플랜은 "목업 화면을 실데이터로 교체 + 인증 라우트 + 알림"까지만 한다. 아래는 **만들지 않는다** — 해당 자리에 `{/* plan 06 */}` 주석만 남긴다:
> - §4.10 과제 상세·제출 화면(마크다운 본문·링크·파일 업로드 → `task_get`/`file_register`/`submission_upsert`). 알림 `?task=` 링크는 이 플랜에서 커리큘럼 탭 리프 포커스까지만(Task 12).
> - §4.4 그룹장 사이드 패널: 승인 대기 목록 승인/거절(`room_approve`/`room_reject`), 초대 링크 복사(`invite_get`).
> - 방 상태 버튼: **모집 시작**(`room_open_recruit`, DRAFT → RECRUIT), **지금 시작**(`room_start`). → plan 05 만 끝낸 시점에 `/rooms/new` 로 만든 방은 DRAFT 에 머문다(알려진 한계 — E2E 는 시드 방만 쓴다).
> - §2.6 태그 수동 편집(`room_tags_put`/`room_tags_suggest`), §4.6 들여쓰기·내어쓰기·드래그(`node_move`).
> - §5 공통 상태 중 라우트별 `loading.tsx`·`not-found.tsx`·권한 없음 화면. 이 플랜은 **루트 `error.tsx` + `meta_get` 실패 폴백만**(Task 2).
>
> 따라서 이 플랜의 종료 = **Phase 7a 종료**(백엔드 전체 종료 아님).

> **plan 04 실행에서 넘어온 인계(2026-10-13)** — 이 플랜 실행 전 반영:
> - 로컬 `db:reset` 뒤 **실제 pg_cron 이 돈다**(kst_today 는 10/12 고정). 시드 ROUND_STARTED 행은 잡의 자연 키라 중복되지 않지만, 09:00 KST 일일 요약 등은 실행 시각에 따라 알림이 늘 수 있다 — E2E 의 미읽음 개수 단언은 시드 직후 값(철수 3)에 의존하지 말고 API 로 읽은 값 기준으로.
> - `room_tags_suggest` 는 동기 `{ today, items }`(03-api §7 메모). `Notification.room` 은 null 가능. 첨부 키 확장자는 소문자.
> - 백로그: deactivate 로 전원 제출이 되는 경우의 TASK_ALL_SUBMITTED, 당일 수동 시작 방의 1회차 ROUND_STARTED, 방 기간 변경 알림, ASCII 태그 부분일치 오탐(java ⊂ JavaScript).
> - plan 04 의 Task 9(LLM `suggest-tags` Edge Function)는 실행하지 않았다(선택·기본 OFF).

## 선행 조건 (Phase 0–6 완료 가정)

이 계획은 아래가 **이미 존재**한다고 가정한다. 없으면 01~04 계획을 먼저 실행한다.

| 경로 | 내용 | 출처 |
|---|---|---|
| `src/lib/supabase/client.ts` | `export function createClient()` — `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)` | Phase 0 (asklyy 그대로) |
| `src/lib/supabase/server.ts` | `export async function createClient()` — `createServerClient` + `cookies()` | Phase 0 |
| `src/lib/supabase/middleware.ts` + `src/proxy.ts` | `updateSession(request)`: 세션 갱신, 보호 라우트(`/my-study`, `/schedule`, `/me`, `/rooms/new`) → `/login?returnTo=` (Next 16 은 `middleware.ts` 가 아니라 `proxy.ts`) | Phase 0 |
| `src/lib/supabase/database.types.ts` | `supabase gen types typescript --local > …` 결과 (`Database` 타입) | Phase 1~6 |
| RPC 전부 | `meta_get`, `me_get`, `me_update`, `nickname_check`, `rooms_list`, `room_create`, `room_get`, `room_join`, `room_apply`, `room_leave`, `room_cancel_application`, `invite_preview`, `invite_join`, `curriculum_get`, `node_create`, `node_update`, `node_move`, `node_delete`, `node_archive`, `node_unarchive`, `me_studies`, `me_schedule`, `notifications_list`, `notifications_unread_count`, `notifications_read`, `notifications_read_all` | 03-api.md |
| 시드 | slug `aws, toeic, spring, algo, jcg, cs, react, docker, sqld`, 사용자 철수(aws·spring·algo 멤버, sqld PENDING, docker 그룹장) — 이메일은 `supabase/seed.sql` 의 `auth.users` 삽입 구문 참조 | Phase 1~3 |
| 로컬 Supabase | `supabase start` 후 Studio http://127.0.0.1:54323, **Inbucket(메일) http://127.0.0.1:54324** | Phase 0 |

## Global Constraints

- 프론트 수정 범위: `src/data/*.ts` 의 **타입·export 이름은 유지**(필드 추가·유니온 확장만 허용, 삭제 금지). 화면 컴포넌트는 데이터 소스만 바꾼다. 스펙의 px·hex·문구는 바꾸지 않는다.
- 새 라우트: `/login`, `/onboarding`, `/invite/[token]`, `/me`, `/rooms/new`. 이동은 반드시 `routes.*` 로.
- `returnTo` 허용 접두사: `/rooms/`, `/my-study`, `/schedule`, `/invite/` 만. 그 외는 `/`.
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만. `NEXT_PUBLIC_API_URL` 폐기. `service_role` 키는 Vercel 에 넣지 않는다.
- 숫자 id 는 어댑터에서 전부 문자열. 공개 식별자는 `slug`. 노드 id 는 서버 id(`"0.1"` 경로 id 폐기).
- "오늘"은 서버 응답 `today`(KST) 만. `TODAY` 상수는 테스트 픽스처 용도로만 남기고 화면 코드에서 import 하지 않는다(마지막 태스크에서 grep 으로 확인).
- 사람 비교는 `userId` 로만(닉네임 비교 금지). 아바타 색은 DTO `tone`.
- 에러는 `toApiError(e).message`(한국어 detail) 를 그대로 보여준다. `code` 분기: `ROOM_NOT_FOUND` → 404, `AUTH_REQUIRED` → 로그인, `ONBOARDING_REQUIRED` → `/onboarding`.
- 테스트: Vitest, `src/**/*.test.ts`, 어댑터 순수 함수만(Supabase 호출은 테스트하지 않음). 기대값은 목업 숫자.
- 이 기계는 메모리가 빠듯하다. `supabase start` 와 `npm run build` 를 동시에 돌리지 않는다. 시작 전 `vm_stat | grep -E 'free|compressor'`.
- 커밋 메시지 `feat(web): …` / `test(web): …` / `docs: …`, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx`. 매 태스크 끝에 `npm run lint && npx tsc --noEmit && npx vitest run` 통과 후 커밋.

## Review Focus

스펙이 암시하지만 어느 태스크의 테스트도 자연히 다루지 않을 입력 5가지. 각 항목은 아래 지정한 태스크에 테스트로 박혀 있다.

1. **같은 해가 아닌 기간** — spring `2026-10-05 ~ 2027-01-31` 카드 period 는 `2026.10.05 – 2027.01.31 · 17주` 여야 한다(연도 생략 금지). → Task 8 `periodCard` 테스트.
2. **현재 회차가 없는 진행중 방** — 회차 사이 공백(오늘이 어느 회차 기간에도 없음)이면 `currentRound=null`. roundsWindow 는 "오늘 이전 마지막 회차"를 기준으로 창을 잡고, cur 카드는 "진행 중인 회차가 없어요" 를 보여야 한다. → Task 8 `roundsWindow`·`curOf` 테스트.
3. **`st: null` 과제** — 그룹장이 `leaderDoesTasks=false` 인 방의 일정 과제는 `st` 가 null 로 온다. 날짜 기준 `planned|open` 으로 보정하되 upcoming 에서는 제외돼야 한다. → Task 13 `toTask`·`toScheduleData` 테스트.
4. **PostgREST 가 아닌 에러** — 네트워크 실패(`TypeError: Failed to fetch`)나 Auth 에러(`AuthApiError`)는 `code:"UNKNOWN"` + 원문 메시지로 떨어져야 하며 화면이 깨지면 안 된다. → Task 1 `toApiError` 테스트.
5. **returnTo 오픈 리다이렉트** — `/login?returnTo=https://evil.com` 이나 `//evil.com` 은 `/` 로 떨어져야 한다. → Task 2 `safeReturnTo` 테스트.

## 파일 구조

| 경로 | 책임 | 태스크 |
|---|---|---|
| (plan 01 Task 3 소유) `vitest.config.ts`, `npm test` | Vitest 설정 — 이 플랜은 재사용만 | — |
| `src/lib/api/types.ts` | `03-api.md` DTO 타입(단일 출처) | 1 |
| `src/lib/api/errors.ts` | `ApiError`, `toApiError`, `rpc<T>` | 1 |
| `src/lib/routes.ts` | 라우트 추가(`login/onboarding/me/invite/createRoom`), plan 01 `safeReturnTo`·`loginUrl` **re-export** | 2 |
| `src/lib/today.ts` | `TodayProvider` / `useToday` | 2 |
| `src/lib/me.ts` | `MeProvider` / `useMe` | 2 |
| `src/app/layout.tsx`, `src/app/error.tsx` | `meta_get`·`me_get` 1회 → Provider(실패 시 클라이언트 KST 폴백), 루트 에러 경계 | 2 |
| `src/lib/api/me.ts`, `src/lib/api/me.server.ts` | `fetchMe`, `updateMe`, `checkNickname`, `requireMe` | 3 |
| `src/components/ui/AppHeader.tsx` | 익명 변형, 프로필 메뉴, 알림 벨 슬롯 | 3 |
| `src/lib/api/notifications.ts`, `src/components/ui/NotificationBell.tsx` | 60초 폴링 배지 + 드롭다운 | 4 |
| `src/app/login/page.tsx`, `src/components/auth/{LoginScreen,OtpInput,AuthShell}.tsx` | 이메일 OTP 로그인 | 5 |
| `src/app/onboarding/page.tsx`, `src/components/auth/OnboardingScreen.tsx`, `src/app/me/page.tsx`, `src/components/auth/ProfileScreen.tsx` | 닉네임 설정·프로필 | 6 |
| `src/app/invite/[token]/page.tsx`, `src/components/auth/InviteScreen.tsx` | 초대 미리보기·참가 | 7 |
| `src/lib/api/format.ts` | 화면 공용 문구 조립(period·dday·회차 창·cur·glance) | 8 |
| `src/lib/api/rooms.ts`, `src/lib/useDebounced.ts`, `src/components/main/*` | 방 목록 | 9 |
| `src/app/rooms/new/page.tsx`, `src/components/room-new/NewRoomForm.tsx` | 방 만들기 | 10 |
| `src/lib/api/room-view.ts`, `src/components/ui/ConfirmDialog.tsx`, `src/app/rooms/[id]/page.tsx`, `src/components/room-view/*` | 방 상세 | 11 |
| `src/lib/api/my-study.ts`, `src/components/my-study/*`, `src/app/my-study/**` | 내 스터디 | 12 |
| `src/lib/api/schedule.ts`, `src/components/schedule/*`, `src/app/schedule/page.tsx` | 내 일정 | 13 |
| `.env.example`, `.vercelignore`, `README.md` | 환경·문서 | 14 |
| (문서) | E2E 체크리스트, 배포 검증 | 15, 16 |

---

### Task 1: DTO 타입 + `errors.ts` (Vitest 는 plan 01 것 재사용)

**Files:**
- Create: `src/lib/api/types.ts`
- Create: `src/lib/api/errors.ts`
- Test: `src/lib/api/errors.test.ts`

**Interfaces:**
- Consumes: `src/lib/supabase/client.ts` 의 `createClient()`, `src/lib/supabase/database.types.ts` 의 `Database`.
- Produces: `type Db = SupabaseClient<Database>`, `type ApiError`, `class ApiException`, `toApiError(e: unknown): ApiError`, `rpc<T>(name: string, args?: Record<string, unknown>, client?: Db): Promise<T>`, 그리고 `types.ts` 의 모든 DTO 타입. 이후 모든 어댑터는 `rpc` 만 호출한다. 서버 컴포넌트는 세 번째 인자로 `await createClient()`(server) 를 넘기고, 클라이언트 컴포넌트는 생략한다(브라우저 클라이언트 싱글턴).

- [ ] **Step 1: Vitest 확인 (설치·설정하지 않는다)**

plan 01 Task 1·3 이 `vitest` devDependency, `npm test`(= `vitest run`), `vitest.config.ts`(`@` alias, `src/**/*.test.ts`, node 환경)를 이미 만들었다. 다시 만들지 않고 확인만 한다.

Run: `test -f vitest.config.ts && npm pkg get scripts.test && npx vitest run src/lib/supabase/return-to.test.ts`
Expected: `"vitest run"` 출력, plan 01 의 `return-to` 테스트 통과. 파일이 없으면 이 플랜을 멈추고 plan 01 Task 3 을 먼저 끝낸다.

- [ ] **Step 2: DTO 타입 작성** — `src/lib/api/types.ts` (03-api.md 와 1:1. 모든 읽기 응답은 `today` 포함)

```ts
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
export type RoomMemberDto = Person & {
  role: "leader" | "member";
  status: "active" | "pending" | "inactive";
  joinedAt: string | null;
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
export type CurriculumMember = Person & { role: "leader" | "member"; status: "active" | "inactive"; doesTasks: boolean };
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
export type NotificationDto = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  room: { slug: string; title: string } | null;
  link: string;
  actor: Person | null;
  createdAt: string;
  readAt: string | null;
};
export type NotificationList = { items: NotificationDto[]; nextCursor: string | null };
```

- [ ] **Step 3: 실패하는 테스트 작성** — `src/lib/api/errors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ApiException, toApiError } from "./errors";

describe("toApiError", () => {
  it("maps a PostgREST P0001 error: message→code, details→message, hint→details", () => {
    const e = { code: "P0001", message: "ROOM_FULL", details: "정원이 찼어요", hint: '{"field":"maxMembers"}', name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "ROOM_FULL", message: "정원이 찼어요", details: { field: "maxMembers" } });
  });

  it("keeps a non-JSON hint out of details", () => {
    const e = { code: "P0001", message: "AUTH_REQUIRED", details: "로그인이 필요해요", hint: "", name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "AUTH_REQUIRED", message: "로그인이 필요해요", details: undefined });
  });

  it("falls back to UNKNOWN for a PostgREST error whose message is not a CODE", () => {
    const e = { code: "42883", message: "function public.nope() does not exist", details: null, hint: null, name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "UNKNOWN", message: "function public.nope() does not exist", details: undefined });
  });

  it("wraps a plain Error (network failure) as UNKNOWN with its message", () => {
    expect(toApiError(new TypeError("Failed to fetch"))).toEqual({ code: "UNKNOWN", message: "Failed to fetch" });
  });

  it("passes an ApiException through unchanged", () => {
    const ex = new ApiException({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요" });
    expect(toApiError(ex)).toEqual({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요", details: undefined });
    expect(ex.message).toBe("그룹장만 할 수 있어요");
  });

  it("handles a non-Error throw", () => {
    expect(toApiError("boom")).toEqual({ code: "UNKNOWN", message: "알 수 없는 오류가 발생했어요" });
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run src/lib/api/errors.test.ts`
Expected: FAIL — `Cannot find module './errors'`

- [ ] **Step 5: `errors.ts` 구현**

```ts
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/** 03-api.md §0 — PostgrestError { message: CODE, details: 한국어, hint: json } */
export type ApiError = { code: string; message: string; details?: Record<string, string> };

export class ApiException extends Error {
  code: string;
  details?: Record<string, string>;
  constructor(e: ApiError) {
    super(e.message);
    this.name = "ApiException";
    this.code = e.code;
    this.details = e.details;
  }
}

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

const isPostgrest = (e: unknown): e is PostgrestError =>
  typeof e === "object" && e !== null && "message" in e && "code" in e && "hint" in e;

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiException) return { code: e.code, message: e.message, details: e.details };
  if (isPostgrest(e)) {
    const isCode = CODE_RE.test(e.message);
    let details: Record<string, string> | undefined;
    if (isCode && e.hint) {
      try {
        details = JSON.parse(e.hint);
      } catch {
        details = undefined;
      }
    }
    return { code: isCode ? e.message : "UNKNOWN", message: isCode ? e.details || e.message : e.message, details };
  }
  if (e instanceof Error) return { code: "UNKNOWN", message: e.message };
  return { code: "UNKNOWN", message: "알 수 없는 오류가 발생했어요" };
}

let browser: Db | null = null;
const browserClient = (): Db => (browser ??= createClient() as Db);

type RpcFn = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

/**
 * supabase.rpc 래퍼. 실패 시 ApiException(ApiError) 을 throw.
 * client 생략 → 브라우저 클라이언트. 서버 컴포넌트에서는 `await createClient()`(server.ts) 를 넘긴다.
 */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}, client?: Db): Promise<T> {
  const c = client ?? browserClient();
  const { data, error } = await (c.rpc as unknown as RpcFn)(name, args);
  if (error) throw new ApiException(toApiError(error));
  return data as T;
}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run src/lib/api/errors.test.ts && npx tsc --noEmit`
Expected: 6 passed, tsc 에러 0

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/types.ts src/lib/api/errors.ts src/lib/api/errors.test.ts
git commit -m "feat(web): add api DTO types and rpc/toApiError wrapper"
```

---

### Task 2: `routes` 확장 + `TodayProvider` / `MeProvider` + 루트 레이아웃(폴백·에러 경계)

**Files:**
- Modify: `src/lib/routes.ts`
- Create: `src/lib/today.ts`, `src/lib/me.ts`, `src/lib/kst.ts`, `src/app/error.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/lib/routes.test.ts`, `src/lib/kst.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `types.ts` `MetaDto`·`Me`; plan 01 `src/lib/supabase/return-to.ts` 의 `safeReturnTo`·`loginUrl`(백슬래시·`..`·공백·제어문자까지 거르는 강한 버전 — **이 플랜은 재구현하지 않고 re-export**), Phase 0 `createClient`(server).
- Produces: `routes.login(returnTo?)`(= `loginUrl`), `routes.onboarding(returnTo?)`, `routes.me()`, `routes.invite(token)`, `routes.createRoom() === "/rooms/new"`, re-export `safeReturnTo`·`loginUrl`; `kstToday(now?: Date): string`(Intl `Asia/Seoul`, `meta_get` 실패 폴백); `TodayProvider({ today, children })`, `useToday(): string`; `MeProvider({ me, children })`, `useMe(): Me | null`; 루트 `error.tsx`(§5 오류 상태 — 라우트별 `loading/not-found` 는 plan 06). `TODAY`·`ME` 상수는 남기되 화면에서 import 하지 않는다.

**TODAY/ME 를 import 하는 파일 전수(grep 결과) — 각 소유 태스크에서 교체한다:**

| 파일 | 상수 | 교체 태스크 |
|---|---|---|
| `src/components/ui/AppHeader.tsx` | ME | 3 |
| `src/components/room-view/JoinCard.tsx` | ME | 11 |
| `src/components/my-study/model.ts` | TODAY, ME | 12 (함수 인자 `today`, `meId`) |
| `src/components/my-study/tabs/BoardTab.tsx` | TODAY | 12 |
| `src/components/my-study/tabs/CalendarTab.tsx` | TODAY, ME | 12 |
| `src/components/my-study/tabs/GanttTab.tsx` | TODAY | 12 |
| `src/components/my-study/tabs/LeafDetail.tsx` | ME | 12 |
| `src/components/schedule/ScheduleScreen.tsx` | TODAY | 13 |
| `src/components/schedule/UpcomingPanel.tsx` | TODAY | 13 |
| `src/components/schedule/DayPanel.tsx` | TODAY | 13 |
| `src/components/schedule/ListView.tsx` | TODAY | 13 |
| `src/components/schedule/MonthGrid.tsx` | TODAY | 13 |

- [ ] **Step 1: 실패하는 테스트** — `src/lib/routes.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { loginUrl, routes, safeReturnTo } from "./routes";

describe("safeReturnTo (re-export of plan 01 return-to.ts)", () => {
  it("is the same function as plan 01", async () => {
    const p01 = await import("./supabase/return-to");
    expect(safeReturnTo).toBe(p01.safeReturnTo);
    expect(loginUrl).toBe(p01.loginUrl);
  });
  it("allows the four prefixes", () => {
    expect(safeReturnTo("/rooms/aws")).toBe("/rooms/aws");
    expect(safeReturnTo("/my-study")).toBe("/my-study");
    expect(safeReturnTo("/my-study/aws?tab=board")).toBe("/my-study/aws?tab=board");
    expect(safeReturnTo("/schedule")).toBe("/schedule");
    expect(safeReturnTo("/invite/abc")).toBe("/invite/abc");
  });
  it("rejects open redirects and unknown paths", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/roomsx")).toBe("/");
    expect(safeReturnTo("/me")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("/rooms/../me")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("routes", () => {
  it("builds auth routes", () => {
    expect(routes.login()).toBe("/login");
    expect(routes.login("/rooms/aws")).toBe("/login?returnTo=%2Frooms%2Faws");
    expect(routes.onboarding("/invite/t")).toBe("/onboarding?returnTo=%2Finvite%2Ft");
    expect(routes.me()).toBe("/me");
    expect(routes.invite("tok")).toBe("/invite/tok");
    expect(routes.createRoom()).toBe("/rooms/new");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: FAIL — `safeReturnTo is not a function`(아직 re-export 전)

- [ ] **Step 3: `routes.ts` 수정** (전체 교체)

```ts
import { loginUrl } from "@/lib/supabase/return-to";

/** returnTo 검증·로그인 URL 은 plan 01 return-to.ts 가 단일 출처 — 여기서는 다시 내보내기만 한다 */
export { loginUrl, safeReturnTo } from "@/lib/supabase/return-to";

/** 화면 간 이동 경로. 아트보드 ↔ 라우트 매핑의 단일 출처. */
const withReturn = (path: string, returnTo?: string) =>
  returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;

export const routes = {
  /** Main.dc.html — 방 목록 */
  home: () => "/",
  /** RoomView.dc.html — 둘러보기에서 카드 클릭한 방 상세 (slug) */
  room: (slug: string) => `/rooms/${slug}`,
  /** RoomDetail.dc.html — 참가자 시점 내 스터디. slug 생략 시 첫 스터디로 */
  myStudy: (slug?: string) => (slug ? `/my-study/${slug}` : "/my-study"),
  /** MySchedule.dc.html — 통합 캘린더 */
  schedule: () => "/schedule",
  /** 방 만들기 (디자인 §4.3) */
  createRoom: () => "/rooms/new",
  /** 이메일 OTP 로그인 (§4.1) — returnTo 가 있으면 plan 01 loginUrl 과 같은 값 */
  login: (returnTo?: string) => (returnTo ? loginUrl(returnTo) : "/login"),
  /** 닉네임 설정 (§4.1) */
  onboarding: (returnTo?: string) => withReturn("/onboarding", returnTo),
  /** 내 프로필 (§4.13) */
  me: () => "/me",
  /** 초대 링크 진입 (§4.12) */
  invite: (token: string) => `/invite/${token}`,
} as const;

/** @deprecated 목업 기준 '오늘'. 화면 코드는 useToday() 를 쓴다. 테스트 픽스처 전용. */
export const TODAY = "2026-10-12";

/** @deprecated 목업 로그인 사용자. 화면 코드는 useMe() 를 쓴다. 테스트 픽스처 전용. */
export const ME = { name: "철수", initial: "철", tone: "blue" } as const;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: PASS (`/roomsx` 는 `/rooms/` 접두사에 안 맞으므로 `/`; `/\evil.com`·`/rooms/../me` 는 plan 01 규칙이 거른다). 이후 모든 태스크는 `safeReturnTo` 를 `@/lib/routes` 에서 import 해도 plan 01 구현을 쓴다(두 번째 구현 없음).

- [ ] **Step 5: `src/lib/today.ts`** (JSX 없이 createElement — `.ts` 유지)

```ts
"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";

/** 서버가 준 KST 오늘(YYYY-MM-DD). 루트 레이아웃이 meta_get 으로 1회 채우고, 화면은 응답 today 로 덮어쓸 수 있다. */
const TodayContext = createContext<string | null>(null);

export function TodayProvider({ today, children }: { today: string; children: ReactNode }) {
  return createElement(TodayContext.Provider, { value: today }, children);
}

export function useToday(): string {
  const v = useContext(TodayContext);
  if (!v) throw new Error("useToday() must be used inside <TodayProvider>");
  return v;
}
```

- [ ] **Step 6: `src/lib/me.ts`**

```ts
"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Me } from "@/lib/api/types";

/** 로그인 사용자. null = 비로그인. 루트 레이아웃이 me_get 으로 채운다. 로그인/로그아웃 후 router.refresh() 로 갱신. */
const MeContext = createContext<Me | null | undefined>(undefined);

export function MeProvider({ me, children }: { me: Me | null; children: ReactNode }) {
  return createElement(MeContext.Provider, { value: me }, children);
}

export function useMe(): Me | null {
  const v = useContext(MeContext);
  if (v === undefined) throw new Error("useMe() must be used inside <MeProvider>");
  return v;
}
```

- [ ] **Step 7: 루트 레이아웃 수정** — `src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import { rpc } from "@/lib/api/errors";
import type { Me, MetaDto } from "@/lib/api/types";
import { kstToday } from "@/lib/kst";
import { MeProvider } from "@/lib/me";
import { createClient } from "@/lib/supabase/server";
import { TodayProvider } from "@/lib/today";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({
  variable: "--font-plex",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "슥터디",
  description: "함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요.",
};

type Server = Awaited<ReturnType<typeof createClient>>;

/** 로그인 안 했으면 null. me_get 은 온보딩 전에도 허용(03-api §1). 실패해도 사이트 전체를 죽이지 않는다 → 익명 취급 */
async function loadMe(client: Server): Promise<Me | null> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;
    return await rpc<Me>("me_get", {}, client);
  } catch (e) {
    console.error("[layout] me_get failed — rendering as anonymous", e);
    return null;
  }
}

/** meta_get 실패(DB 다운·네트워크) 시 전 페이지 500 대신 KST 오늘로 폴백(S13). 화면별 응답 today 가 다시 덮어쓴다 */
async function loadToday(client: Server): Promise<string> {
  try {
    return (await rpc<MetaDto>("meta_get", {}, client)).today;
  } catch (e) {
    console.error("[layout] meta_get failed — falling back to Intl Asia/Seoul today", e);
    return kstToday();
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const client = await createClient();
  const [today, me] = await Promise.all([loadToday(client), loadMe(client)]);
  return (
    <html lang="ko" className={`${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MeProvider me={me}>
          <TodayProvider today={today}>{children}</TodayProvider>
        </MeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: `src/lib/kst.ts` + 테스트 + 루트 `src/app/error.tsx`**

`src/lib/kst.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { kstToday } from "./kst";

describe("kstToday", () => {
  it("uses Asia/Seoul, not the host timezone", () => {
    expect(kstToday(new Date("2026-10-11T15:30:00Z"))).toBe("2026-10-12");   // KST 10/12 00:30
    expect(kstToday(new Date("2026-10-11T14:59:59Z"))).toBe("2026-10-11");   // KST 10/11 23:59:59
  });
});
```

`src/lib/kst.ts`(지시어 없음 — 서버·클라이언트 공용):

```ts
/** KST 오늘(YYYY-MM-DD). 서버 meta_get 이 정본이고, 이건 그 호출이 실패했을 때만 쓰는 폴백이다. */
export function kstToday(now: Date = new Date()): string {
  // en-CA 로케일은 YYYY-MM-DD 로 포맷한다
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
```

`src/app/error.tsx` — 루트 에러 경계(§5 "오류" 상태). Next 16 의 `error.js` 는 `retry` 를 받는다(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). 라우트별 `loading.tsx`·`not-found.tsx` 는 plan 06.

```tsx
"use client";

import { useEffect } from "react";
import { routes } from "@/lib/routes";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <p className="m-0 text-[15px] font-semibold text-ink">화면을 불러오지 못했어요</p>
      <p className="m-0 text-[13px] text-muted">잠시 후 다시 시도해 주세요.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => retry()} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white">
          다시 시도
        </button>
        <a href={routes.home()} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          홈으로
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: 빌드 가능 확인**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. (`npm run dev` 로 http://localhost:3000 열면 기존 목업 화면이 그대로 뜨고 서버 콘솔에 `meta_get` 에러가 없어야 한다 — 로컬 supabase 가 떠 있어야 함)

확인: 로컬 supabase 를 멈춘 상태(`supabase stop`)로 `npm run dev` → `/` 가 500 이 아니라 목록 화면 골격 + 목록 영역의 오류 문구로 뜨고, 서버 콘솔에 `[layout] meta_get failed — falling back …` 1줄.

- [ ] **Step 10: Commit**

```bash
git add src/lib/routes.ts src/lib/routes.test.ts src/lib/today.ts src/lib/me.ts src/lib/kst.ts src/lib/kst.test.ts src/app/layout.tsx src/app/error.tsx
git commit -m "feat(web): auth routes re-using plan 01 safeReturnTo, Today/Me providers, meta_get fallback and root error boundary"
```

---
## 어댑터가 호출하는 RPC 인자 이름 (Task 3~13 공통 — 여기서 한 번만 고정)

플랜 01·02 에 시그니처가 확정된 것은 그대로, 플랜 03·04 에서 만드는 함수는 `03-api.md` 의 인자 설명을 `p_` 규칙(00 개요)으로 옮긴 **가정값**이다. 각 태스크 첫 단계에서 `src/lib/supabase/database.types.ts` 의 `Functions["<name>"]["Args"]` 와 대조해 다르면 어댑터 파일 한 곳만 고친다(`rpc()` 는 `Record<string, unknown>` 을 받으므로 tsc 가 잡아 주지 않는다).

```bash
# 확인 명령 — 인자 키가 아래 표와 같은지 본다
grep -n -A6 '"rooms_list": {' src/lib/supabase/database.types.ts
```

| RPC | 인자 (JSON 키) | 출처 |
|---|---|---|
| `meta_get`, `me_get` | 없음 | 플랜 01 확정 |
| `me_update` | `p_nickname?, p_optional_mail_enabled?` | 플랜 01 확정 |
| `nickname_check` | `p_value` | 플랜 01 확정 |
| `rooms_list` | `p_scope, p_status, p_q, p_tags, p_page, p_size, p_sort` | 플랜 02 확정 |
| `room_get` | `p_slug, p_invite_token?` | 플랜 02 확정 |
| `room_create` | `p_title, p_intro, p_start_date, p_end_date, p_max_members, p_is_public, p_join_mode('direct'\|'approval'), p_description_md, p_rules_md, p_min_members, p_leader_does_tasks, p_tag_slugs` | 플랜 02 확정 |
| `room_join`, `room_apply` | `p_slug, p_invite_token?` | 플랜 02 (가정) |
| `room_leave`, `room_cancel_application` | `p_slug` | 플랜 02 (가정) |
| `invite_preview`, `invite_join` | `p_token` | 플랜 02 (가정). 시드 토큰 `seed-<slug>` |
| `curriculum_get` | `p_slug, p_include_archived` | 플랜 03 (가정) |
| `node_create` | `p_slug, p_parent_id, p_title?, p_label?, p_task_type?, p_start_date?, p_end_date?, p_index?` | 플랜 03 (가정) |
| `node_update` | `p_slug, p_node_id, p_patch(jsonb: NodePatch)` | 플랜 03 (가정, `room_update(p_slug, p_patch)` 와 같은 꼴) |
| `node_move` | `p_slug, p_node_id, p_parent_id, p_index` | 플랜 03 확정 — **이 플랜은 호출하지 않는다**(들여쓰기·드래그 UI 는 plan 06) |
| `node_delete`, `node_archive`, `node_unarchive` | `p_slug, p_node_id` | 플랜 03 (가정) |
| `me_studies` | 없음 | 플랜 03 (가정) |
| `me_schedule` | `p_from, p_to` | 플랜 03 (가정) |
| `notifications_list` | `p_cursor?, p_limit` | 플랜 04 (가정) |
| `notifications_unread_count`, `notifications_read_all` | 없음 | 플랜 04 (가정) |
| `notifications_read` | `p_id` | 플랜 04 (가정) |

---

### Task 3: `me.ts` / `me.server.ts` + AppHeader(익명 변형·프로필 메뉴)

**Files:**
- Create: `src/lib/api/me.ts`, `src/lib/api/me.server.ts`
- Modify: `src/components/ui/AppHeader.tsx` (전체 교체)
- Test: `src/lib/api/me.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `Me`, `NicknameCheck`; Task 2 `useMe`, `routes`, `safeReturnTo`; Phase 0 `createClient`(client/server).
- Produces:
  ```ts
  // src/lib/api/me.ts (클라이언트)
  export function fetchMe(): Promise<Me>;
  export function updateMe(patch: { nickname?: string; optionalMailEnabled?: boolean }): Promise<Me>;
  export function checkNickname(value: string): Promise<NicknameCheck>;
  export function signOut(): Promise<void>;
  export function nicknameProblem(value: string): "length" | "chars" | "spaces" | null;   // 서버 규칙의 클라 선검사
  // src/lib/api/me.server.ts (서버 컴포넌트 전용)
  export async function requireMe(returnTo: string): Promise<Me>;   // 비로그인 → redirect(login), 온보딩 전 → redirect(onboarding)
  // AppHeader props: { active, variant?, children? } — unread/ME prop 제거. 로그인 상태는 useMe() 로.
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/me.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { nicknameProblem } from "./me";

describe("nicknameProblem (03-api §1 닉네임 규칙의 클라이언트 선검사)", () => {
  it("accepts 2~16 chars of 한글/영문/숫자/_/./single space", () => {
    expect(nicknameProblem("철수")).toBeNull();
    expect(nicknameProblem("chul_soo.99")).toBeNull();
    expect(nicknameProblem("철 수")).toBeNull();
    expect(nicknameProblem("a".repeat(16))).toBeNull();
  });
  it("rejects length outside 2~16 (after trim)", () => {
    expect(nicknameProblem("a")).toBe("length");
    expect(nicknameProblem(" 철 ")).toBe("length");
    expect(nicknameProblem("a".repeat(17))).toBe("length");
  });
  it("rejects disallowed characters", () => {
    expect(nicknameProblem("chul-soo")).toBe("chars");
    expect(nicknameProblem("철수!")).toBe("chars");
  });
  it("rejects consecutive spaces", () => {
    expect(nicknameProblem("철  수")).toBe("spaces");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/me.test.ts`
Expected: FAIL — `Cannot find module './me'`

- [ ] **Step 3: `src/lib/api/me.ts`**

```ts
import { rpc } from "@/lib/api/errors";
import type { Me, NicknameCheck } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/client";

export const fetchMe = () => rpc<Me>("me_get");

export const updateMe = (patch: { nickname?: string; optionalMailEnabled?: boolean }) =>
  rpc<Me>("me_update", { p_nickname: patch.nickname ?? null, p_optional_mail_enabled: patch.optionalMailEnabled ?? null });

export const checkNickname = (value: string) => rpc<NicknameCheck>("nickname_check", { p_value: value });

export async function signOut(): Promise<void> {
  const { error } = await createClient().auth.signOut();
  if (error) throw error;
}

const NICK_RE = /^[\p{Script=Hangul}A-Za-z0-9_. ]+$/u;

/** 03-api §1: 2~16자, 한글·영문·숫자·_·.·공백(연속 불가). 금칙어·중복은 서버(nickname_check)가 판정한다. */
export function nicknameProblem(value: string): "length" | "chars" | "spaces" | null {
  const v = value.trim();
  if (v.length < 2 || v.length > 16) return "length";
  if (!NICK_RE.test(v)) return "chars";
  if (/ {2,}/.test(v)) return "spaces";
  return null;
}

export const NICK_PROBLEM_TEXT: Record<NonNullable<ReturnType<typeof nicknameProblem>>, string> = {
  length: "2~16자로 입력해 주세요",
  chars: "한글·영문·숫자·_·. 만 쓸 수 있어요",
  spaces: "공백은 연속으로 쓸 수 없어요",
};
```

- [ ] **Step 4: `src/lib/api/me.server.ts`**

```ts
import "server-only";
import { redirect } from "next/navigation";
import { rpc } from "@/lib/api/errors";
import type { Me } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * 로그인+온보딩이 필요한 서버 페이지(/me, /rooms/new, /my-study, /schedule)에서 호출.
 * proxy 가 비로그인은 이미 /login 으로 보내지만, 온보딩 미완료는 여기서 잡는다(D7).
 */
export async function requireMe(returnTo: string): Promise<Me> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect(routes.login(returnTo));
  const me = await rpc<Me>("me_get", {}, client);
  if (!me.onboarded) redirect(routes.onboarding(returnTo));
  return me;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/api/me.test.ts`
Expected: 4 passed

- [ ] **Step 6: `AppHeader.tsx` 전체 교체** — 익명이면 로고 + "방 둘러보기" + 검색 슬롯 + 로그인 버튼(§4.14). 로그인 상태면 nav 3개 + 알림 벨 슬롯(Task 4 가 채움) + 프로필 메뉴(내 프로필/로그아웃).

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { signOut } from "@/lib/api/me";
import { useMe } from "@/lib/me";
import { AVATAR_PAL } from "@/lib/palette";
import { routes } from "@/lib/routes";

export type NavKey = "home" | "myStudy" | "schedule";

const NAV: { key: NavKey; label: string; href: string; authOnly: boolean; icon: ReactNode }[] = [
  {
    key: "home",
    label: "방 둘러보기",
    href: routes.home(),
    authOnly: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="9" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" />
      </svg>
    ),
  },
  {
    key: "myStudy",
    label: "내 스터디",
    href: routes.myStudy(),
    authOnly: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3.5h10v9H3z" />
        <path d="M5.5 6.5h5M5.5 9.5h3" />
      </svg>
    ),
  },
  {
    key: "schedule",
    label: "내 일정",
    href: routes.schedule(),
    authOnly: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" />
      </svg>
    ),
  },
];

type Props = {
  active: NavKey;
  /** flat: Main 처럼 전폭 흰 바. card: 나머지 화면처럼 둥근 카드 */
  variant?: "flat" | "card";
  /** nav 와 알림 사이에 끼울 요소 (Main 의 검색창 등) */
  children?: ReactNode;
  /** 알림 벨 (Task 4 의 <NotificationBell/>). 없으면 벨을 그리지 않는다 */
  bell?: ReactNode;
};

export function AppHeader({ active, variant = "card", children, bell }: Props) {
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = async () => {
    setOpen(false);
    await signOut();
    router.push(routes.home());
    router.refresh();
  };

  const round = variant === "flat" ? "rounded-[12px]" : "rounded-full";
  const inner = (
    <>
      <Logo />
      <nav aria-label="주 메뉴" className="flex gap-1 max-sm:order-last max-sm:w-full max-sm:overflow-x-auto">
        {NAV.filter((n) => me || !n.authOnly).map((n) => {
          const on = n.key === active;
          return (
            <Link
              key={n.key}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-[7px] whitespace-nowrap rounded-[12px] px-[14px] py-[9px] text-[14px] ${
                on ? "bg-bg font-semibold text-ink" : "font-medium text-ink-3 hover:text-ink"
              }`}
            >
              {n.icon}
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-[1_1_24px] max-sm:flex-1" />
      {children && <div className="flex min-w-0 max-sm:order-9 max-sm:w-full [&>*]:max-sm:w-full">{children}</div>}
      {me ? (
        <>
          {bell}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={`내 프로필: ${me.nickname ?? me.email}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-bold"
              style={{ background: AVATAR_PAL[me.tone].bg, color: AVATAR_PAL[me.tone].fg }}
            >
              {me.initial}
            </button>
            {open && (
              <div role="menu" className="absolute right-0 top-[52px] z-20 flex w-[180px] flex-col rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.14)]">
                <div className="truncate px-3 py-2 text-[12px] text-muted">{me.email}</div>
                <Link role="menuitem" href={routes.me()} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-ink hover:bg-bg">
                  내 프로필
                </Link>
                <button role="menuitem" type="button" onClick={logout} className="flex h-11 items-center rounded-[10px] px-3 text-left text-[14px] font-medium text-ink hover:bg-bg">
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <Link href={routes.login(pathname)} className={`flex h-11 items-center ${round} bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white`}>
          로그인
        </Link>
      )}
    </>
  );

  if (variant === "flat") {
    return (
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1376px] flex-wrap items-center gap-4 px-8 py-3 max-sm:px-4">{inner}</div>
      </header>
    );
  }
  return (
    <header className="mx-auto mb-4 flex w-full max-w-[1408px] flex-wrap items-center gap-3 rounded-[18px] bg-surface px-4 py-[10px]">
      {inner}
    </header>
  );
}
```

`routes.login(pathname)` 의 `pathname` 은 `/` 처럼 허용 접두사 밖이면 로그인 페이지의 `safeReturnTo` 가 `/` 로 떨어뜨린다 — 헤더에서는 거르지 않는다.

- [ ] **Step 7: 호출부 확인**

`AppHeader` 를 쓰는 4곳(`MainScreen`, `RoomViewScreen`, `MyStudyScreen`, `ScheduleScreen`)은 `unread` prop 을 넘기지 않으므로 수정 없음. `grep -rn "unread=" src/components` 가 비어 있어야 한다.

- [ ] **Step 8: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. `npm run dev` → `/` 에서 비로그인이면 헤더가 로고·방 둘러보기·로그인 버튼만 보인다.

- [ ] **Step 9: Commit**

```bash
git add src/lib/api/me.ts src/lib/api/me.server.ts src/lib/api/me.test.ts src/components/ui/AppHeader.tsx
git commit -m "feat(web): me adapter, requireMe guard, header with anonymous variant and profile menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 4: 알림 — `notifications.ts` + `NotificationBell`(60초 폴링·드롭다운)

**Files:**
- Create: `src/lib/api/notifications.ts`, `src/components/ui/NotificationBell.tsx`
- Modify: `src/components/main/MainScreen.tsx`, `src/components/room-view/RoomViewScreen.tsx`, `src/components/my-study/MyStudyScreen.tsx`, `src/components/schedule/ScheduleScreen.tsx` (각각 `<AppHeader bell={<NotificationBell />}>` 한 줄)
- Test: `src/lib/api/notifications.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `NotificationDto`, `NotificationList`; Task 2 `useMe`; Task 3 `AppHeader.bell`.
- Produces:
  ```ts
  export function fetchUnreadCount(): Promise<number>;
  export function fetchNotifications(cursor?: string | null): Promise<NotificationList>;
  export function markRead(id: string): Promise<void>;
  export function markAllRead(): Promise<number>;
  export function relativeTime(iso: string, now: Date): string;    // 방금 / N분 전 / N시간 전 / 어제 / M월 D일 (KST)
  export function badgeText(n: number): string;                     // 99 초과 → "99+"
  export function NotificationBell(): JSX.Element;                  // useMe() 가 null 이면 null
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/notifications.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { badgeText, relativeTime } from "./notifications";

// now = 2026-10-12 12:00 KST
const NOW = new Date("2026-10-12T03:00:00Z");

describe("relativeTime (cross-cutting §3)", () => {
  it("방금 / N분 전 / N시간 전", () => {
    expect(relativeTime("2026-10-12T02:59:40Z", NOW)).toBe("방금");
    expect(relativeTime("2026-10-12T02:57:00Z", NOW)).toBe("3분 전");
    expect(relativeTime("2026-10-12T01:00:00Z", NOW)).toBe("2시간 전");
  });
  it("어제 is decided by KST calendar date, not by 24h", () => {
    // 2026-10-11 05:00 KST (31h ago) → 어제
    expect(relativeTime("2026-10-10T20:00:00Z", NOW)).toBe("어제");
  });
  it("older → M월 D일 (KST)", () => {
    // 2026-10-03 00:30 KST
    expect(relativeTime("2026-10-02T15:30:00Z", NOW)).toBe("10월 3일");
  });
});

describe("badgeText", () => {
  it("caps at 99+", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/notifications.test.ts`
Expected: FAIL — `Cannot find module './notifications'`

- [ ] **Step 3: `src/lib/api/notifications.ts`**

```ts
import { rpc } from "@/lib/api/errors";
import type { NotificationList } from "@/lib/api/types";
import { addDays } from "@/lib/date";

export const fetchUnreadCount = async () => (await rpc<{ count: number }>("notifications_unread_count")).count;
export const fetchNotifications = (cursor?: string | null) => rpc<NotificationList>("notifications_list", { p_cursor: cursor ?? null, p_limit: 20 });
export const markRead = (id: string) => rpc<null>("notifications_read", { p_id: id }).then(() => undefined);
export const markAllRead = async () => (await rpc<{ updated: number }>("notifications_read_all")).updated;

const KST_MS = 9 * 3600_000;
const kstDate = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);

/** cross-cutting §3 알림 상대시간. 24시간 안은 분·시간, 그 밖은 KST 달력일 기준 어제 / M월 D일 */
export function relativeTime(iso: string, now: Date): string {
  const t = new Date(iso);
  const diff = Math.max(0, now.getTime() - t.getTime());
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  const d = kstDate(t);
  if (d === addDays(kstDate(now), -1)) return "어제";
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/api/notifications.test.ts`
Expected: 5 passed

- [ ] **Step 5: `src/components/ui/NotificationBell.tsx`** — 배지는 `me.unreadCount` 로 시작해 60초마다 `notifications_unread_count` 폴링(D8). 탭이 숨겨지면 멈춘다. 드롭다운은 열 때 `notifications_list` 1페이지. 항목 클릭 → `notifications_read` + `link` 로 이동. "모두 읽음" → `notifications_read_all`.

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { badgeText, fetchNotifications, fetchUnreadCount, markAllRead, markRead, relativeTime } from "@/lib/api/notifications";
import type { NotificationDto } from "@/lib/api/types";
import { useMe } from "@/lib/me";

const POLL_MS = 60_000;

export function NotificationBell() {
  const me = useMe();
  const router = useRouter();
  const [unread, setUnread] = useState(me?.unreadCount ?? 0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    fetchUnreadCount().then(setUnread).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!me) return;
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [me, poll]);

  useEffect(() => {
    if (!open) return;
    setError("");
    fetchNotifications()
      .then((r) => setItems(r.items))
      .catch((e) => setError(toApiError(e).message));
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me) return null;

  const onItem = async (n: NotificationDto) => {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      markRead(n.id).catch(() => undefined);
    }
    router.push(n.link);
  };
  const onReadAll = async () => {
    try {
      await markAllRead();
      setUnread(0);
      setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12.5V8a5 5 0 0 1 10 0v4.5l1 1.5H3z" />
          <path d="M7.5 16a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-[5px] top-[5px] flex h-4 min-w-4 items-center justify-center rounded-lg bg-danger px-1 text-[10px] font-bold text-white">
            {badgeText(unread)}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="알림" className="absolute right-0 top-[52px] z-20 flex w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-[16px] border border-line bg-surface shadow-[0_16px_40px_rgba(27,34,48,.16)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-bold">알림</span>
            <button type="button" onClick={onReadAll} disabled={unread === 0} className="h-9 rounded-[18px] px-3 text-[13px] font-semibold text-mint disabled:text-faint">
              모두 읽음
            </button>
          </div>
          <div className="thin-scroll max-h-[420px] overflow-y-auto border-t border-line-2">
            {error && <p role="alert" className="m-0 px-4 py-3 text-[13px] text-warn">{error}</p>}
            {items === null && !error && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">불러오는 중…</p>}
            {items?.length === 0 && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">아직 알림이 없어요</p>}
            {items?.map((n) => (
              <Link
                key={n.id}
                href={n.link}
                onClick={(e) => {
                  e.preventDefault();
                  onItem(n);
                }}
                className={`flex flex-col gap-[3px] border-b border-line-2 px-4 py-3 text-ink hover:bg-bg ${n.readAt ? "" : "bg-[#F5FBF9]"}`}
              >
                <span className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-mint" aria-label="읽지 않음" />}
                  <span className="truncate text-[14px] font-semibold">{n.title}</span>
                </span>
                {n.body && <span className="clamp-2 text-[13px] text-ink-2">{n.body}</span>}
                <span className="text-[12px] text-muted">
                  {n.room ? `${n.room.title} · ` : ""}
                  {relativeTime(n.createdAt, new Date())}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 4개 화면에서 벨 연결**

각 파일의 `<AppHeader active="…" variant="…">` 를 `<AppHeader active="…" variant="…" bell={<NotificationBell />}>` 로 바꾸고 `import { NotificationBell } from "@/components/ui/NotificationBell";` 를 추가한다. (`MainScreen` 은 children 인 검색창을 그대로 둔다.)

- [ ] **Step 7: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. 철수로 로그인하면 배지 `3`(plan 04 시드 §4 의 미읽음 3건), 벨 클릭 시 드롭다운에 최신순 3건(일정 변경 → 2주차 시작 → EC2 마감 3일 전). 시드 없는 신규 사용자로 로그인하면 "아직 알림이 없어요". 60초 뒤 네트워크에 `notifications_unread_count` 호출이 1회 보인다.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api/notifications.ts src/lib/api/notifications.test.ts src/components/ui/NotificationBell.tsx src/components/main/MainScreen.tsx src/components/room-view/RoomViewScreen.tsx src/components/my-study/MyStudyScreen.tsx src/components/schedule/ScheduleScreen.tsx
git commit -m "feat(web): notification bell with 60s unread polling and dropdown

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---
### Task 5: `/login` — 이메일 OTP (§4.1)

**Files:**
- Create: `src/app/login/page.tsx`, `src/components/auth/AuthShell.tsx`, `src/components/auth/LoginScreen.tsx`, `src/components/auth/OtpInput.tsx`, `src/components/auth/otp.ts`
- Test: `src/components/auth/otp.test.ts`

**Interfaces:**
- Consumes: Task 2 `routes`, `safeReturnTo`; Task 3 `fetchMe`; Phase 0 `createClient`(client·server).
- Produces:
  ```ts
  // src/components/auth/otp.ts (순수)
  export type Digits = [string, string, string, string, string, string];
  export const EMPTY_DIGITS: Digits;
  export function applyDigit(digits: Digits, index: number, raw: string): { digits: Digits; focus: number };
  export function applyPaste(digits: Digits, text: string, from: number): { digits: Digits; focus: number };
  export function applyBackspace(digits: Digits, index: number): { digits: Digits; focus: number };
  export const isComplete: (d: Digits) => boolean;
  export function authErrorMessage(e: unknown): string;      // Supabase AuthApiError.code → 한국어
  // AuthShell({ title, subtitle?, children }) — 가운데 420px 카드, 모바일 390 에서 좌우 16px
  // LoginScreen({ returnTo }) — "use client"
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/components/auth/otp.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_DIGITS, applyBackspace, applyDigit, applyPaste, authErrorMessage, isComplete } from "./otp";

describe("OTP digit model (§4.1 자동 포커스 이동)", () => {
  it("typing a digit fills the box and moves focus right", () => {
    const r = applyDigit(EMPTY_DIGITS, 0, "7");
    expect(r.digits).toEqual(["7", "", "", "", "", ""]);
    expect(r.focus).toBe(1);
  });
  it("keeps only the last digit typed into a box and ignores non-digits", () => {
    expect(applyDigit(EMPTY_DIGITS, 2, "ab3")).toEqual({ digits: ["", "", "3", "", "", ""], focus: 3 });
    expect(applyDigit(EMPTY_DIGITS, 2, "x")).toEqual({ digits: EMPTY_DIGITS, focus: 2 });
  });
  it("last box keeps focus at 5", () => {
    expect(applyDigit(EMPTY_DIGITS, 5, "9").focus).toBe(5);
  });
  it("paste fills from the current box and focuses the last filled box", () => {
    expect(applyPaste(EMPTY_DIGITS, "123456", 0)).toEqual({ digits: ["1", "2", "3", "4", "5", "6"], focus: 5 });
    expect(applyPaste(EMPTY_DIGITS, "12-34", 2)).toEqual({ digits: ["", "", "1", "2", "3", "4"], focus: 5 });
  });
  it("backspace on an empty box clears the previous box and moves left", () => {
    const d: typeof EMPTY_DIGITS = ["1", "2", "", "", "", ""];
    expect(applyBackspace(d, 2)).toEqual({ digits: ["1", "", "", "", "", ""], focus: 1 });
    expect(applyBackspace(d, 1)).toEqual({ digits: ["1", "", "", "", "", ""], focus: 1 });
    expect(applyBackspace(EMPTY_DIGITS, 0).focus).toBe(0);
  });
  it("isComplete", () => {
    expect(isComplete(["1", "2", "3", "4", "5", "6"])).toBe(true);
    expect(isComplete(["1", "2", "3", "4", "5", ""])).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("maps Supabase auth codes", () => {
    expect(authErrorMessage({ name: "AuthApiError", code: "over_email_send_rate_limit", message: "x" })).toBe("잠시 후 다시 시도해 주세요 · 인증 코드는 1분에 한 번만 보낼 수 있어요");
    expect(authErrorMessage({ name: "AuthApiError", code: "otp_expired", message: "x" })).toBe("인증 코드가 만료됐어요 · 다시 받아 주세요");
    expect(authErrorMessage({ name: "AuthApiError", code: "otp_disabled", message: "x" })).toBe("이메일 로그인이 꺼져 있어요 · 관리자에게 문의해 주세요");
  });
  it("falls back to a generic message", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toBe("로그인에 실패했어요 · Failed to fetch");
    expect(authErrorMessage("??")).toBe("로그인에 실패했어요");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/auth/otp.test.ts`
Expected: FAIL — `Cannot find module './otp'`

- [ ] **Step 3: `src/components/auth/otp.ts`**

```ts
export type Digits = [string, string, string, string, string, string];
export const EMPTY_DIGITS: Digits = ["", "", "", "", "", ""];

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function applyDigit(digits: Digits, index: number, raw: string): { digits: Digits; focus: number } {
  const d = onlyDigits(raw);
  if (!d) return { digits, focus: index };
  const next = [...digits] as Digits;
  next[index] = d[d.length - 1];
  return { digits: next, focus: Math.min(5, index + 1) };
}

export function applyPaste(digits: Digits, text: string, from: number): { digits: Digits; focus: number } {
  const d = onlyDigits(text).slice(0, 6 - from);
  if (!d) return { digits, focus: from };
  const next = [...digits] as Digits;
  for (let i = 0; i < d.length; i++) next[from + i] = d[i];
  return { digits: next, focus: Math.min(5, from + d.length - 1) };
}

export function applyBackspace(digits: Digits, index: number): { digits: Digits; focus: number } {
  const next = [...digits] as Digits;
  if (next[index]) {
    next[index] = "";
    return { digits: next, focus: index };
  }
  const prev = Math.max(0, index - 1);
  next[prev] = "";
  return { digits: next, focus: prev };
}

export const isComplete = (d: Digits) => d.every((c) => c.length === 1);

const AUTH_CODE_TEXT: Record<string, string> = {
  over_email_send_rate_limit: "잠시 후 다시 시도해 주세요 · 인증 코드는 1분에 한 번만 보낼 수 있어요",
  over_request_rate_limit: "요청이 너무 많아요 · 잠시 후 다시 시도해 주세요",
  otp_expired: "인증 코드가 만료됐어요 · 다시 받아 주세요",
  otp_disabled: "이메일 로그인이 꺼져 있어요 · 관리자에게 문의해 주세요",
  validation_failed: "이메일 주소를 확인해 주세요",
  email_address_invalid: "이메일 주소를 확인해 주세요",
};

/** supabase-js AuthApiError { code } → 문구. 그 외는 원문을 붙인다(Review Focus 4). */
export function authErrorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const known = AUTH_CODE_TEXT[(e as { code: string }).code];
    if (known) return known;
  }
  if (e instanceof Error) return `로그인에 실패했어요 · ${e.message}`;
  return "로그인에 실패했어요";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/auth/otp.test.ts`
Expected: 8 passed

- [ ] **Step 5: `src/components/auth/AuthShell.tsx`**

```tsx
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

/** 로그인·온보딩·초대 공용 껍데기 — 가운데 420px 카드, 390px 에서 좌우 16px */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-bg-main px-4 pb-16 pt-10 text-ink">
      <Logo />
      <main className="mt-8 flex w-full max-w-[420px] flex-col gap-5 rounded-[20px] border border-line bg-surface p-7 shadow-[0_10px_30px_rgba(27,34,48,.06)] max-sm:p-5">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mb-0 mt-[6px] text-[14px] leading-[1.6] text-muted">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 6: `src/components/auth/OtpInput.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { applyBackspace, applyDigit, applyPaste, type Digits } from "./otp";

type Props = { value: Digits; onChange: (d: Digits) => void; disabled?: boolean };

export function OtpInput({ value, onChange, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = (i: number) => refs.current[i]?.focus();

  useEffect(() => {
    focusAt(0);
  }, []);

  const commit = (r: { digits: Digits; focus: number }) => {
    onChange(r.digits);
    requestAnimationFrame(() => focusAt(r.focus));
  };

  return (
    <div role="group" aria-label="6자리 인증 코드" className="flex justify-between gap-2">
      {value.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${i + 1}번째 자리`}
          maxLength={6}
          value={c}
          disabled={disabled}
          onChange={(e) => commit(applyDigit(value, i, e.target.value))}
          onPaste={(e) => {
            e.preventDefault();
            commit(applyPaste(value, e.clipboardData.getData("text"), i));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              commit(applyBackspace(value, i));
            } else if (e.key === "ArrowLeft") focusAt(Math.max(0, i - 1));
            else if (e.key === "ArrowRight") focusAt(Math.min(5, i + 1));
          }}
          className="h-14 w-full min-w-0 rounded-[12px] border border-line-3 text-center text-[22px] font-bold text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE] disabled:bg-surface-3"
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: `src/components/auth/LoginScreen.tsx`** — 단계 `email` → `otp`. `signInWithOtp({ email, options: { shouldCreateUser: true } })`, `verifyOtp({ email, token, type: "email" })`. 성공 시 `me_get().onboarded` 로 분기. 재전송 60초 타이머.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { fetchMe } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { OtpInput } from "./OtpInput";
import { EMPTY_DIGITS, authErrorMessage, isComplete, type Digits } from "./otp";

const RESEND_SEC = 60;
const field = "h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]";
const primary = "flex h-12 w-full items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted";

export function LoginScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<Digits>(EMPTY_DIGITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const send = async () => {
    setBusy(true);
    setError("");
    const { error: e } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) return setError(authErrorMessage(e));
    setDigits(EMPTY_DIGITS);
    setLeft(RESEND_SEC);
    setStep("otp");
  };

  const onEmail = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("이메일 주소를 확인해 주세요");
    void send();
  };

  const verify = async (d: Digits) => {
    setBusy(true);
    setError("");
    const { error: e } = await createClient().auth.verifyOtp({ email: email.trim(), token: d.join(""), type: "email" });
    if (e) {
      setBusy(false);
      setDigits(EMPTY_DIGITS);
      return setError(authErrorMessage(e));
    }
    try {
      const me = await fetchMe();
      const dest = me.onboarded ? safeReturnTo(returnTo) : routes.onboarding(safeReturnTo(returnTo));
      router.replace(dest);
      router.refresh();
    } catch (e2) {
      setBusy(false);
      setError(authErrorMessage(e2));
    }
  };

  const onDigits = (d: Digits) => {
    setDigits(d);
    if (isComplete(d) && !busy) void verify(d);
  };

  if (step === "email") {
    return (
      <AuthShell title="로그인" subtitle="이메일로 6자리 인증 코드를 보내 드려요. 비밀번호는 없어요.">
        <form onSubmit={onEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
            이메일
            <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={field} />
          </label>
          {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
          <button type="submit" disabled={busy} className={primary}>
            {busy ? "보내는 중…" : "인증 코드 받기"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="인증 코드 입력" subtitle={`${email.trim()} 로 보낸 6자리 코드를 입력해 주세요. 코드는 10분 동안 유효해요.`}>
      <OtpInput value={digits} onChange={onDigits} disabled={busy} />
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex items-center justify-between text-[13px]">
        <button type="button" onClick={() => { setStep("email"); setError(""); }} className="h-11 text-muted">
          이메일 바꾸기
        </button>
        <button type="button" onClick={send} disabled={busy || left > 0} className="h-11 font-semibold text-mint disabled:text-faint">
          {left > 0 ? `재전송 (${left}초)` : "코드 재전송"}
        </button>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 8: `src/app/login/page.tsx`** — 이미 로그인이면 바로 복귀. Next 16 의 `searchParams` 는 Promise.

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(returnTo);
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (user) redirect(dest);
  return <LoginScreen returnTo={dest} />;
}
```

- [ ] **Step 9: 수동 확인 (로컬 supabase)**

Run: `npm run dev` → http://localhost:3000/login?returnTo=/rooms/aws
1. 이메일 `cheolsu@sgtudy.local` 입력 → "인증 코드 받기" → OTP 화면, "재전송 (60초)" 카운트다운.
2. http://127.0.0.1:54324 (Inbucket) 에서 `cheolsu` 메일함 → 6자리 코드 → 입력하면 자동 제출 → `/rooms/aws` 로 복귀, 헤더에 "철" 아바타.
3. `?returnTo=https://evil.com` 으로 로그인하면 `/` 로 떨어진다.
4. `npm run lint && npx tsc --noEmit && npx vitest run` 통과.

- [ ] **Step 10: Commit**

```bash
git add src/app/login src/components/auth
git commit -m "feat(web): email OTP login screen with 6-digit input and resend timer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 6: `/onboarding`(닉네임) + `/me`(프로필) + `useDebounced`

**Files:**
- Create: `src/lib/useDebounced.ts` (파일 구조 표에는 Task 9 로 적혀 있으나 온보딩이 먼저 쓰므로 여기서 만든다), `src/components/auth/nickname.ts`, `src/components/auth/NicknameField.tsx`, `src/components/auth/OnboardingScreen.tsx`, `src/app/onboarding/page.tsx`, `src/components/auth/ProfileScreen.tsx`, `src/app/me/page.tsx`
- Test: `src/components/auth/nickname.test.ts`

**Interfaces:**
- Consumes: Task 3 `checkNickname`, `updateMe`, `nicknameProblem`, `NICK_PROBLEM_TEXT`, `requireMe`, `signOut`; Task 2 `useMe`, `routes`, `safeReturnTo`; Task 5 `AuthShell`.
- Produces:
  ```ts
  export function useDebounced<T>(value: T, ms: number): T;
  // nickname.ts (순수)
  export type NickHint = { tone: "idle" | "checking" | "ok" | "bad"; text: string };
  export function nicknameHint(value: string, result: NicknameCheck | null, checking: boolean, original?: string): NickHint;
  // NicknameField({ value, onChange, original?, onValid }) — 300ms 디바운스 후 nickname_check
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/components/auth/nickname.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { nicknameHint } from "./nickname";

describe("nicknameHint", () => {
  it("empty → idle rule text", () => {
    expect(nicknameHint("", null, false)).toEqual({ tone: "idle", text: "2~16자 · 한글·영문·숫자·_·." });
  });
  it("client rule violation wins before any server result", () => {
    expect(nicknameHint("a", null, false)).toEqual({ tone: "bad", text: "2~16자로 입력해 주세요" });
    expect(nicknameHint("chul-soo", { available: true }, false)).toEqual({ tone: "bad", text: "한글·영문·숫자·_·. 만 쓸 수 있어요" });
  });
  it("unchanged nickname on /me is fine without a check", () => {
    expect(nicknameHint("철수", null, false, "철수")).toEqual({ tone: "ok", text: "지금 쓰는 닉네임이에요" });
  });
  it("checking / server results", () => {
    expect(nicknameHint("영희", null, true)).toEqual({ tone: "checking", text: "확인 중…" });
    expect(nicknameHint("영희", { available: true }, false)).toEqual({ tone: "ok", text: "사용할 수 있어요" });
    expect(nicknameHint("철수", { available: false, reason: "taken" }, false)).toEqual({ tone: "bad", text: "이미 사용 중인 닉네임이에요" });
    expect(nicknameHint("관리자", { available: false, reason: "reserved" }, false)).toEqual({ tone: "bad", text: "사용할 수 없는 닉네임이에요" });
    expect(nicknameHint("영희", { available: false, reason: "invalid" }, false)).toEqual({ tone: "bad", text: "2~16자 · 한글·영문·숫자·_·." });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/auth/nickname.test.ts`
Expected: FAIL — `Cannot find module './nickname'`

- [ ] **Step 3: `src/components/auth/nickname.ts` + `src/lib/useDebounced.ts`**

```ts
// src/components/auth/nickname.ts
import { NICK_PROBLEM_TEXT, nicknameProblem } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";

export type NickHint = { tone: "idle" | "checking" | "ok" | "bad"; text: string };
export const NICK_RULE = "2~16자 · 한글·영문·숫자·_·.";

export function nicknameHint(value: string, result: NicknameCheck | null, checking: boolean, original?: string): NickHint {
  const v = value.trim();
  if (!v) return { tone: "idle", text: NICK_RULE };
  const problem = nicknameProblem(v);
  if (problem) return { tone: "bad", text: NICK_PROBLEM_TEXT[problem] };
  if (original !== undefined && v === original) return { tone: "ok", text: "지금 쓰는 닉네임이에요" };
  if (checking || !result) return { tone: "checking", text: "확인 중…" };
  if (result.available) return { tone: "ok", text: "사용할 수 있어요" };
  if (result.reason === "taken") return { tone: "bad", text: "이미 사용 중인 닉네임이에요" };
  if (result.reason === "reserved") return { tone: "bad", text: "사용할 수 없는 닉네임이에요" };
  return { tone: "bad", text: NICK_RULE };
}
```

```ts
// src/lib/useDebounced.ts
"use client";

import { useEffect, useState } from "react";

/** value 가 ms 동안 안 바뀌면 그때 값을 돌려준다 (검색 250ms, 닉네임 300ms). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/auth/nickname.test.ts`
Expected: 5 passed

- [ ] **Step 5: `src/components/auth/NicknameField.tsx`** — 300ms 디바운스 → `nickname_check`. 응답 순서 꼬임은 seq 로 막는다.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { checkNickname } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";
import { useDebounced } from "@/lib/useDebounced";
import { nicknameHint, type NickHint } from "./nickname";

type Props = { value: string; onChange: (v: string) => void; original?: string; onHint: (h: NickHint) => void; autoFocus?: boolean };

const HINT_COLOR: Record<NickHint["tone"], string> = { idle: "#7A8594", checking: "#7A8594", ok: "#0D7A64", bad: "#B4462B" };

export function NicknameField({ value, onChange, original, onHint, autoFocus }: Props) {
  const debounced = useDebounced(value.trim(), 300);
  const [result, setResult] = useState<NicknameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setResult(null);
    const h = nicknameHint(debounced, null, false, original);
    if (h.tone !== "checking") return;
    const my = ++seq.current;
    setChecking(true);
    checkNickname(debounced)
      .then((r) => my === seq.current && setResult(r))
      .catch((e) => my === seq.current && setResult({ available: false, reason: toApiError(e).code === "NICKNAME_RESERVED" ? "reserved" : "invalid" }))
      .finally(() => my === seq.current && setChecking(false));
  }, [debounced, original]);

  const hint = nicknameHint(value, debounced === value.trim() ? result : null, checking || debounced !== value.trim(), original);
  useEffect(() => onHint(hint), [hint.tone, hint.text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      닉네임
      <input
        type="text"
        autoFocus={autoFocus}
        autoComplete="nickname"
        maxLength={16}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={hint.tone === "bad"}
        aria-describedby="nick-hint"
        className="h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] font-medium text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]"
      />
      <span id="nick-hint" role="status" className="text-[12px] font-medium" style={{ color: HINT_COLOR[hint.tone] }}>
        {hint.text}
      </span>
    </label>
  );
}
```

- [ ] **Step 6: `src/components/auth/OnboardingScreen.tsx` + `src/app/onboarding/page.tsx`**

```tsx
// src/components/auth/OnboardingScreen.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toApiError } from "@/lib/api/errors";
import { updateMe } from "@/lib/api/me";
import { AuthShell } from "./AuthShell";
import { NicknameField } from "./NicknameField";
import type { NickHint } from "./nickname";

export function OnboardingScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [hint, setHint] = useState<NickHint>({ tone: "idle", text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (hint.tone !== "ok") return;
    setBusy(true);
    setError("");
    try {
      await updateMe({ nickname: nick.trim() });
      router.replace(returnTo);
      router.refresh();
    } catch (err) {
      setBusy(false);
      setError(toApiError(err).message);
    }
  };

  return (
    <AuthShell title="닉네임을 정해 주세요" subtitle="스터디에서 이 이름으로 보여요. 나중에 내 프로필에서 바꿀 수 있어요.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <NicknameField value={nick} onChange={setNick} onHint={setHint} autoFocus />
        {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
        <button type="submit" disabled={busy || hint.tone !== "ok"} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
          {busy ? "저장 중…" : "시작하기"}
        </button>
      </form>
    </AuthShell>
  );
}
```

```tsx
// src/app/onboarding/page.tsx — /onboarding 은 proxy 보호 목록 밖이라 여기서 직접 가드한다
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/auth/OnboardingScreen";
import { rpc } from "@/lib/api/errors";
import type { Me } from "@/lib/api/types";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 닉네임 설정" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(returnTo);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect(routes.login(dest));
  const me = await rpc<Me>("me_get", {}, client);
  if (me.onboarded) redirect(dest);
  return <OnboardingScreen returnTo={dest} />;
}
```

- [ ] **Step 7: `src/components/auth/ProfileScreen.tsx` + `src/app/me/page.tsx`** (§4.13: 닉네임 변경, 이메일 읽기 전용, 옵션 메일 토글, 기본 알림 안내)

```tsx
// src/components/auth/ProfileScreen.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { toApiError } from "@/lib/api/errors";
import { updateMe } from "@/lib/api/me";
import type { Me } from "@/lib/api/types";
import { AVATAR_PAL } from "@/lib/palette";
import { NicknameField } from "./NicknameField";
import type { NickHint } from "./nickname";

export function ProfileScreen({ me }: { me: Me }) {
  const router = useRouter();
  const original = me.nickname ?? "";
  const [nick, setNick] = useState(original);
  const [hint, setHint] = useState<NickHint>({ tone: "ok", text: "" });
  const [mail, setMail] = useState(me.optionalMailEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (hint.tone !== "ok" || nick.trim() === original) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateMe({ nickname: nick.trim() });
      setMsg({ tone: "ok", text: "닉네임을 바꿨어요" });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "bad", text: toApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleMail = async () => {
    const next = !mail;
    setMail(next);
    try {
      await updateMe({ optionalMailEnabled: next });
    } catch (err) {
      setMail(!next);
      setMsg({ tone: "bad", text: toApiError(err).message });
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-5 rounded-[20px] bg-surface p-7 max-sm:p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full text-[24px] font-bold" style={{ background: AVATAR_PAL[me.tone].bg, color: AVATAR_PAL[me.tone].fg }}>
            {me.initial}
          </span>
          <div>
            <h1 className="m-0 text-[22px] font-bold">내 프로필</h1>
            <p className="mb-0 mt-1 text-[13px] text-muted">아바타는 닉네임 첫 글자예요</p>
          </div>
        </div>

        <form onSubmit={save} className="flex flex-col gap-4">
          <NicknameField value={nick} onChange={setNick} original={original} onHint={setHint} />
          <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
            이메일
            <input type="email" value={me.email} readOnly aria-readonly className="h-12 w-full rounded-[12px] border border-line bg-surface-3 px-4 text-[15px] text-muted" />
            <span className="text-[12px] font-medium text-muted">로그인에 쓰는 주소라 바꿀 수 없어요</span>
          </label>
          {msg && <p role={msg.tone === "bad" ? "alert" : "status"} className="m-0 text-[13px]" style={{ color: msg.tone === "ok" ? "#0D7A64" : "#B4462B" }}>{msg.text}</p>}
          <button type="submit" disabled={busy || hint.tone !== "ok" || nick.trim() === original} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
            닉네임 저장
          </button>
        </form>

        <section aria-label="알림 메일" className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-semibold">옵션 알림 메일 받기</span>
              <span className="block text-[12px] text-muted">마감 리마인더·일정 변경 같은 선택 알림을 메일로도 받아요</span>
            </span>
            <button type="button" role="switch" aria-checked={mail} onClick={toggleMail} className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: mail ? "#12A386" : "#C9D1D6" }}>
              <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-[left]" style={{ left: mail ? 23 : 3 }} />
            </button>
          </label>
          <p className="m-0 text-[12px] text-muted">기본 알림(참가 승인·회차 시작·전원 제출)은 항상 발송돼요.</p>
        </section>
      </main>
    </div>
  );
}
```

```tsx
// src/app/me/page.tsx
import type { Metadata } from "next";
import { ProfileScreen } from "@/components/auth/ProfileScreen";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 내 프로필" };

export default async function MePage() {
  const me = await requireMe(routes.me());
  return <ProfileScreen me={me} />;
}
```

`requireMe(routes.me())` 의 returnTo `/me` 는 허용 접두사가 아니라 `/` 로 떨어진다 — 의도된 동작(D6).

- [ ] **Step 8: 수동 확인**

1. Inbucket 에 없는 새 이메일(예: `new1@sgtudy.local`)로 로그인 → `/onboarding`. "a" 입력 → 빨간 "2~16자로 입력해 주세요". "철수" → 300ms 뒤 "이미 사용 중인 닉네임이에요". "새사람" → "사용할 수 있어요" → 시작하기 → `/`.
2. `/me` 에서 토글 → 네트워크에 `me_update` 1회. 닉네임 그대로면 저장 버튼 비활성.
3. `npm run lint && npx tsc --noEmit && npx vitest run` 통과.

- [ ] **Step 9: Commit**

```bash
git add src/lib/useDebounced.ts src/components/auth src/app/onboarding src/app/me
git commit -m "feat(web): onboarding nickname screen and profile page with debounced nickname check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 7: `/invite/[token]` — 초대 미리보기·참가 (§4.12)

**Files:**
- Create: `src/lib/api/invite.ts`, `src/components/auth/InviteScreen.tsx`, `src/app/invite/[token]/page.tsx`
- Test: `src/lib/api/invite.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `InvitePreview`, `MembershipResult`, `ApiException`; Task 2 `useMe`, `routes`; Task 5 `AuthShell`; Task 8 `periodLong`(`format.ts` — 기간 표기는 이 함수 하나만 쓴다. 별도 `periodOf` 는 두지 않는다). **실행 순서: Task 8 Step 3 의 `ymd`·`periodLong` 이 먼저 있어야 한다**(아래 Step 5 끝 주의 참조).
- Produces:
  ```ts
  export type InviteAction = "login" | "owner" | "joined" | "pending" | "ended" | "activeClosed" | "full" | "apply" | "join";
  export function inviteActionOf(p: InvitePreview): InviteAction;          // 03-api §3 CTA 결정 순서
  export function fetchInvitePreview(token: string, client?: Db): Promise<InvitePreview>;
  export function joinByInvite(token: string): Promise<MembershipResult>;
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/invite.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { InvitePreview } from "./types";
import { inviteActionOf } from "./invite";

const base: InvitePreview = {
  today: "2026-10-12",
  room: { slug: "cs", title: "CS 면접", intro: "", startDate: "2026-10-19", endDate: "2026-11-30", memberCount: 3, maxMembers: 6, status: "recruit", isPublic: true, joinMode: "direct", tags: [] },
  leader: { userId: "u-yerin", nickname: "예린", tone: "amber" },
  me: { state: "none" },
};
const w = (p: Partial<InvitePreview["room"]>, me: InvitePreview["me"] = { state: "none" }): InvitePreview => ({ ...base, room: { ...base.room, ...p }, me });

describe("inviteActionOf (03-api §3 순서)", () => {
  it("anonymous → login", () => expect(inviteActionOf(w({}, null))).toBe("login"));
  it("leader → owner", () => expect(inviteActionOf(w({}, { state: "leader" }))).toBe("owner"));
  it("active member on recruit room → joined (초대 화면엔 취소 없음)", () => expect(inviteActionOf(w({}, { state: "active" }))).toBe("joined"));
  it("pending → pending", () => expect(inviteActionOf(w({ joinMode: "approval" }, { state: "pending" }))).toBe("pending"));
  it("ended / active / full", () => {
    expect(inviteActionOf(w({ status: "ended" }))).toBe("ended");
    expect(inviteActionOf(w({ status: "active" }))).toBe("activeClosed");
    expect(inviteActionOf(w({ memberCount: 6 }))).toBe("full");
  });
  it("approval → apply, direct → join", () => {
    expect(inviteActionOf(w({ joinMode: "approval" }))).toBe("apply");
    expect(inviteActionOf(w({}))).toBe("join");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/invite.test.ts`
Expected: FAIL — `Cannot find module './invite'`

- [ ] **Step 3: `src/lib/api/invite.ts`**

```ts
import { rpc, type Db } from "@/lib/api/errors";
import type { InvitePreview, MembershipResult } from "@/lib/api/types";

export type InviteAction = "login" | "owner" | "joined" | "pending" | "ended" | "activeClosed" | "full" | "apply" | "join";

export const fetchInvitePreview = (token: string, client?: Db) => rpc<InvitePreview>("invite_preview", { p_token: token }, client);
export const joinByInvite = (token: string) => rpc<MembershipResult>("invite_join", { p_token: token });

/** 03-api §3 CTA 결정 순서. 초대 화면은 '참가 취소' 를 제공하지 않으므로 active 멤버는 모두 joined. */
export function inviteActionOf(p: InvitePreview): InviteAction {
  const r = p.room;
  if (!p.me) return "login";
  if (p.me.state === "leader") return "owner";
  if (p.me.state === "active") return "joined";
  if (p.me.state === "pending") return "pending";
  if (r.status === "ended") return "ended";
  if (r.status === "active") return "activeClosed";
  if (r.memberCount >= r.maxMembers) return "full";
  return r.joinMode === "approval" ? "apply" : "join";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/api/invite.test.ts`
Expected: 6 passed

- [ ] **Step 5: `src/components/auth/InviteScreen.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { toApiError } from "@/lib/api/errors";
import { inviteActionOf, joinByInvite, type InviteAction } from "@/lib/api/invite";
import type { InvitePreview } from "@/lib/api/types";
import { periodLong } from "@/lib/api/format";
import { PAL } from "@/lib/palette";
import { routes } from "@/lib/routes";
import { AuthShell } from "./AuthShell";

const primary = "flex h-12 w-full items-center justify-center rounded-[24px] text-[15px] font-semibold text-white hover:text-white";

export function InviteScreen({ token, preview }: { token: string; preview: InvitePreview }) {
  const router = useRouter();
  const [p, setP] = useState(preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act: InviteAction = inviteActionOf(p);
  const r = p.room;

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await joinByInvite(token);
      setP((prev) => ({ ...prev, me: res.me, room: { ...prev.room, memberCount: res.memberCount } }));
      router.refresh();
      if (res.me?.state === "active") router.push(routes.myStudy(r.slug));
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "AUTH_REQUIRED") return router.push(routes.login(routes.invite(token)));
      if (err.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.invite(token)));
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cta = () => {
    switch (act) {
      case "login":
        return <Link href={routes.login(routes.invite(token))} className={`${primary} bg-navy`}>로그인하고 참가</Link>;
      case "owner":
        return <Link href={routes.myStudy(r.slug)} className={`${primary} bg-navy`}>내가 만든 방 · 관리하기</Link>;
      case "joined":
        return <Link href={routes.myStudy(r.slug)} className={`${primary} bg-mint`}>참가중 · 내 스터디에서 보기</Link>;
      case "pending":
        return (
          <>
            <div className="flex h-12 items-center justify-center rounded-[24px] bg-amber-soft text-[15px] font-semibold text-amber-text">승인 대기중</div>
            <Link href={routes.room(r.slug)} className="text-center text-[13px] font-semibold text-mint">방 둘러보기</Link>
          </>
        );
      case "join":
      case "apply":
        return (
          <button type="button" onClick={go} disabled={busy} className={`${primary} bg-navy disabled:bg-slate-soft disabled:text-muted`}>
            {busy ? "처리 중…" : act === "join" ? "참가하기" : "참가 신청"}
          </button>
        );
      default: {
        const text = act === "full" ? "정원 마감" : act === "ended" ? "종료된 스터디예요" : "이미 진행 중인 스터디예요";
        return <button type="button" disabled className="h-12 rounded-[24px] bg-slate-soft text-[15px] font-semibold text-muted">{text}</button>;
      }
    }
  };

  return (
    <AuthShell title="스터디 초대" subtitle={`${p.leader.nickname} 님이 초대했어요`}>
      <div className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
        <div className="text-[18px] font-bold leading-[1.35]">{r.title}</div>
        {r.intro && <p className="m-0 text-[14px] leading-[1.6] text-ink-2">{r.intro}</p>}
        <dl className="m-0 grid grid-cols-[72px_minmax(0,1fr)] gap-y-2 text-[13px]">
          <dt className="text-muted">기간</dt>
          <dd className="m-0 font-medium">{periodLong(r.startDate, r.endDate)}</dd>
          <dt className="text-muted">인원</dt>
          <dd className="m-0 font-medium">{r.memberCount} / {r.maxMembers}명 · {r.joinMode === "approval" ? "승인제" : "바로 참가"}{r.isPublic ? "" : " · 비공개"}</dd>
          <dt className="text-muted">그룹장</dt>
          <dd className="m-0 flex items-center gap-2 font-medium"><Avatar name={p.leader.nickname} tone={p.leader.tone} size={22} />{p.leader.nickname}</dd>
        </dl>
        {r.tags.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {r.tags.map((t) => (
              <span key={t.slug} className="inline-flex h-6 items-center rounded-[12px] px-[9px] text-[12px] font-semibold" style={{ background: PAL[t.tone].bg, color: PAL[t.tone].fg }}>{t.label}</span>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex flex-col gap-2">{cta()}</div>
    </AuthShell>
  );
}
```

`periodLong` 은 Task 8 에서 만든다. Task 7 을 Task 8 보다 먼저 실행한다면 Task 8 Step 3 의 `format.ts` 중 `ymd`·`periodLong` 두 함수만 먼저 만들어 두고(파일 전체는 Task 8 에서 완성) 진행한다.

- [ ] **Step 6: `src/app/invite/[token]/page.tsx`** — 토큰 무효는 404 가 아니라 안내 화면.

```tsx
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { InviteScreen } from "@/components/auth/InviteScreen";
import { toApiError } from "@/lib/api/errors";
import { fetchInvitePreview } from "@/lib/api/invite";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata: Metadata = { title: "슥터디 초대" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const preview = await fetchInvitePreview(token, await createClient());
    return <InviteScreen token={token} preview={preview} />;
  } catch (e) {
    const err = toApiError(e);
    const text = err.code === "INVITE_REVOKED" ? "더 이상 쓸 수 없는 초대 링크예요" : err.code === "INVITE_NOT_FOUND" ? "유효하지 않은 초대 링크예요" : err.message;
    return (
      <AuthShell title="초대 링크를 열 수 없어요" subtitle={text}>
        <Link href={routes.home()} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white hover:text-white">방 둘러보기</Link>
      </AuthShell>
    );
  }
}
```

- [ ] **Step 7: 수동 확인**

1. 비로그인으로 http://localhost:3000/invite/seed-cs → 미리보기 + "로그인하고 참가" → 로그인 뒤 `/invite/seed-cs` 로 복귀 → "참가하기" → `/my-study/cs`.
2. `/invite/nope` → "유효하지 않은 초대 링크예요".
3. `npm run lint && npx tsc --noEmit && npx vitest run` 통과.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api/invite.ts src/lib/api/invite.test.ts src/components/auth/InviteScreen.tsx src/app/invite
git commit -m "feat(web): invite preview and join screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---
### Task 8: `format.ts` — 화면 공용 문구 조립 (기간·D-day·회차 창·현재 회차·glance)

RoomView(Task 11)·MyStudy(Task 12)·Main(Task 9)·Invite(Task 7) 가 같은 문구를 쓰므로 한 곳에 둔다. 서버는 숫자·날짜만 주고(D13) 여기서 문자열을 만든다. Review Focus 1·2 의 테스트가 이 태스크에 있다.

**Files:**
- Create: `src/lib/api/format.ts`
- Test: `src/lib/api/format.test.ts`

**Interfaces:**
- Consumes: `src/lib/date.ts` (`addDays`, `dday`, `diffDays`, `WEEKDAY_KO`, `weekdayKo`); Task 1 `RoundSummary`, `LeafSummary`, `RoomDetail`, `RoomStatusDto`.
- Produces:
  ```ts
  export const ymd: (iso: string) => string;                       // "2026.10.01"
  export const mmdd: (iso: string) => string;                      // "10.01" (월 두 자리 — 카드·회차 표기)
  export const uiStatus: (s: RoomStatusDto) => RoomStatus;          // draft → recruit
  export function periodWeeks(start: string, end: string): number; // round((일수+1)/7) — "N주"·"N주 완주" 의 N (D14)
  export function periodCard(start: string, end: string): string;  // "2026.11.02 – 12.27 · 8주"
  export function periodLong(start: string, end: string): string;  // "2026.10.01(목) – 12.31(목)"
  export function ddayOf(status: RoomStatusDto, today: string, start: string, end: string): { short: string; long: string };
  export function curIndexOf(rounds: RoundSummary[], today: string): { index: number; inside: boolean } | null;
  export function roundsWindow(rounds: RoundSummary[], status: RoomStatusDto, today: string): { rows: RoundSummary[]; more: string; lo: number };
  export type RoundRowView = { label: string; title: string; dates: string; state: string; sub?: number; total?: number; current?: boolean };
  export function roundRow(r: RoundSummary, status: RoomStatusDto, today: string, current: boolean): RoundRowView;
  export type CurPersonView = { userId: string; name: string; tone: Tone; status: TaskStatus };
  export type CurTaskView = { title: string; type: "공통" | "지정"; dates: string; people: CurPersonView[] };
  export type CurView = { pill: string; title: string; meta: string; tasks: CurTaskView[] };
  export function curOf(dto: CurInput, today: string): CurView;
  export function glanceOf(stats: RoomDetail["stats"], status: RoomStatusDto): { rounds: string; tasks: string };
  export const rulesOf: (md: string) => string[];                   // "- a\n- b" → ["a","b"]
  export const TASK_TYPE_KO: Record<TaskTypeDto, "공통" | "지정">;
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/format.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import { curIndexOf, curOf, ddayOf, glanceOf, periodCard, periodLong, periodWeeks, roundRow, roundsWindow, rulesOf } from "./format";
import type { RoomDetail, RoundSummary } from "./types";

const TODAY = "2026-10-12";

/** 주 단위 회차 n개 — label "1주차"… */
const weekly = (n: number, start: string, titles: string[] = []): RoundSummary[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    label: `${i + 1}주차`,
    title: titles[i] ?? `R${i + 1}`,
    startDate: addDays(start, i * 7),
    endDate: addDays(start, i * 7 + 6),
    leafCount: 2,
    assigned: 0,
    submitted: 0,
    pct: null,
  }));

describe("periodCard (main §3-5, D14 round(days/7)주)", () => {
  it("same year: toeic 56일 → 8주", () => expect(periodCard("2026-11-02", "2026-12-27")).toBe("2026.11.02 – 12.27 · 8주"));
  it("cross year keeps both years (Review Focus 1): spring 119일 → 17주", () =>
    expect(periodCard("2026-10-05", "2027-01-31")).toBe("2026.10.05 – 2027.01.31 · 17주"));
  it("aws 92일 → 13주 (목업 '3개월' 폐기)", () => expect(periodCard("2026-10-01", "2026-12-31")).toBe("2026.10.01 – 12.31 · 13주"));
  it("algo 07.01 pads the month", () => expect(periodCard("2026-07-01", "2026-09-30")).toBe("2026.07.01 – 09.30 · 13주"));
});

describe("periodLong", () => {
  it("aws", () => expect(periodLong("2026-10-01", "2026-12-31")).toBe("2026.10.01(목) – 12.31(목)"));
  it("spring cross-year", () => expect(periodLong("2026-10-05", "2027-01-31")).toBe("2026.10.05(월) – 2027.01.31(일)"));
});

describe("ddayOf (roomview §3.2)", () => {
  it("recruit → start, active → end, ended → mmdd", () => {
    expect(ddayOf("recruit", TODAY, "2026-11-02", "2026-12-27")).toEqual({ short: "D-21", long: "시작까지 D-21" });
    expect(ddayOf("active", TODAY, "2026-10-01", "2026-12-31")).toEqual({ short: "D-80", long: "종료까지 D-80" });
    expect(ddayOf("ended", TODAY, "2026-07-01", "2026-09-30")).toEqual({ short: "종료", long: "09.30 종료" });
    expect(ddayOf("draft", TODAY, "2026-11-09", "2026-12-20").short).toBe("D-28");
  });
});

describe("curIndexOf / roundsWindow (roomview §3.6)", () => {
  it("aws: 13 rounds from 10-01, today in 2주차 → rows 1·2·3, 이후 10개", () => {
    const r = weekly(13, "2026-10-01");
    expect(curIndexOf(r, TODAY)).toEqual({ index: 1, inside: true });
    const w = roundsWindow(r, "active", TODAY);
    expect(w.rows.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(w.more).toBe("이후 10개 회차가 더 있어요");
  });
  it("react: 8 rounds from 09-21, today in 4주차 → 3·4·5 + prefix", () => {
    const w = roundsWindow(weekly(8, "2026-09-21"), "active", TODAY);
    expect(w.rows.map((x) => x.label)).toEqual(["3주차", "4주차", "5주차"]);
    expect(w.more).toBe("1~2주차 완료 · 이후 3개 회차가 더 있어요");
  });
  it("recruit shows first 3: toeic 8 → 이후 5개, sqld 4 → 이후 1개, jcg 2 → ''", () => {
    expect(roundsWindow(weekly(8, "2026-11-02"), "recruit", TODAY).more).toBe("이후 5개 회차가 더 있어요");
    expect(roundsWindow(weekly(4, "2026-10-26"), "recruit", TODAY).more).toBe("이후 1개 회차가 더 있어요");
    const jcg = roundsWindow(weekly(2, "2026-10-19"), "recruit", TODAY);
    expect(jcg.rows).toHaveLength(2);
    expect(jcg.more).toBe("");
  });
  it("ended shows all rounds", () => {
    const w = roundsWindow(weekly(13, "2026-07-01"), "ended", TODAY);
    expect(w.rows).toHaveLength(13);
    expect(w.more).toBe("");
  });
  it("gap between rounds (Review Focus 2): anchors on the last started round", () => {
    const gap: RoundSummary[] = [
      { ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" },
      { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" },
      { ...weekly(1, "2026-10-22")[0], id: "3", label: "3주차" },
    ];
    expect(curIndexOf(gap, TODAY)).toEqual({ index: 0, inside: false });
    expect(roundsWindow(gap, "active", TODAY).rows.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(curIndexOf(weekly(3, "2026-11-02"), TODAY)).toBeNull();
  });
});

describe("roundRow", () => {
  const r = weekly(1, "2026-10-01")[0];
  it("recruit → '과제 N개' without numbers", () => {
    expect(roundRow(r, "recruit", TODAY, false)).toEqual({ label: "1주차", title: "R1", dates: "10.01 – 10.07", state: "과제 2개" });
  });
  it("active states by date and pct", () => {
    expect(roundRow({ ...r, assigned: 8, submitted: 5, pct: 63 }, "active", TODAY, false).state).toBe("기간 종료");
    expect(roundRow({ ...r, assigned: 8, submitted: 8, pct: 100 }, "active", TODAY, false).state).toBe("완료");
    expect(roundRow({ ...r, startDate: "2026-10-08", endDate: "2026-10-14" }, "active", TODAY, true)).toMatchObject({ state: "진행중", current: true, dates: "10.08 – 10.14" });
    expect(roundRow({ ...r, startDate: "2026-10-15", endDate: "2026-10-21" }, "active", TODAY, false).state).toBe("예정");
  });
  it("ended → 완료 with numbers", () => {
    expect(roundRow({ ...r, assigned: 24, submitted: 23 }, "ended", TODAY, false)).toMatchObject({ state: "완료", sub: 23, total: 24 });
  });
});

const stats = (o: Partial<RoomDetail["stats"]>): RoomDetail["stats"] => ({
  roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [1], ...o,
});

describe("curOf (roomview §1.3 / mystudy §3.8)", () => {
  it("recruit toeic", () => {
    expect(curOf({ status: "recruit", startDate: "2026-11-02", endDate: "2026-12-27", currentRound: null, rounds: weekly(8, "2026-11-02"), stats: stats({}) }, TODAY)).toEqual({
      pill: "시작 전", title: "11월 2일(월) 첫 회차가 열려요", meta: "8회차 · 과제 16개 준비됨", tasks: [],
    });
  });
  it("active aws with current round and tasks", () => {
    const cur: RoundSummary = {
      ...weekly(13, "2026-10-01", ["IAM·VPC", "EC2·S3"])[1],
      assigned: 3, submitted: 1, pct: 33,
      tasks: [
        { id: "21", title: "EC2 인스턴스 유형 정리", type: "designated", startDate: "2026-10-08", endDate: "2026-10-14",
          people: [{ userId: "u-jieun", nickname: "지은", tone: "peach", status: "done" }, { userId: "u-1", nickname: "철수", tone: "blue", status: "open" }] },
        { id: "22", title: "S3 스토리지 클래스 발표자료", type: "designated", startDate: "2026-10-10", endDate: "2026-10-14",
          people: [{ userId: "u-hana", nickname: "하나", tone: "lav", status: "open" }] },
      ],
    };
    const v = curOf({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: cur, rounds: weekly(13, "2026-10-01"), stats: stats({ roundCount: 13 }) }, TODAY);
    expect(v.pill).toBe("2주차 · 진행중");
    expect(v.title).toBe("EC2·S3");
    expect(v.meta).toBe("10.08(목) – 10.14(수) · 마감 D-2");
    expect(v.tasks[0]).toEqual({ title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14",
      people: [{ userId: "u-jieun", name: "지은", tone: "peach", status: "done" }, { userId: "u-1", name: "철수", tone: "blue", status: "open" }] });
  });
  it("ended algo — 'N주 완주' is period weeks (13), not round count (seed has 3 depth-2 rounds) (D14, S10)", () => {
    expect(curOf({ status: "ended", startDate: "2026-07-01", endDate: "2026-09-30", currentRound: null, rounds: weekly(3, "2026-07-01"),
      stats: stats({ roundCount: 3, totalAssignments: 78, totalSubmissions: 68, overallPct: 87 }) }, TODAY)).toEqual({
      pill: "종료", title: "13주 완주 · 전체 달성률 87%", meta: "07.01 – 09.30 · 제출 68 / 78건", tasks: [],
    });
  });
  it("periodWeeks", () => {
    expect(periodWeeks("2026-07-01", "2026-09-30")).toBe(13);                // 92일
    expect(periodWeeks("2026-11-02", "2026-12-27")).toBe(8);
  });
  it("active without current round (Review Focus 2)", () => {
    const gap = [{ ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" }, { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" }];
    expect(curOf({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: null, rounds: gap, stats: stats({ roundCount: 2 }) }, TODAY)).toEqual({
      pill: "1주차 · 기간 종료", title: "진행 중인 회차가 없어요", meta: "다음 회차 10.15 시작", tasks: [],
    });
  });
});

describe("glanceOf (roomview §3.7)", () => {
  it("toeic / cs / jcg / algo / aws", () => {
    expect(glanceOf(stats({}), "recruit")).toEqual({ rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" });
    expect(glanceOf(stats({ roundCount: 12, leafCount: 24, commonCount: 24, startWeekdays: [1, 4] }), "recruit").rounds).toBe("12회차 · 월·목 시작");
    expect(glanceOf(stats({ roundCount: 2, leafCount: 6, commonCount: 6 }), "recruit")).toEqual({ rounds: "2회차", tasks: "6개 · 모두 공통 과제" });
    expect(glanceOf(stats({ roundCount: 4, leafCount: 9, commonCount: 7, designatedCount: 2 }), "recruit").tasks).toBe("9개 · 공통 7 · 지정 2");
    expect(glanceOf(stats({ roundCount: 3, leafCount: 13, totalAssignments: 78, totalSubmissions: 68, startWeekdays: [3] }), "ended")).toEqual({ rounds: "3회차 · 완료", tasks: "78건 중 68건 제출" });   // algo 시드 = depth-2 3개(D14)
    expect(glanceOf(stats({ roundCount: 13, leafCount: 8, commonCount: 5, designatedCount: 3, startWeekdays: [4] }), "active")).toEqual({ rounds: "13회차 · 매주 목요일 시작", tasks: "8개 · 공통 5 · 지정 3" });
  });
});

describe("rulesOf", () => {
  it("splits markdown bullets", () => {
    expect(rulesOf("- 첫째\n* 둘째\n\n셋째\n")).toEqual(["첫째", "둘째", "셋째"]);
    expect(rulesOf("")).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/format.test.ts`
Expected: FAIL — `Cannot find module './format'`

- [ ] **Step 3: `src/lib/api/format.ts`**

```ts
import { dday, diffDays, WEEKDAY_KO, weekdayKo } from "@/lib/date";
import type { Tone } from "@/lib/palette";
import type { RoomStatus, TaskStatus } from "@/lib/types";
import type { LeafSummary, RoomDetail, RoomStatusDto, RoundSummary, TaskTypeDto } from "./types";

export const ymd = (iso: string) => iso.replaceAll("-", ".");
/** "10.01" — date.ts 의 md() 는 월을 안 채우므로(7.01) 카드·회차 표기는 이것을 쓴다 */
export const mmdd = (iso: string) => iso.slice(5).replace("-", ".");
export const uiStatus = (s: RoomStatusDto): RoomStatus => (s === "draft" ? "recruit" : s);
export const TASK_TYPE_KO: Record<TaskTypeDto, "공통" | "지정"> = { common: "공통", designated: "지정" };

const sameYear = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4);

/** D14: 기간 주 수 = round((일수+1)/7). 카드 "· N주" 와 종료 방 "N주 완주" 가 같은 값을 쓴다(회차 수와 무관) */
export const periodWeeks = (start: string, end: string): number => Math.round((diffDays(start, end) + 1) / 7);

/** main §3-5: "{YYYY.MM.DD} – {같은 해면 MM.DD} · {round(일수/7)}주" */
export function periodCard(start: string, end: string): string {
  return `${ymd(start)} – ${sameYear(start, end) ? mmdd(end) : ymd(end)} · ${periodWeeks(start, end)}주`;
}

/** roomview §1.2: 요일 포함 */
export function periodLong(start: string, end: string): string {
  return `${ymd(start)}(${weekdayKo(start)}) – ${sameYear(start, end) ? mmdd(end) : ymd(end)}(${weekdayKo(end)})`;
}

export function ddayOf(status: RoomStatusDto, today: string, start: string, end: string): { short: string; long: string } {
  if (status === "ended") return { short: "종료", long: `${mmdd(end)} 종료` };
  if (status === "active") {
    const short = dday(today, end);
    return { short, long: `종료까지 ${short}` };
  }
  const short = dday(today, start);
  return { short, long: `시작까지 ${short}` };
}

/** 오늘을 포함하는 회차(여러 개면 마지막) → inside. 없으면 오늘 이전에 시작한 마지막 회차 → inside:false. 시작한 회차가 없으면 null. */
export function curIndexOf(rounds: RoundSummary[], today: string): { index: number; inside: boolean } | null {
  let inside = -1;
  let started = -1;
  rounds.forEach((r, i) => {
    if (r.startDate <= today) started = i;
    if (r.startDate <= today && today <= r.endDate) inside = i;
  });
  if (inside >= 0) return { index: inside, inside: true };
  if (started >= 0) return { index: started, inside: false };
  return null;
}

/** roomview §3.6: recruit 앞 3개 / active [cur-1, cur, cur+1] + 완료 접두 / ended 전부 */
export function roundsWindow(rounds: RoundSummary[], status: RoomStatusDto, today: string): { rows: RoundSummary[]; more: string; lo: number } {
  const n = rounds.length;
  if (status === "ended") return { rows: rounds, more: "", lo: 0 };
  if (status !== "active") return { rows: rounds.slice(0, 3), more: n > 3 ? `이후 ${n - 3}개 회차가 더 있어요` : "", lo: 0 };
  const i = curIndexOf(rounds, today)?.index ?? 0;
  const lo = Math.max(0, Math.min(i - 1, n - 3));
  const hi = Math.min(n - 1, lo + 2);
  const after = n - 1 - hi;
  const prefix = lo === 0 ? "" : lo === 1 ? `${rounds[0].label} 완료` : `${rounds[0].label.replace(/주차$/, "")}~${rounds[lo - 1].label} 완료`;
  const tail = after > 0 ? `이후 ${after}개 회차가 더 있어요` : "";
  return { rows: rounds.slice(lo, hi + 1), more: [prefix, tail].filter(Boolean).join(" · "), lo };
}

export type RoundRowView = { label: string; title: string; dates: string; state: string; sub?: number; total?: number; current?: boolean };

export function roundRow(r: RoundSummary, status: RoomStatusDto, today: string, current: boolean): RoundRowView {
  const dates = `${mmdd(r.startDate)} – ${mmdd(r.endDate)}`;
  if (status === "recruit" || status === "draft") return { label: r.label, title: r.title, dates, state: `과제 ${r.leafCount}개` };
  if (status === "ended") return { label: r.label, title: r.title, dates, state: "완료", sub: r.submitted, total: r.assigned };
  const state = today < r.startDate ? "예정" : today <= r.endDate ? "진행중" : r.pct === 100 ? "완료" : "기간 종료";
  return { label: r.label, title: r.title, dates, state, sub: r.submitted, total: r.assigned, current };
}

export type CurPersonView = { userId: string; name: string; tone: Tone; status: TaskStatus };
export type CurTaskView = { title: string; type: "공통" | "지정"; dates: string; people: CurPersonView[] };
export type CurView = { pill: string; title: string; meta: string; tasks: CurTaskView[] };
export type CurInput = Pick<RoomDetail, "status" | "startDate" | "endDate" | "currentRound" | "rounds" | "stats">;

const taskView = (t: LeafSummary): CurTaskView => ({
  title: t.title,
  type: TASK_TYPE_KO[t.type],
  dates: `${mmdd(t.startDate)} – ${mmdd(t.endDate)}`,
  people: t.people.map((p) => ({ userId: p.userId, name: p.nickname, tone: p.tone, status: p.status })),
});

/** roomview §1.3 현재 회차 카드 */
export function curOf(dto: CurInput, today: string): CurView {
  const { stats } = dto;
  if (dto.status === "recruit" || dto.status === "draft") {
    const s = dto.startDate;
    return {
      pill: "시작 전",
      title: `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일(${weekdayKo(s)}) 첫 회차가 열려요`,
      meta: `${stats.roundCount}회차 · 과제 ${stats.leafCount}개 준비됨`,
      tasks: [],
    };
  }
  if (dto.status === "ended") {
    return {
      pill: "종료",
      title: `${periodWeeks(dto.startDate, dto.endDate)}주 완주 · 전체 달성률 ${stats.overallPct ?? 0}%`,   // N주 = 기간 주 수(D14), N회차 = roundCount
      meta: `${mmdd(dto.startDate)} – ${mmdd(dto.endDate)} · 제출 ${stats.totalSubmissions} / ${stats.totalAssignments}건`,
      tasks: [],
    };
  }
  const cur = dto.currentRound;
  if (cur) {
    return {
      pill: `${cur.label} · 진행중`,
      title: cur.title,
      meta: `${mmdd(cur.startDate)}(${weekdayKo(cur.startDate)}) – ${mmdd(cur.endDate)}(${weekdayKo(cur.endDate)}) · 마감 ${dday(today, cur.endDate)}`,
      tasks: (cur.tasks ?? []).map(taskView),
    };
  }
  const prev = curIndexOf(dto.rounds, today);
  const next = dto.rounds.find((r) => r.startDate > today);
  return {
    pill: prev ? `${dto.rounds[prev.index].label} · 기간 종료` : "시작 전",
    title: "진행 중인 회차가 없어요",
    meta: next ? `다음 회차 ${mmdd(next.startDate)} 시작` : "",
    tasks: [],
  };
}

/** roomview §3.7 */
export function glanceOf(stats: RoomDetail["stats"], status: RoomStatusDto): { rounds: string; tasks: string } {
  const wd = stats.startWeekdays;
  let rounds = `${stats.roundCount}회차`;
  if (status === "ended") rounds += " · 완료";
  else if (wd.length === 1 && stats.roundCount >= 3) rounds += ` · 매주 ${WEEKDAY_KO[wd[0]]}요일 시작`;
  else if (wd.length === 2) rounds += ` · ${WEEKDAY_KO[wd[0]]}·${WEEKDAY_KO[wd[1]]} 시작`;
  const mix = stats.designatedCount === 0 ? "모두 공통 과제" : `공통 ${stats.commonCount} · 지정 ${stats.designatedCount}`;
  const tasks =
    status === "ended"
      ? `${stats.totalAssignments}건 중 ${stats.totalSubmissions}건 제출`
      : status === "active"
        ? `${stats.leafCount}개 · 공통 ${stats.commonCount} · 지정 ${stats.designatedCount}`
        : `${stats.leafCount}개 · ${mix}`;
  return { rounds, tasks };
}

/** rules_md → 불릿 배열 (D14: 마크다운 1필드, 프론트가 "- " 라인 분해) */
export const rulesOf = (md: string): string[] =>
  md
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/api/format.test.ts && npx tsc --noEmit`
Expected: 모두 PASS (26 assertions 안팎), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/format.ts src/lib/api/format.test.ts
git commit -m "feat(web): shared formatting adapter (period, dday, rounds window, current round, glance)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 9: 방 목록 — `rooms.ts` + MainScreen 서버 필터·디바운스 검색·준비중 배지

**Files:**
- Create: `src/lib/api/rooms.ts`
- Modify: `src/data/rooms.ts` (`CardStatus` 에 `"draft"` 추가, `Room` 에 `leaderTone` 추가, `ROOMS` 상수는 테스트 픽스처로 남김), `src/components/main/MainScreen.tsx`, `src/components/main/FilterBar.tsx`, `src/components/main/RoomCard.tsx`, `src/app/page.tsx`
- Test: `src/lib/api/rooms.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `RoomCardDto`, `RoomListResponse`; Task 2 `useMe`, `useToday`; Task 6 `useDebounced`; Task 8 `periodCard`, `periodWeeks`, `mmdd`.
- Produces:
  ```ts
  export type RoomsParams = { scope: Tab; status: StatusFilter; q: string; tags: string[]; page?: number; size?: number };
  export const DEFAULT_PARAMS: RoomsParams;        // public / all / "" / []
  export function fetchRooms(p: RoomsParams, client?: Db): Promise<RoomListResponse>;
  export function toRoomCard(dto: RoomCardDto, today: string): Room;
  // MainScreen({ initial: RoomListResponse }) — 첫 화면은 서버에서 받은 목록으로 그린다
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/rooms.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { toRoomCard } from "./rooms";
import type { RoomCardDto } from "./types";

const TODAY = "2026-10-12";
const leader = (nickname: string): RoomCardDto["leader"] => ({ userId: `u-${nickname}`, nickname, tone: "mint" });
const dto = (o: Partial<RoomCardDto>): RoomCardDto => ({
  id: "1", slug: "x", title: "t", intro: "i", status: "recruit", isFull: false, isPublic: true, joinMode: "direct",
  memberCount: 2, maxMembers: 8, leader: leader("서연"), tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }],
  startDate: "2026-11-02", endDate: "2026-12-27", membership: null, progress: { kind: "recruit" }, ...o,
});

describe("toRoomCard (main §3)", () => {
  it("toeic recruit 2/8", () => {
    const r = toRoomCard(dto({ slug: "toeic" }), TODAY);
    expect(r.id).toBe("toeic");
    expect(r.status).toBe("recruit");
    expect(r.period).toBe("2026.11.02 – 12.27 · 8주");
    expect(r.tags).toEqual(["영어"]);
    expect(r.slot).toEqual({ label: "모집 현황", value: "2/8명", pct: 25, note: "11.02(월) 시작 · 6자리 남음", em: "D-21" });
    expect(r.mine).toBe(false);
    expect(r.created).toBe(false);
    expect(r.leaderTone).toBe("mint");
  });
  it("aws mine 33% (철수 2/6, 전체 트리 — D5) with next OPEN task D-2", () => {
    // 목업 카드의 50%(2/4)는 폐기 — 시드·rooms_list 의 mine 분모는 전체 트리 기준 6 (D5, D14)
    const r = toRoomCard(dto({ slug: "aws", status: "active", joinMode: "approval", memberCount: 4, maxMembers: 6, leader: leader("민수"),
      startDate: "2026-10-01", endDate: "2026-12-31", membership: { role: "member", status: "active" },
      progress: { kind: "mine", submitted: 2, assigned: 6, nextTask: { nodeId: "21", title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } } }), TODAY);
    expect(r.status).toBe("active");
    expect(r.approval).toBe(true);
    expect(r.mine).toBe(true);
    expect(r.period).toBe("2026.10.01 – 12.31 · 13주");
    expect(r.slot).toEqual({ label: "내 진척률", value: "33%", pct: 33, note: "EC2 인스턴스 유형 정리", em: "D-2" });
  });
  it("mine with nothing left", () => {
    const r = toRoomCard(dto({ status: "active", membership: { role: "member", status: "active" }, progress: { kind: "mine", submitted: 4, assigned: 4, nextTask: null } }), TODAY);
    expect(r.slot).toEqual({ label: "내 진척률", value: "100%", pct: 100, note: "남은 과제가 없어요", em: "" });
  });
  it("algo final 87% — 'N주 완주' = period weeks 13 even though the seed has 3 rounds (D14, S10)", () => {
    const r = toRoomCard(dto({ slug: "algo", status: "ended", memberCount: 6, maxMembers: 6, startDate: "2026-07-01", endDate: "2026-09-30",
      membership: { role: "member", status: "active" }, progress: { kind: "final", submitted: 68, assigned: 78, totalRounds: 3 } }), TODAY);
    expect(r.status).toBe("ended");
    expect(r.slot).toEqual({ label: "최종 달성률", value: "87%", pct: 87, note: "13주 완주 · 제출 68/78건", em: "" });
  });
  it("react team progress 4/8주", () => {
    const r = toRoomCard(dto({ slug: "react", status: "active", memberCount: 5, startDate: "2026-09-21", endDate: "2026-11-15",
      progress: { kind: "team", currentRound: { index: 4, label: "4주차", title: "컴포넌트 상태 관리" }, totalRounds: 8 } }), TODAY);
    expect(r.slot).toEqual({ label: "전체 진행", value: "4/8주", pct: 50, note: "4주차 · 컴포넌트 상태 관리", em: "" });
  });
  it("team without current round", () => {
    const r = toRoomCard(dto({ status: "active", progress: { kind: "team", currentRound: null, totalRounds: 8 } }), TODAY);
    expect(r.slot).toEqual({ label: "전체 진행", value: "0/8주", pct: 0, note: "진행 중인 회차가 없어요", em: "" });
  });
  it("recruit note priority: pending > full > first > remaining", () => {
    expect(toRoomCard(dto({ slug: "sqld", memberCount: 1, maxMembers: 5, joinMode: "approval", startDate: "2026-10-26", endDate: "2026-11-22",
      membership: { role: "member", status: "pending" } }), TODAY).slot).toEqual({ label: "모집 현황", value: "1/5명", pct: 20, note: "10.26(월) 시작 · 승인 대기중", em: "D-14" });
    const jcg = toRoomCard(dto({ slug: "jcg", memberCount: 4, maxMembers: 4, isFull: true, joinMode: "approval", startDate: "2026-10-19", endDate: "2026-11-01" }), TODAY);
    expect(jcg.status).toBe("full");
    expect(jcg.slot).toEqual({ label: "모집 현황", value: "4/4명", pct: 100, note: "10.19(월) 시작 · 정원 마감", em: "D-7" });
    const docker = toRoomCard(dto({ slug: "docker", memberCount: 1, maxMembers: 6, startDate: "2026-11-09", endDate: "2026-12-20", membership: { role: "leader", status: "active" } }), TODAY);
    expect(docker.created).toBe(true);
    expect(docker.mine).toBe(false);
    expect(docker.slot).toEqual({ label: "모집 현황", value: "1/6명", pct: 17, note: "11.09(월) 시작 · 첫 참가자를 기다려요", em: "D-28" });
  });
  it("draft room gets its own badge status (D2)", () => {
    const r = toRoomCard(dto({ status: "draft", memberCount: 1, membership: { role: "leader", status: "active" } }), TODAY);
    expect(r.status).toBe("draft");
    expect(r.slot.note).toBe("11.02(월) 시작 예정 · 모집 전");
  });
  it("private room → pub false", () => {
    expect(toRoomCard(dto({ isPublic: false }), TODAY).pub).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/rooms.test.ts`
Expected: FAIL — `Cannot find module './rooms'`

- [ ] **Step 3: `src/data/rooms.ts` 타입 확장** — 파일 상단 두 타입만 바꾼다(상수 `ROOMS` 는 그대로 둔다. 화면에서는 더 이상 import 하지 않는다).

```ts
import type { Tone } from "@/lib/palette";
import type { RoomStatus } from "@/lib/types";

/** 카드 배지 상태 — RoomStatus 에 '정원 마감'·'준비중'(D2) 이 추가됨. 상태 필터는 서버(rooms_list p_status) 가 적용한다. */
export type CardStatus = RoomStatus | "full" | "draft";
```

`Room` 타입 전체(기존 필드 그대로 + `leaderTone` 한 줄):

```ts
export type Room = {
  id: string;
  title: string;
  intro: string;
  status: CardStatus;
  pub: boolean;
  approval: boolean;
  cur: number;
  max: number;
  leader: string;
  /** 리더 아바타 색 — DTO leader.tone (목업은 toneOf(name)) */
  leaderTone?: Tone;
  tags: string[];
  mine: boolean;
  created: boolean;
  period: string;
  slot: Slot;
};
```

`ROOMS` 상수의 aws 슬롯(목업 `50%`)은 고치지 않는다 — 화면이 더 이상 import 하지 않는 픽스처이고, 실데이터는 D5 대로 33%.

- [ ] **Step 4: `src/lib/api/rooms.ts`**

```ts
import { rpc, type Db } from "@/lib/api/errors";
import { mmdd, periodCard, periodWeeks } from "@/lib/api/format";
import type { RoomCardDto, RoomListResponse } from "@/lib/api/types";
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
  if (d.membership?.status === "pending") return "승인 대기중";
  if (d.memberCount >= d.maxMembers) return "정원 마감";
  if (d.memberCount <= 1) return "첫 참가자를 기다려요";
  return `${d.maxMembers - d.memberCount}자리 남음`;
}

function slotOf(d: RoomCardDto, today: string): Slot {
  const p = d.progress;
  switch (p.kind) {
    case "recruit": {
      const start = `${mmdd(d.startDate)}(${weekdayKo(d.startDate)}) 시작${d.status === "draft" ? " 예정" : ""}`;
      return { label: "모집 현황", value: `${d.memberCount}/${d.maxMembers}명`, pct: pct(d.memberCount, d.maxMembers), note: `${start} · ${recruitTail(d)}`, em: dday(today, d.startDate) };
    }
    case "mine": {
      const v = pct(p.submitted, p.assigned);
      return { label: "내 진척률", value: `${v}%`, pct: v, note: p.nextTask?.title ?? "남은 과제가 없어요", em: p.nextTask ? dday(today, p.nextTask.dueDate) : "" };
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
    tags: d.tags.map((t) => t.label),
    mine: !!m && m.role === "member" && (m.status === "active" || m.status === "pending"),
    created: m?.role === "leader",
    period: periodCard(d.startDate, d.endDate),
    slot: slotOf(d, today),
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/api/rooms.test.ts`
Expected: 9 passed

- [ ] **Step 6: `RoomCard.tsx` 수정** — `draft` 배지·톤 추가, 리더 아바타에 `tone`.

`STATUS_BADGE` 와 `SLOT_TONE` 에 한 줄씩:
```ts
  draft: { label: "준비중", bg: "#E9EEF0", fg: "#4A5563" },
```
```ts
  draft: { bg: "#F4F6F7", label: "#4A5563", bar: "#7A8594", track: "#DDE2E5" },
```
리더 아바타: `<Avatar name={room.leader} tone={room.leaderTone} size={24} strong />`.

- [ ] **Step 7: `FilterBar.tsx` 수정** — 태그 facet 이 `slug` 를 가지며 선택은 slug 로. 익명이면 mine/created 탭 숨김.

Props 타입을 바꾼다:
```ts
type Props = {
  tab: Tab;
  tabCounts: Record<Tab, number>;
  onTab: (t: Tab) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  /** 서버 tagFacets — label 표시, slug 로 선택 */
  tagCounts: { slug: string; tag: string; count: number }[];
  /** 선택된 slug */
  tags: string[];
  onToggleTag: (slug: string) => void;
  onResetTags: () => void;
  /** 비로그인: 전체 공개 방 탭만 */
  anonymous?: boolean;
};
```
탭 렌더: `TABS.filter((t) => !anonymous || t.key === "public").map(...)`. 태그 칩: `key={slug}`, `on = tags.includes(slug)`, `onClick={() => onToggleTag(slug)}`, 표시는 `#{tag}` 그대로.

- [ ] **Step 8: `MainScreen.tsx` 전체 교체**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { toApiError } from "@/lib/api/errors";
import { DEFAULT_PARAMS, fetchRooms, toRoomCard } from "@/lib/api/rooms";
import type { RoomListResponse } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { useDebounced } from "@/lib/useDebounced";
import { EmptyState } from "./EmptyState";
import { FilterBar, type StatusFilter, type Tab } from "./FilterBar";
import { RoomCard } from "./RoomCard";

export function MainScreen({ initial }: { initial: RoomListResponse }) {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("public");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [res, setRes] = useState<RoomListResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const seq = useRef(0);
  const first = useRef(true);

  // 탭·상태·검색·태그 → 서버 재조회. 첫 렌더는 서버가 준 initial 로 건너뛴다.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setError("");
    fetchRooms({ ...DEFAULT_PARAMS, scope: tab, status, q: dq, tags })
      .then((r) => my === seq.current && setRes(r))
      .catch((e) => my === seq.current && setError(toApiError(e).message))
      .finally(() => my === seq.current && setLoading(false));
  }, [tab, status, dq, tags]);

  const rooms = useMemo(() => res.items.map((d) => toRoomCard(d, res.today)), [res]);
  const tagCounts = useMemo(() => res.tagFacets.map((f) => ({ slug: f.slug, tag: f.label, count: f.count })), [res.tagFacets]);
  const selectedLabels = useMemo(() => res.tagFacets.filter((f) => tags.includes(f.slug)).map((f) => f.label), [res.tagFacets, tags]);
  const toggleTag = (slug: string) => setTags((prev) => (prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]));
  const createHref = me ? routes.createRoom() : routes.login(routes.createRoom());

  return (
    <div className="min-h-screen bg-bg-main text-ink">
      <AppHeader active="home" variant="flat" bell={<NotificationBell />}>
        <label className="flex h-10 min-w-40 flex-[0_1_280px] items-center gap-2 rounded-[12px] border border-line bg-surface-3 px-[14px]">
          <span className="sr-only">스터디 검색</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6675" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="스터디 제목, 태그 검색" className="w-full min-w-0 border-0 bg-transparent text-[14px] outline-none placeholder:text-faint" />
        </label>
      </AppHeader>

      <main className="mx-auto max-w-[1376px] px-8 pb-16 pt-9 max-sm:px-4">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">스터디 방</h1>
            <p className="mb-0 mt-[6px] text-[15px] text-muted">함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요.</p>
          </div>
          <Link href={createHref} className="flex h-[46px] items-center gap-2 rounded-[14px] bg-navy px-5 text-[15px] font-semibold text-white hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            방 만들기
          </Link>
        </div>

        <FilterBar tab={tab} tabCounts={res.tabCounts} onTab={setTab} status={status} onStatus={setStatus} tagCounts={tagCounts} tags={tags} onToggleTag={toggleTag} onResetTags={() => setTags([])} anonymous={!me} />

        {error && <p role="alert" className="mb-6 rounded-[12px] bg-[#FFF6F5] px-4 py-3 text-[13px] text-warn">{error}</p>}
        {!loading && !error && rooms.length === 0 && <EmptyState q={q} tab={tab} />}

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]" aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}>
          {rooms.map((r) => (
            <RoomCard key={r.id} room={r} selectedTags={selectedLabels} />
          ))}
        </div>
      </main>
    </div>
  );
}
```

`EmptyState` 의 `routes.createRoom()` 링크는 비로그인이면 proxy 가 `/login?returnTo=/rooms/new` 로 보내므로 그대로 둔다.

- [ ] **Step 9: `src/app/page.tsx`** — 첫 목록은 서버에서.

```tsx
import { MainScreen } from "@/components/main/MainScreen";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const initial = await fetchRooms(DEFAULT_PARAMS, await createClient());
  return <MainScreen initial={initial} />;
}
```

- [ ] **Step 10: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. `npm run dev` → `/` 에 시드 카드 8장(spring 은 비공개라 공개 탭에 없음), 철수 로그인 시 탭 카운트 8 / 4 / 1. 검색창에 "토익" 입력 → 250ms 뒤 1장. `grep -rn "from \"@/data/rooms\"" src/components src/app` 결과에 `ROOMS` 가 없어야 한다(타입 import 만).

- [ ] **Step 11: Commit**

```bash
git add src/lib/api/rooms.ts src/lib/api/rooms.test.ts src/data/rooms.ts src/components/main src/app/page.tsx
git commit -m "feat(web): room list from rooms_list with server-side filters, debounced search and draft badge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---
### Task 10: `/rooms/new` — 방 만들기 최소 폼 (§4.3) → `room_create` → 커리큘럼 편집 모드

**Files:**
- Modify: `src/lib/routes.ts` (`myStudyEdit` 추가), `src/lib/routes.test.ts` (한 줄 추가)
- Create: `src/components/room-new/validate.ts`, `src/components/room-new/NewRoomForm.tsx`, `src/app/rooms/new/page.tsx`
- Test: `src/components/room-new/validate.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `CreateRoom`, `RoomDetail`; Task 2 `useToday`; Task 3 `requireMe`.
- Produces:
  ```ts
  routes.myStudyEdit(slug): string;   // "/my-study/{slug}?tab=curriculum&mode=edit" — Task 12 가 searchParams 로 읽는다
  export type NewRoomValues = { title: string; intro: string; startDate: string; endDate: string; maxMembers: string; isPublic: boolean; joinMode: JoinMode;
                                descriptionMd: string; rulesMd: string; minMembers: string; leaderDoesTasks: boolean };
  export function validateNewRoom(v: NewRoomValues, today: string): Partial<Record<keyof NewRoomValues, string>>;
  export function toCreateRoom(v: NewRoomValues): CreateRoom;
  ```
- **범위 밖 → plan 06:** 만든 방은 **DRAFT** 로 남는다. DRAFT → RECRUIT 의 "모집 시작"(`room_open_recruit`)·"지금 시작"(`room_start`) 버튼과 커버 이미지 업로드는 plan 06(그룹장 운영 UI). 이 태스크는 생성 → 커리큘럼 편집 모드 이동까지만 한다. 편집 화면 상단의 상태 버튼 자리에는 `{/* plan 06: 모집 시작 / 지금 시작 */}` 주석만 둔다.

- [ ] **Step 1: 실패하는 테스트** — `src/components/room-new/validate.test.ts` (+ `routes.test.ts` 에 `expect(routes.myStudyEdit("aws")).toBe("/my-study/aws?tab=curriculum&mode=edit");` 한 줄)

```ts
import { describe, expect, it } from "vitest";
import { toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

const TODAY = "2026-10-12";
const ok: NewRoomValues = { title: "Docker·K8s 입문 6주", intro: "컨테이너 기초부터", startDate: "2026-11-09", endDate: "2026-12-20", maxMembers: "6", isPublic: true, joinMode: "direct", descriptionMd: "", rulesMd: "", minMembers: "", leaderDoesTasks: true };

describe("validateNewRoom (main §2-2 검증 규칙)", () => {
  it("valid → {}", () => expect(validateNewRoom(ok, TODAY)).toEqual({}));
  it("title/intro required and bounded", () => {
    expect(validateNewRoom({ ...ok, title: "   " }, TODAY).title).toBe("제목을 입력해 주세요");
    expect(validateNewRoom({ ...ok, title: "a".repeat(61) }, TODAY).title).toBe("제목은 60자까지예요");
    expect(validateNewRoom({ ...ok, intro: "" }, TODAY).intro).toBe("한 줄 소개를 입력해 주세요");
    expect(validateNewRoom({ ...ok, intro: "a".repeat(101) }, TODAY).intro).toBe("한 줄 소개는 100자까지예요");
  });
  it("period: start ≥ today, end ≥ start", () => {
    expect(validateNewRoom({ ...ok, startDate: "2026-10-11" }, TODAY).startDate).toBe("시작일은 오늘 이후여야 해요");
    expect(validateNewRoom({ ...ok, startDate: TODAY }, TODAY).startDate).toBeUndefined();
    expect(validateNewRoom({ ...ok, endDate: "2026-11-08" }, TODAY).endDate).toBe("종료일은 시작일 이후여야 해요");
    expect(validateNewRoom({ ...ok, startDate: "" }, TODAY).startDate).toBe("시작일을 선택해 주세요");
  });
  it("members: max 2~100 integer, min ≤ max", () => {
    expect(validateNewRoom({ ...ok, maxMembers: "1" }, TODAY).maxMembers).toBe("최대 인원은 2~100명이에요");
    expect(validateNewRoom({ ...ok, maxMembers: "2.5" }, TODAY).maxMembers).toBe("최대 인원은 2~100명이에요");
    expect(validateNewRoom({ ...ok, minMembers: "7" }, TODAY).minMembers).toBe("최소 인원은 최대 인원 이하여야 해요");
    expect(validateNewRoom({ ...ok, minMembers: "0" }, TODAY).minMembers).toBe("최소 인원은 1명 이상이에요");
  });
});

describe("toCreateRoom", () => {
  it("trims and converts numbers, omits empty optionals", () => {
    expect(toCreateRoom({ ...ok, title: " Docker ", minMembers: "", descriptionMd: " " })).toEqual({
      title: "Docker", intro: "컨테이너 기초부터", startDate: "2026-11-09", endDate: "2026-12-20", maxMembers: 6, isPublic: true, joinMode: "direct", leaderDoesTasks: true,
    });
    expect(toCreateRoom({ ...ok, minMembers: "2", descriptionMd: "소개", rulesMd: "- 규칙" })).toMatchObject({ minMembers: 2, descriptionMd: "소개", rulesMd: "- 규칙" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/room-new src/lib/routes.test.ts`
Expected: FAIL — `Cannot find module './validate'`, `routes.myStudyEdit is not a function`

- [ ] **Step 3: `routes.ts` 에 추가 + `validate.ts`**

`routes` 객체의 `myStudy` 아래:
```ts
  /** 방 생성 직후 — 커리큘럼 탭 편집 모드 (§4.3) */
  myStudyEdit: (slug: string) => `/my-study/${slug}?tab=curriculum&mode=edit`,
```

```ts
// src/components/room-new/validate.ts
import type { CreateRoom, JoinMode } from "@/lib/api/types";

export type NewRoomValues = {
  title: string; intro: string; startDate: string; endDate: string; maxMembers: string; isPublic: boolean; joinMode: JoinMode;
  descriptionMd: string; rulesMd: string; minMembers: string; leaderDoesTasks: boolean;
};
export const EMPTY_VALUES: NewRoomValues = { title: "", intro: "", startDate: "", endDate: "", maxMembers: "6", isPublic: true, joinMode: "direct", descriptionMd: "", rulesMd: "", minMembers: "", leaderDoesTasks: true };

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);

export function validateNewRoom(v: NewRoomValues, today: string): Partial<Record<keyof NewRoomValues, string>> {
  const e: Partial<Record<keyof NewRoomValues, string>> = {};
  const title = v.title.trim();
  if (!title) e.title = "제목을 입력해 주세요";
  else if (title.length > 60) e.title = "제목은 60자까지예요";
  const intro = v.intro.trim();
  if (!intro) e.intro = "한 줄 소개를 입력해 주세요";
  else if (intro.length > 100) e.intro = "한 줄 소개는 100자까지예요";
  if (!v.startDate) e.startDate = "시작일을 선택해 주세요";
  else if (v.startDate < today) e.startDate = "시작일은 오늘 이후여야 해요";
  if (!v.endDate) e.endDate = "종료일을 선택해 주세요";
  else if (v.startDate && v.endDate < v.startDate) e.endDate = "종료일은 시작일 이후여야 해요";
  const max = int(v.maxMembers);
  if (!(max >= 2 && max <= 100)) e.maxMembers = "최대 인원은 2~100명이에요";
  if (v.minMembers.trim()) {
    const min = int(v.minMembers);
    if (!(min >= 1)) e.minMembers = "최소 인원은 1명 이상이에요";
    else if (max >= 2 && min > max) e.minMembers = "최소 인원은 최대 인원 이하여야 해요";
  }
  return e;
}

export function toCreateRoom(v: NewRoomValues): CreateRoom {
  const out: CreateRoom = { title: v.title.trim(), intro: v.intro.trim(), startDate: v.startDate, endDate: v.endDate, maxMembers: Number(v.maxMembers), isPublic: v.isPublic, joinMode: v.joinMode, leaderDoesTasks: v.leaderDoesTasks };
  if (v.descriptionMd.trim()) out.descriptionMd = v.descriptionMd.trim();
  if (v.rulesMd.trim()) out.rulesMd = v.rulesMd.trim();
  if (v.minMembers.trim()) out.minMembers = Number(v.minMembers);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/room-new src/lib/routes.test.ts`
Expected: PASS

- [ ] **Step 5: `src/components/room-new/NewRoomForm.tsx`** — 필수 6항목 펼침, "더 설정하기" 접힘(§4.3). 커버 이미지는 plan 06 범위(목록 DTO 에 없음).

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { rpc, toApiError } from "@/lib/api/errors";
import type { RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { useToday } from "@/lib/today";
import { EMPTY_VALUES, toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

const field = "h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]";
const area = "min-h-[96px] w-full resize-y rounded-[12px] border border-line-3 px-4 py-3 text-[14px] text-ink outline-none focus:border-mint";

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      {label}
      {children}
      {error && <span role="alert" className="text-[12px] font-medium text-warn">{error}</span>}
    </label>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? "#12A386" : "#C9D1D6" }}>
      <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-[left]" style={{ left: on ? 23 : 3 }} />
    </button>
  );
}

export function NewRoomForm() {
  const router = useRouter();
  const today = useToday();
  const [v, setV] = useState<NewRoomValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ReturnType<typeof validateNewRoom>>({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const set = <K extends keyof NewRoomValues>(k: K, val: NewRoomValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateNewRoom(v, today);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError("");
    try {
      const c = toCreateRoom(v);
      const room = await rpc<RoomDetail>("room_create", {
        p_title: c.title, p_intro: c.intro, p_start_date: c.startDate, p_end_date: c.endDate, p_max_members: c.maxMembers, p_is_public: c.isPublic, p_join_mode: c.joinMode,
        p_description_md: c.descriptionMd ?? "", p_rules_md: c.rulesMd ?? "", p_min_members: c.minMembers ?? null, p_leader_does_tasks: c.leaderDoesTasks ?? true, p_tag_slugs: [],
      });
      router.push(routes.myStudyEdit(room.slug));
      router.refresh();
    } catch (err) {
      const a = toApiError(err);
      if (a.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.createRoom()));
      setServerError(a.message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto w-full max-w-[640px] rounded-[20px] bg-surface p-7 max-sm:p-5">
        <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">방 만들기</h1>
        <p className="mb-6 mt-[6px] text-[14px] text-muted">채팅방 만들듯 30초면 충분해요. 커리큘럼은 만든 뒤 천천히 채워요.</p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="제목 (= 최상위 목표)" error={errors.title}><input className={field} value={v.title} maxLength={60} onChange={(e) => set("title", e.target.value)} placeholder="예) AWS SAA 자격증 3개월 완주" autoFocus /></Field>
          <Field label="한 줄 소개" error={errors.intro}><input className={field} value={v.intro} maxLength={100} onChange={(e) => set("intro", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="시작일" error={errors.startDate}><input type="date" className={field} min={today} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            <Field label="종료일" error={errors.endDate}><input type="date" className={field} min={v.startDate || today} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          </div>
          <Field label="최대 인원" error={errors.maxMembers}><input type="number" inputMode="numeric" min={2} max={100} className={field} value={v.maxMembers} onChange={(e) => set("maxMembers", e.target.value)} /></Field>
          <div className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3">
            <span><span className="block text-[14px] font-semibold">공개 방</span><span className="block text-[12px] text-muted">끄면 초대 링크로만 들어올 수 있어요</span></span>
            <Toggle on={v.isPublic} onChange={(x) => set("isPublic", x)} label="공개 방" />
          </div>
          <div role="radiogroup" aria-label="참가 방식" className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            {([["direct", "바로 참가", "누구나 바로 들어와요"], ["approval", "승인제", "그룹장이 승인해야 참가돼요"]] as const).map(([k, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={v.joinMode === k} onClick={() => set("joinMode", k)} className="flex flex-col items-start rounded-[12px] border px-4 py-3 text-left" style={{ borderColor: v.joinMode === k ? "#3FB89C" : "#E4ECEA", background: v.joinMode === k ? "#F5FBF9" : "#FFFFFF" }}>
                <span className="text-[14px] font-semibold">{t}</span><span className="text-[12px] text-muted">{d}</span>
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="h-11 self-start text-[14px] font-semibold text-mint">{more ? "접기" : "더 설정하기"}</button>
          {more && (
            <div className="flex flex-col gap-4 rounded-[14px] bg-surface-2 p-4">
              <Field label="상세 설명 (마크다운)"><textarea className={area} value={v.descriptionMd} onChange={(e) => set("descriptionMd", e.target.value)} /></Field>
              <Field label="운영 규칙 (마크다운 · 한 줄에 하나, '- ' 로 시작)"><textarea className={area} value={v.rulesMd} onChange={(e) => set("rulesMd", e.target.value)} placeholder={"- 마감은 회차 마지막 날 23:59(KST)예요."} /></Field>
              <Field label="최소 인원 (선택)" error={errors.minMembers}><input type="number" inputMode="numeric" min={1} className={field} value={v.minMembers} onChange={(e) => set("minMembers", e.target.value)} /></Field>
              <div className="flex items-center justify-between">
                <span><span className="block text-[14px] font-semibold">그룹장도 과제 수행</span><span className="block text-[12px] text-muted">끄면 공통 과제 담당자에서 빠져요 (시작 후 변경 불가)</span></span>
                <Toggle on={v.leaderDoesTasks} onChange={(x) => set("leaderDoesTasks", x)} label="그룹장도 과제 수행" />
              </div>
            </div>
          )}

          {serverError && <p role="alert" className="m-0 text-[13px] text-warn">{serverError}</p>}
          <button type="submit" disabled={busy} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">{busy ? "만드는 중…" : "방 만들기"}</button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: `src/app/rooms/new/page.tsx`**

```tsx
import type { Metadata } from "next";
import { NewRoomForm } from "@/components/room-new/NewRoomForm";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 방 만들기" };

export default async function NewRoomPage() {
  await requireMe(routes.createRoom());
  return <NewRoomForm />;
}
```

`/rooms/new` 는 `/rooms/[id]` 보다 정적 세그먼트가 우선하므로 충돌하지 않는다.

- [ ] **Step 7: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. 철수로 `/rooms/new` → 제목 "테스트 방", 소개, 기간(오늘~+30일), 6명 → "방 만들기" → `/my-study/<slug>?tab=curriculum&mode=edit` 로 이동(Task 12 전에는 쿼리를 무시하고 개요 탭이 뜬다). 목록 "내가 만든 방" 에 "준비중" 배지 카드. 이 방을 모집 상태로 바꾸는 버튼은 아직 없다(plan 06) — 확인 후 Studio 에서 지우거나 그대로 둔다(로컬 전용).

- [ ] **Step 8: Commit**

```bash
git add src/lib/routes.ts src/lib/routes.test.ts src/components/room-new src/app/rooms/new
git commit -m "feat(web): room creation form posting room_create and jumping to curriculum edit mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 11: 방 상세(RoomView) — `room-view.ts` 어댑터, 참가 액션 RPC, 확인 다이얼로그, 동적 페이지

**Files:**
- Create: `src/lib/api/room-view.ts`, `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/Toast.tsx`
- Modify: `src/data/room-view.ts` (타입 확장: `RoomId = string`, `Action` 에 `"login"`, `RoomMember` 에 `userId/tone/pending`, `RoomTask.people` 에 `tone`, `Room` 에 `pub`·`leaderTone` — `Room.id` 가 곧 slug), `src/components/room-view/{RoomViewScreen,RoomSidebar,JoinCard,RoomInfo,CurrentRoundCard}.tsx`, `src/app/rooms/[id]/page.tsx`
- Test: `src/lib/api/room-view.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `RoomDetail`, `MembershipResult`, `RoomCardDto`, `RoomListResponse`; Task 2 `useMe`; Task 8 전부; Task 9 `fetchRooms`, `DEFAULT_PARAMS`.
- Produces:
  ```ts
  export function fetchRoomDetail(slug: string, client?: Db, inviteToken?: string): Promise<RoomDetail>;
  export function joinRoom(slug: string): Promise<MembershipResult>;          // room_join
  export function applyRoom(slug: string): Promise<MembershipResult>;         // room_apply
  export function leaveRoom(slug: string): Promise<MembershipResult>;         // room_leave
  export function cancelApplication(slug: string): Promise<MembershipResult>; // room_cancel_application
  export function actionOf(dto: Pick<RoomDetail, "status" | "joinMode" | "memberCount" | "maxMembers" | "me">): Action;   // 03-api §3 순서
  export function toRoom(dto: RoomDetail, today: string, meId: string | null): Room;
  export function applyMembership(dto: RoomDetail, r: MembershipResult): RoomDetail;
  export type SidebarRoom = { id: string; title: string; status: RoomStatus; when: string; period: string; tags: RoomTagDto[]; capCur: number; capMax: number; mark?: "leave" | "pending" | "joined" | "owner" };
  export function toSidebarRoom(d: RoomCardDto, today: string): SidebarRoom;
  export function groupSidebar(items: SidebarRoom[]): { key: RoomStatus; label: string; items: SidebarRoom[] }[];
  // ConfirmDialog({ open, title, body, confirmLabel, danger?, onConfirm, onCancel })
  // Toast({ text, tone: "ok"|"bad", onClose })  — 4초 뒤 자동 닫힘
  ```
- **범위 밖 → plan 06 (§4.4 그룹장 사이드 패널):** 승인 대기 목록과 승인/거절 버튼(`room_approve`/`room_reject`), 초대 링크 복사(`invite_get`), 그룹장용 "모집 시작/지금 시작"(`room_open_recruit`/`room_start`). 이 태스크의 `JoinCard` 는 `act === "owner"` 일 때 기존 목업 문구("내가 만든 방이에요")만 보이고, 그 아래에 `{/* plan 06: 그룹장 패널(승인 대기 ${pendingCount}명 · 초대 링크 복사 · 모집 시작) */}` 주석을 남긴다. `RoomDetail.pendingCount`·`invite` 는 어댑터가 받아 두기만 한다.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/room-view.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import { actionOf, applyMembership, groupSidebar, toRoom, toSidebarRoom } from "./room-view";
import type { RoomCardDto, RoomDetail, RoundSummary } from "./types";

const TODAY = "2026-10-12";
const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"] = "mint") => ({ userId, nickname, tone });
const weekly = (n: number, start: string): RoundSummary[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: `${i + 1}주차`, title: `R${i + 1}`, startDate: addDays(start, i * 7), endDate: addDays(start, i * 7 + 6), leafCount: 2, assigned: 0, submitted: 0, pct: null }));
const stats = (o: Partial<RoomDetail["stats"]> = {}): RoomDetail["stats"] => ({ roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [1], ...o });
const detail = (o: Partial<RoomDetail> = {}): RoomDetail => ({
  today: TODAY, id: "1", slug: "toeic", title: "토익 900 8주 챌린지", intro: "매일 LC·RC", descriptionMd: "8주 동안", rulesMd: "- 오답 노트\n- 모의고사는 120분",
  status: "recruit", archived: false, isPublic: true, joinMode: "direct", startDate: "2026-11-02", endDate: "2026-12-27", maxMembers: 8, minMembers: 4, memberCount: 2,
  leader: P("u-seoyeon", "서연", "blue"), leaderDoesTasks: true, tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }, { slug: "toeic", label: "토익", tone: "peach", auto: true }],
  members: [{ ...P("u-seoyeon", "서연", "blue"), role: "leader", status: "active", joinedAt: "2026-10-01T00:00:00.000Z" }, { ...P("u-dohyun", "도현"), role: "member", status: "active", joinedAt: "2026-10-02T00:00:00.000Z" }],
  me: { state: "none" }, currentRound: null, rounds: weekly(8, "2026-11-02"), stats: stats(), myProgress: null, invite: null, pendingCount: 0, ...o,
});

describe("actionOf (03-api §3 결정 순서, roomview §3.5 목업 대응)", () => {
  it("table", () => {
    expect(actionOf(detail({ me: null }))).toBe("login");
    expect(actionOf(detail())).toBe("join");                                                     // toeic
    expect(actionOf(detail({ joinMode: "approval", memberCount: 1, maxMembers: 5, me: { state: "pending" } }))).toBe("pending"); // sqld
    expect(actionOf(detail({ me: { state: "leader" } }))).toBe("owner");                         // docker
    expect(actionOf(detail({ joinMode: "approval", memberCount: 4, maxMembers: 4 }))).toBe("full"); // jcg
    expect(actionOf(detail({ status: "active", joinMode: "approval", me: { state: "active" } }))).toBe("joined"); // aws
    expect(actionOf(detail({ status: "active" }))).toBe("activeClosed");                          // react
    expect(actionOf(detail({ status: "ended", me: { state: "active" } }))).toBe("joined");         // algo — D14: ended+member → joined
    expect(actionOf(detail({ status: "ended" }))).toBe("ended");
    expect(actionOf(detail({ me: { state: "active" } }))).toBe("leave");                          // recruit + joined
    expect(actionOf(detail({ joinMode: "approval" }))).toBe("apply");
    expect(actionOf(detail({ status: "draft", me: { state: "leader" } }))).toBe("owner");
  });
});

describe("toRoom", () => {
  it("toeic recruit: period/dday/members/glance/rounds window", () => {
    const r = toRoom(detail(), TODAY, null);
    expect(r.id).toBe("toeic");
    expect(r.status).toBe("recruit");
    expect(r.base).toBe("recruit");
    expect(r.period).toBe("2026.11.02(월) – 12.27(일)");
    expect(r.when).toBe("D-21");
    expect(r.ddayLong).toBe("시작까지 D-21");
    expect(r.capCur).toBe(2);
    expect(r.minNeed).toBe(4);
    expect(r.members).toEqual([{ userId: "u-seoyeon", name: "서연", tone: "blue", leader: true, me: false }, { userId: "u-dohyun", name: "도현", tone: "mint", leader: false, me: false }]);
    expect(r.cur.title).toBe("11월 2일(월) 첫 회차가 열려요");
    expect(r.rules).toEqual(["오답 노트", "모의고사는 120분"]);
    expect(r.rounds.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(r.rounds[0].state).toBe("과제 2개");
    expect(r.moreRounds).toBe("이후 5개 회차가 더 있어요");
    expect(r.glance).toEqual({ rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" });
  });
  it("aws active member: me flag by userId, 3-round window, 이후 10개", () => {
    const d = detail({ slug: "aws", status: "active", joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
      leader: P("u2", "민수"), rounds: weekly(13, "2026-10-01"), stats: stats({ roundCount: 13, leafCount: 8, commonCount: 5, designatedCount: 3, startWeekdays: [4] }), me: { state: "active" },
      members: [{ ...P("u2", "민수"), role: "leader", status: "active", joinedAt: null }, { ...P("u3", "지은", "peach"), role: "member", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }, { ...P("u4", "하나", "lav"), role: "member", status: "active", joinedAt: null }, { ...P("u5", "도윤", "slate"), role: "member", status: "inactive", joinedAt: null }] });
    const r = toRoom(d, TODAY, "u1");
    expect(r.base).toBe("joined");
    expect(r.dday).toBe("D-80");
    expect(r.members.map((m) => [m.name, !!m.me])).toEqual([["민수", false], ["지은", false], ["철수", true], ["하나", false]]); // 이탈자 제외
    expect(r.rounds.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(r.rounds[1].current).toBe(true);
    expect(r.moreRounds).toBe("이후 10개 회차가 더 있어요");
    expect(r.glance.rounds).toBe("13회차 · 매주 목요일 시작");
  });
  it("react: 1~2주차 완료 · 이후 3개", () => {
    const r = toRoom(detail({ slug: "react", status: "active", startDate: "2026-09-21", endDate: "2026-11-15", rounds: weekly(8, "2026-09-21") }), TODAY, null);
    expect(r.rounds.map((x) => x.label)).toEqual(["3주차", "4주차", "5주차"]);
    expect(r.moreRounds).toBe("1~2주차 완료 · 이후 3개 회차가 더 있어요");
    expect(r.base).toBe("activeClosed");
  });
  it("my pending row is appended as pending member", () => {
    const d = detail({ slug: "sqld", joinMode: "approval", memberCount: 1, maxMembers: 5, me: { state: "pending" },
      members: [{ ...P("u-gaeun", "가은", "amber"), role: "leader", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "pending", joinedAt: null }] });
    const r = toRoom(d, TODAY, "u1");
    expect(r.members).toEqual([{ userId: "u-gaeun", name: "가은", tone: "amber", leader: true, me: false }, { userId: "u1", name: "철수", tone: "blue", leader: false, me: true, pending: true }]);
    expect(r.capCur).toBe(1);
  });
});

describe("applyMembership", () => {
  it("replaces me/memberCount/members/pendingCount from MembershipResult (no optimistic +1)", () => {
    const d = detail();
    const next = applyMembership(d, { me: { state: "active" }, memberCount: 3, members: [...d.members, { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }], pendingCount: 0 });
    expect(next.memberCount).toBe(3);
    expect(actionOf(next)).toBe("leave");
    expect(toRoom(next, TODAY, "u1").members.at(-1)).toMatchObject({ name: "철수", me: true });
  });
});

describe("sidebar", () => {
  const card = (o: Partial<RoomCardDto>): RoomCardDto => ({ id: "1", slug: "toeic", title: "토익", intro: "", status: "recruit", isFull: false, isPublic: true, joinMode: "direct", memberCount: 2, maxMembers: 8, leader: P("u", "서연"), tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }], startDate: "2026-11-02", endDate: "2026-12-27", membership: null, progress: { kind: "recruit" }, ...o });
  it("toSidebarRoom", () => {
    expect(toSidebarRoom(card({}), TODAY)).toEqual({ id: "toeic", title: "토익", status: "recruit", when: "D-21", period: "2026.11.02 – 12.27", tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }], capCur: 2, capMax: 8, mark: undefined });
    expect(toSidebarRoom(card({ membership: { role: "member", status: "pending" } }), TODAY).mark).toBe("pending");
    expect(toSidebarRoom(card({ membership: { role: "leader", status: "active" } }), TODAY).mark).toBe("owner");
    expect(toSidebarRoom(card({ membership: { role: "member", status: "active" } }), TODAY).mark).toBe("leave");
    expect(toSidebarRoom(card({ status: "active", membership: { role: "member", status: "active" } }), TODAY).mark).toBe("joined");
    expect(toSidebarRoom(card({ status: "ended", startDate: "2026-07-01", endDate: "2026-09-30" }), TODAY).when).toBe("종료");
  });
  it("groupSidebar orders recruit → active → ended and drops empty groups", () => {
    const g = groupSidebar([toSidebarRoom(card({ status: "ended", slug: "algo" }), TODAY), toSidebarRoom(card({}), TODAY), toSidebarRoom(card({ status: "draft", slug: "d" }), TODAY)]);
    expect(g.map((x) => [x.key, x.items.map((i) => i.id)])).toEqual([["recruit", ["toeic", "d"]], ["ended", ["algo"]]]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/room-view.test.ts`
Expected: FAIL — `Cannot find module './room-view'`

- [ ] **Step 3: `src/data/room-view.ts` 타입 확장** (상수 `ROOMS` 등은 그대로 둔다 — 화면은 더 이상 import 하지 않는다)

바꾸는 타입 전체(나머지 타입·상수는 그대로):

```ts
/** 공개 식별자 = slug (D1). 목업 8개 리터럴에서 string 으로 넓힘 */
export type RoomId = string;
export type Action = "login" | "join" | "apply" | "leave" | "pending" | "joined" | "owner" | "full" | "activeClosed" | "ended";
export type RoomMember = {
  name: string;
  leader?: boolean;
  me?: boolean;
  userId?: string;
  tone?: Tone;
  /** 내 승인 대기 행 */
  pending?: boolean;
};
export type RoomTask = {
  title: string;
  type: "공통" | "지정";
  dates: string;
  people: { name: string; status: TaskStatus; tone?: Tone }[];
};
export type Room = {
  /** = slug */
  id: RoomId;
  title: string;
  intro: string;
  status: RoomStatus;
  base: BaseAction;
  approval: boolean;
  /** 비공개면 false */
  pub?: boolean;
  period: string;
  when: string;
  dday: string;
  ddayLong: string;
  leader: string;
  /** 그룹장 아바타 색 — DTO leader.tone */
  leaderTone?: Tone;
  tags: RoomTag[];
  capCur: number;
  capMax: number;
  minNeed: number;
  members: RoomMember[];
  cur: { pill: string; title: string; meta: string; tasks: RoomTask[] };
  about: string;
  rules: string[];
  rounds: RoomRound[];
  moreRounds: string;
  glance: { rounds: string; tasks: string };
};
```
`ROOMS: Record<RoomId, Room>` 은 `Record<string, Room>` 이 되어 그대로 컴파일된다. `ROOM_GROUPS` 의 `ids: RoomId[]` 도 그대로.

- [ ] **Step 4: `src/lib/api/room-view.ts`**

```ts
import { rpc, type Db } from "@/lib/api/errors";
import { curIndexOf, curOf, ddayOf, glanceOf, mmdd, periodLong, roundRow, roundsWindow, rulesOf, uiStatus, ymd } from "@/lib/api/format";
import type { MembershipResult, RoomCardDto, RoomDetail, RoomTagDto } from "@/lib/api/types";
import type { RoomStatus } from "@/lib/types";
import type { Action, BaseAction, Room, RoomMember } from "@/data/room-view";

export const fetchRoomDetail = (slug: string, client?: Db, inviteToken?: string) =>
  rpc<RoomDetail>("room_get", { p_slug: slug, p_invite_token: inviteToken ?? null }, client);
export const joinRoom = (slug: string) => rpc<MembershipResult>("room_join", { p_slug: slug, p_invite_token: null });
export const applyRoom = (slug: string) => rpc<MembershipResult>("room_apply", { p_slug: slug, p_invite_token: null });
export const leaveRoom = (slug: string) => rpc<MembershipResult>("room_leave", { p_slug: slug });
export const cancelApplication = (slug: string) => rpc<MembershipResult>("room_cancel_application", { p_slug: slug });

type ActionInput = Pick<RoomDetail, "status" | "joinMode" | "memberCount" | "maxMembers" | "me">;

/** 03-api §3: 비로그인→login · leader→owner · active&recruit→leave · active&(active|ended)→joined · pending→pending · ended→ended · active→activeClosed · full→full · approval→apply · direct→join */
export function actionOf(d: ActionInput): Action {
  const st = d.me?.state;
  if (!d.me) return "login";
  if (st === "leader") return "owner";
  const recruiting = d.status === "recruit" || d.status === "draft";
  if (st === "active") return recruiting ? "leave" : "joined";
  if (st === "pending") return "pending";
  if (d.status === "ended") return "ended";
  if (d.status === "active") return "activeClosed";
  if (d.memberCount >= d.maxMembers) return "full";
  return d.joinMode === "approval" ? "apply" : "join";
}

const baseOf = (act: Action): BaseAction => (act === "join" || act === "apply" || act === "leave" || act === "pending" || act === "login" ? "recruit" : act);

export function toRoom(d: RoomDetail, today: string, meId: string | null): Room {
  const dd = ddayOf(d.status, today, d.startDate, d.endDate);
  const win = roundsWindow(d.rounds, d.status, today);
  const ci = curIndexOf(d.rounds, today);
  const curIdx = d.currentRound ? d.rounds.findIndex((r) => r.id === d.currentRound!.id) : ci?.inside ? ci.index : -1;
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
    tags: d.tags.map((t) => ({ label: t.label, tone: t.tone, auto: t.auto })),
    capCur: d.memberCount,
    capMax: d.maxMembers,
    minNeed: d.minMembers ?? 0,
    members,
    cur: { pill: cur.pill, title: cur.title, meta: cur.meta, tasks: cur.tasks.map((t) => ({ title: t.title, type: t.type, dates: t.dates, people: t.people.map((p) => ({ name: p.name, status: p.status, tone: p.tone })) })) },
    about: d.descriptionMd,
    rules: rulesOf(d.rulesMd),
    rounds: win.rows.map((r, i) => roundRow(r, d.status, today, win.lo + i === curIdx)),
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
  const sameYear = d.startDate.slice(0, 4) === d.endDate.slice(0, 4);
  return {
    id: d.slug,
    title: d.title,
    status: uiStatus(d.status),
    when: ddayOf(d.status, today, d.startDate, d.endDate).short,
    period: `${ymd(d.startDate)} – ${sameYear ? mmdd(d.endDate) : ymd(d.endDate)}`,
    tags: d.tags,
    capCur: d.memberCount,
    capMax: d.maxMembers,
    mark: markOf(d),
  };
}

const GROUP_ORDER: { key: RoomStatus; label: string }[] = [{ key: "recruit", label: "모집중" }, { key: "active", label: "진행중" }, { key: "ended", label: "종료" }];

export const groupSidebar = (items: SidebarRoom[]) =>
  GROUP_ORDER.map((g) => ({ ...g, items: items.filter((i) => i.status === g.key) })).filter((g) => g.items.length > 0);
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/api/room-view.test.ts`
Expected: 9 passed

- [ ] **Step 6: `ConfirmDialog.tsx` + `Toast.tsx`** (디자인 §5: 참가 취소 확인 다이얼로그, 토스트)

```tsx
// src/components/ui/ConfirmDialog.tsx
"use client";

import { useEffect, useRef } from "react";

type Props = { open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void };

export function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,34,48,.4)] p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-title" aria-describedby="cd-body" onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[400px] flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-[0_20px_60px_rgba(27,34,48,.25)]">
        <h2 id="cd-title" className="m-0 text-[18px] font-bold">{title}</h2>
        <p id="cd-body" className="m-0 text-[14px] leading-[1.6] text-ink-2">{body}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink">돌아가기</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="h-11 rounded-[22px] px-4 text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: danger ? "#B4462B" : "#22264B" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/ui/Toast.tsx
"use client";

import { useEffect } from "react";

export type ToastMsg = { text: string; tone: "ok" | "bad" } | null;

export function Toast({ msg, onClose }: { msg: ToastMsg; onClose: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [msg, onClose]);
  if (!msg) return null;
  return (
    <div role={msg.tone === "bad" ? "alert" : "status"} className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_12px_32px_rgba(27,34,48,.25)]" style={{ background: msg.tone === "ok" ? "#1B2230" : "#B4462B" }}>
      {msg.text}
    </div>
  );
}
```

- [ ] **Step 7: `RoomSidebar.tsx` 수정** — 목업 상수 대신 props.

import 를 `import { MARK } from "@/data/room-view"; import { groupSidebar, type SidebarRoom } from "@/lib/api/room-view";` 로 바꾸고,
```ts
type Props = { selected: string; items: SidebarRoom[]; total: number };
export function RoomSidebar({ selected, items, total }: Props) {
  ...
  const groups = groupSidebar(items.filter((r) => !query || `${r.title} ${r.tags.map((t) => t.label).join(" ")}`.toLowerCase().includes(query))).filter((g) => st === "all" || st === g.key);
```
렌더 루프를 `g.items.map((r) => { const on = r.id === selected; const mark = r.mark ? MARK[r.mark] : undefined; const first = r.tags[0]; … })` 로 바꾸고 `{cur}/{r.capMax}명` → `{r.capCur}/{r.capMax}명`, `r.period.replace(...)` → `r.period`, 총계 `{ROOM_IDS.length}개` → `{total}개`. `first` 가 없을 수 있으니(태그 0개) `{first && (<span …>{first.label}</span>)}` 로 감싼다.

- [ ] **Step 8: `JoinCard.tsx` 수정** — `ME` import 와 `+1` 제거, `login` 케이스 추가.

```tsx
// import 줄: ME 제거
import { routes } from "@/lib/routes";
// JoinCard 본문 앞부분을 다음으로 교체
export function JoinCard(props: Props) {
  const { room, act } = props;
  const recruit = room.status === "recruit";
  const rows = room.members;            // 어댑터가 내 pending 행까지 넣어 준다
  const capCur = room.capCur;           // 서버 값 그대로 (roomview §3.5)
  const full = capCur >= room.capMax;
  const minOk = room.minNeed === 0 || capCur >= room.minNeed;
```
최소 인원 문구 줄: `room.minNeed > 0 && (<span …>…</span>)` 로 감싼다(`minMembers` null 이면 숨김). 참가자 `<li key={mb.userId ?? mb.name}>`, `<Avatar name={mb.name} tone={mb.tone} size={30} pending={mb.pending} />`.
`Cta` 의 `switch` 에 추가:
```tsx
    case "login":
      return (
        <div className="flex flex-col gap-[6px]">
          <Link href={routes.login(routes.room(room.id))} className={`${PRIMARY} bg-navy text-[16px]`}>로그인하고 참가</Link>
          <span className={NOTE}>이메일 인증 코드로 바로 로그인할 수 있어요</span>
        </div>
      );
```
`Props` 에 `busy?: boolean` 을 추가하고 join/apply/cancel 버튼에 `disabled={props.busy}`.

- [ ] **Step 9: `RoomInfo.tsx`·`CurrentRoundCard.tsx` 소폭 수정**

- `RoomInfo`: 공개 범위 `<dd className="font-medium">{room.pub === false ? "비공개 · 초대 링크로만 참가" : "공개"}</dd>`; 그룹장 아바타 `tone={room.leaderTone}`(Step 3 타입·Step 4 `toRoom` 에 이미 있음, 없으면 `toneOf` fallback).
- `CurrentRoundCard`: `<Avatar name={p.name} tone={p.tone} size={30} />`, 제출 수 계산을 `p.status === "done" || p.status === "late"` 로(지각 제출도 제출). **담당자 0명 지정 과제(서버 허용, `UNASSIGNED_TASK` 경고) 가드** — `t.people.length === 0` 이면 진행 막대·`n/0 제출` 대신 "담당자 미정" 을 보여 `NaN%` 를 막는다:

```tsx
                <div className="flex w-24 flex-col gap-[5px]">
                  {t.people.length === 0 ? (
                    <span className="text-right text-[12px] font-semibold text-muted">담당자 미정</span>
                  ) : (
                    <>
                      <span className="text-right text-[12px] font-semibold">
                        {allPlanned ? `${t.dates.split(" – ")[0]} 시작` : `${subs}/${t.people.length} 제출`}
                      </span>
                      <ProgressBar pct={Math.round((subs / t.people.length) * 100)} height={5} />
                    </>
                  )}
                </div>
```

- [ ] **Step 10: `RoomViewScreen.tsx` 전체 교체**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { actionOf, applyMembership, applyRoom, cancelApplication, joinRoom, leaveRoom, toRoom, toSidebarRoom } from "@/lib/api/room-view";
import type { MembershipResult, RoomDetail, RoomListResponse } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { RoomSidebar } from "./RoomSidebar";
import { RoomInfo } from "./RoomInfo";
import { JoinCard } from "./JoinCard";
import { GlanceCard } from "./GlanceCard";

export function RoomViewScreen({ detail, list }: { detail: RoomDetail; list: RoomListResponse }) {
  const me = useMe();
  const router = useRouter();
  const [dto, setDto] = useState(detail);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "cancel" | null>(null);
  const [toast, setToast] = useState<ToastMsg>(null);
  const room = useMemo(() => toRoom(dto, dto.today, me?.id ?? null), [dto, me]);
  const act = actionOf(dto);
  const sidebar = useMemo(() => list.items.map((d) => toSidebarRoom(d, list.today)), [list]);
  const closeToast = useCallback(() => setToast(null), []);

  const run = async (fn: () => Promise<MembershipResult>, okText: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setDto((d) => applyMembership(d, r));
      setToast({ text: okText, tone: "ok" });
      router.refresh(); // 사이드바 mark·탭 카운트 재동기화
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "AUTH_REQUIRED") return router.push(routes.login(routes.room(dto.slug)));
      if (err.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.room(dto.slug)));
      setToast({ text: err.message, tone: "bad" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4 min-[901px]:h-screen">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full min-h-0 max-w-[1408px] flex-1 gap-4 max-[900px]:flex-wrap">
        <RoomSidebar selected={dto.slug} items={sidebar} total={list.tabCounts.public} />
        <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-sm:px-4">
          <div className="flex flex-wrap items-start gap-7">
            <RoomInfo room={room} />
            <aside aria-label="참가 정보" className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px]">
              <JoinCard
                room={room}
                act={act}
                busy={busy}
                onJoin={() => run(() => joinRoom(dto.slug), "참가했어요")}
                onApply={() => run(() => applyRoom(dto.slug), "참가 신청했어요 · 그룹장이 승인하면 알려 드려요")}
                onCancel={() => setConfirm(act === "leave" ? "leave" : "cancel")}
              />
              <GlanceCard glance={room.glance} />
            </aside>
          </div>
        </main>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "leave" ? "참가를 취소할까요?" : "신청을 취소할까요?"}
        body={confirm === "leave" ? "모집 기간에는 다시 참가할 수 있어요. 지정 과제 담당에서도 빠져요." : "취소해도 모집 중이면 다시 신청할 수 있어요."}
        confirmLabel={confirm === "leave" ? "참가 취소" : "신청 취소"}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm === "leave" ? run(() => leaveRoom(dto.slug), "참가를 취소했어요") : run(() => cancelApplication(dto.slug), "신청을 취소했어요"))}
      />
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
```

- [ ] **Step 11: `src/app/rooms/[id]/page.tsx`** — 정적 생성 제거, `ROOM_NOT_FOUND` → 404.

```tsx
import { notFound } from "next/navigation";
import { RoomViewScreen } from "@/components/room-view/RoomViewScreen";
import { toApiError } from "@/lib/api/errors";
import { fetchRoomDetail } from "@/lib/api/room-view";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import type { RoomDetail } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/server";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string }> }) {
  const [{ id }, { invite }] = await Promise.all([params, searchParams]);
  const client = await createClient();
  let detail: RoomDetail;
  try {
    detail = await fetchRoomDetail(id, client, invite);
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
  const list = await fetchRooms(DEFAULT_PARAMS, client);
  return <RoomViewScreen key={id} detail={detail} list={list} />;
}
```

- [ ] **Step 12: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. 철수로 `/rooms/toeic` → "참가하기" → 토스트 "참가했어요", 인원 3/8, 버튼 "참가 완료 / 참가 취소" → "참가 취소" → 다이얼로그 → 확인 → 2/8. `/rooms/spring`(비공개, 철수는 멤버) 은 열리고, 로그아웃 뒤 `/rooms/spring` 은 404. `/rooms/sqld` 는 "승인 대기중" + 내 회색 행. `grep -rn "INITIAL_JOIN\|ROOM_GROUPS\|ROOM_IDS" src/components src/app` 결과 없음.

- [ ] **Step 13: Commit**

```bash
git add src/lib/api/room-view.ts src/lib/api/room-view.test.ts src/data/room-view.ts src/components/ui/ConfirmDialog.tsx src/components/ui/Toast.tsx src/components/room-view src/app/rooms/\[id\]/page.tsx
git commit -m "feat(web): room view from room_get with join/apply/leave/cancel RPCs and confirm dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---
### Task 12: 내 스터디(MyStudy) — `curriculum_get` → `buildTree`, 편집 RPC, `room_get`/`me_studies`, `/my-study` 리다이렉트

가장 큰 태스크다. 순서: ① `model.ts` 를 `NodeDto[]` 입력으로 바꾸고 테스트 → ② 어댑터(`my-study.ts`) + 테스트 → ③ 편집 RPC 훅 → ④ 컴포넌트에서 `TODAY/ME/ROOMS/PLANS/SIDEBAR_GROUPS` 제거 → ⑤ 페이지 2개.

**Files:**
- Modify: `src/components/my-study/model.ts` (전체 교체), `src/data/my-study.ts` (타입 확장), `src/components/my-study/{MyStudyScreen,StudySidebar,StudyHeaderInfo,bits}.tsx`, `src/components/my-study/tabs/{OverviewTab,JoinInfoCard,CurriculumTab,EditPanel,BoardTab,CalendarTab,GanttTab,LeafDetail}.tsx`, `src/components/my-study/state.ts`, `src/app/my-study/page.tsx`, `src/app/my-study/[id]/page.tsx`
- Create: `src/lib/api/my-study.ts`, `src/components/my-study/useCurriculumApi.ts`, `src/components/my-study/MyStudyEmpty.tsx`
- Test: `src/components/my-study/model.test.ts`, `src/lib/api/my-study.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `Curriculum`, `NodeDto`, `NodePatch`, `RoomDetail`, `MeStudies`; Task 2 `useMe`, `useToday`, `TodayProvider`; Task 3 `requireMe`; Task 8 `curOf`, `ddayOf`, `periodLong`, `roundsWindow`, `roundRow`, `rulesOf`, `uiStatus`, `mmdd`, `TASK_TYPE_KO`; Task 11 `fetchRoomDetail`, `cancelApplication`, `Toast`, `ConfirmDialog`.
- Produces:
  ```ts
  // model.ts — 출력 Tree 모양은 유지(roots/nodes/leaves/rootCount/members). 입력만 Curriculum 으로.
  export type Person = { userId: string; name: string; tone: Tone; c: Code };
  export type TreeMember = { userId: string; name: string; tone: Tone; doesTasks: boolean };
  export type Overrides = { titles; descs; dates; typeOv; assignOv: Record<string, string[]>; added; removed; archived };   // assignOv 는 userId[]
  export function buildTree(cur: Curriculum, ov: Overrides, today: string): Tree;   // NodeBase 에 roundId·desc·temp 추가
  export function leafState(asg, sub, s, e, today): LeafState;
  export const ddayLabel: (today: string, e: string) => string;
  export const myCode: (l: LeafNode, meId: string | null) => Code | null;
  export function boardColumn(l: LeafNode, mine: boolean, meId: string | null): BoardCol;
  export function calendarAnchor(leaves: LeafNode[], today: string): string;
  export function ganttRange(roots: ParentNode[], today: string): { start: string; nDays: number };
  export function memberStats(leaves: LeafNode[], userId: string): { done: number; total: number };
  export const tempId: (parentId: string, i: number) => string;      // "2.new0" — 서버 응답으로 교체 전 임시
  // src/lib/api/my-study.ts
  export function fetchCurriculum(slug: string, client?: Db): Promise<Curriculum>;
  export function fetchMyStudies(client?: Db): Promise<MeStudies>;
  export function nodeCreate(slug, parentId: string | null): Promise<Curriculum>;
  export function nodeUpdate(slug, nodeId, patch: NodePatch): Promise<Curriculum>;
  export function nodeDelete(slug, nodeId): Promise<Curriculum>;
  export function nodeArchive(slug, nodeId, archived: boolean): Promise<Curriculum>;
  export function toStudyRoom(d: RoomDetail, tree: Tree, today: string, meId: string): Room;    // src/data/my-study Room
  export function toSidebarGroups(ms: MeStudies, today: string): SidebarGroup[];
  export function patchOf(n: TreeNode, ov: Overrides): NodePatch;     // 편집 패널 "저장" 이 보낼 부분 갱신
  // useCurriculumApi(slug, setCur, update, toast) → { create, remove, archive, save }
  // MyStudyScreen({ detail, curriculum, studies, initialTab?, initialMode?, initialLeaf? })
  //   initialLeaf = 알림 링크 `/my-study/{slug}?task={nodeId}`(D8) — 커리큘럼 탭 + goLeaf 포커스
  ```
- **범위 밖 → plan 06:** 리프 상세의 "제출하기"·제출물 보기(§4.10 — `task_get`·`submission_upsert`·`file_register`), 커리큘럼 들여쓰기/내어쓰기·드래그 정렬(`node_move` — §4.6), 태그 수동 편집(§2.6), 설정 탭(이탈 처리 `member_deactivate*`·알림 설정 `settings_*`). `?task=` 는 이 태스크에서 **리프 포커스까지만** 연결한다(LeafDetail 의 제출 영역 자리에 `{/* plan 06: 제출 */}` 주석).

- [ ] **Step 1: `src/data/my-study.ts` 타입 확장** (상수 `ROOMS`·`PLANS`·`SIDEBAR_GROUPS` 는 남기되 화면은 import 하지 않는다)

```ts
export type RoomId = string;                       // slug (D1)
export const ROOM_IDS: RoomId[] = ["aws", "spring", "sqld", "algo"];
```
바꾸는 타입 전체(필드 추가만 — 기존 필드는 그대로, 나머지 타입·상수는 손대지 않는다):
```ts
export type MemberInfo = { name: string; done: number; total: number; leader?: boolean; me?: boolean; left?: boolean; pending?: boolean; noBar?: boolean; userId?: string; tone?: Tone };
export type CurTask = { title: string; type: TaskType; dates: string; people: [string, TaskStatus][]; /** 이름 → DTO tone */ tones?: Record<string, Tone> };
export type RoundRow = { label: string; title: string; dates: string; state: string; sub: number; total: number; current?: boolean; alt?: string; /** tree.roots 매칭용 */ roundId?: string };
export type NextDue = { title: string; path: string; due: string; dday: string; nodeId?: string };
export type Room = {
  id: RoomId;
  title: string;
  intro: string;
  status: RoomStatus;
  period: string;
  dday: string;
  ddayLong: string;
  joinMode: string;
  visibility: string;
  leader: string;
  /** 그룹장 아바타 색 — DTO leader.tone */
  leaderTone?: Tone;
  tags: RoomTag[];
  capCur: number;
  capMax: number;
  minText: string;
  minOk: boolean;
  members: MemberInfo[];
  cur: { pill: string; title: string; meta: string; tasks: CurTask[] };
  about: string;
  rules: string[];
  rounds: RoundRow[];
  moreRounds: string;
  action: RoomAction;
  next: NextDue | null;
};
export type SidebarItem = { id: RoomId; when: string; left?: number; title?: string; intro?: string };
```

- [ ] **Step 2: 실패하는 테스트** — `src/components/my-study/model.test.ts` (aws 목업 트리를 `NodeDto` 로 옮긴 픽스처. 기대값은 mystudy §3.3: 1주차 5/8=63%, 2주차 1/3=33%, 전체 6/25=24%, 철수 2/6)

```ts
import { describe, expect, it } from "vitest";
import type { Curriculum, CurriculumMember, NodeDto } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { EMPTY_OVERRIDES, buildTree, memberStats, overallPct, unassignedCount } from "./model";

const TODAY = "2026-10-12";
const M = (userId: string, nickname: string, tone: CurriculumMember["tone"], role: CurriculumMember["role"] = "member", status: CurriculumMember["status"] = "active"): CurriculumMember =>
  ({ userId, nickname, tone, role, status, doesTasks: true });
const MEMBERS = [M("u2", "민수", "mint", "leader"), M("u3", "지은", "peach"), M("u1", "철수", "blue"), M("u4", "하나", "lav"), M("u5", "도윤", "slate", "member", "inactive")];
const byId = Object.fromEntries(MEMBERS.map((m) => [m.userId, m]));

const base = (id: string, parentId: string | null, roundId: string, depth: number, sortOrder: number, title: string, s: string, e: string): NodeDto =>
  ({ id, parentId, roundId, depth, sortOrder, label: null, title, descriptionMd: "", startDate: `2026-${s}`, endDate: `2026-${e}`, archived: false, task: null, assigned: 0, submitted: 0, pct: null });
const round = (id: string, n: number, title: string, s: string, e: string): NodeDto => ({ ...base(id, null, id, 2, n, title, s, e), label: `${n}주차` });
const leaf = (id: string, parentId: string, roundId: string, depth: number, order: number, title: string, type: "common" | "designated", s: string, e: string, people: [string, TaskStatus][]): NodeDto => ({
  ...base(id, parentId, roundId, depth, order, title, s, e),
  task: { type, people: people.map(([uid, status]) => ({ userId: uid, nickname: byId[uid].nickname, tone: byId[uid].tone, status })), assigned: people.length, submitted: people.filter(([, st]) => st === "done" || st === "late").length, state: "progress" },
});
const ALL4 = (st: TaskStatus): [string, TaskStatus][] => [["u2", st], ["u3", st], ["u1", st], ["u4", st]];

export const AWS: Curriculum = {
  today: TODAY,
  room: { slug: "aws", status: "active", leaderDoesTasks: true },
  members: MEMBERS,
  nodes: [
    round("1", 1, "IAM·VPC", "10-01", "10-07"),
    leaf("11", "1", "1", 3, 1, "IAM 정책 이해", "common", "10-01", "10-03", [["u2", "done"], ["u3", "late"], ["u1", "done"], ["u4", "missed"]]),
    leaf("12", "1", "1", 3, 2, "VPC 실습", "common", "10-04", "10-07", [["u2", "done"], ["u3", "missed"], ["u1", "done"], ["u4", "missed"]]),
    round("2", 2, "EC2·S3", "10-08", "10-14"),
    leaf("21", "2", "2", 3, 1, "EC2 인스턴스 유형 정리", "designated", "10-08", "10-14", [["u3", "done"], ["u1", "open"]]),
    leaf("22", "2", "2", 3, 2, "S3 스토리지 클래스 발표자료", "designated", "10-10", "10-14", [["u4", "open"]]),
    round("3", 3, "고가용성 아키텍처", "10-15", "10-21"),
    base("31", "3", "3", 3, 1, "로드밸런서 비교", "10-15", "10-21"),
    leaf("311", "31", "3", 4, 1, "ALB vs NLB 실습", "common", "10-15", "10-21", ALL4("planned")),
    round("4", 4, "오토스케일링", "10-22", "10-28"),
    leaf("41", "4", "4", 3, 1, "Auto Scaling 정책 정리", "common", "10-22", "10-28", ALL4("planned")),
    round("5", 5, "데이터베이스", "10-29", "11-04"),
    leaf("51", "5", "5", 3, 1, "RDS·Aurora 비교", "common", "10-29", "11-04", ALL4("planned")),
    leaf("52", "5", "5", 3, 2, "DynamoDB 설계 퀴즈", "designated", "11-01", "11-04", [["u3", "planned"], ["u4", "planned"]]),
  ],
  stats: { overallPct: 24, leafCount: 8, unassignedCount: 0 },
};

describe("buildTree from Curriculum (mystudy §3.3 목업 회귀값)", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, TODAY);
  it("aggregates: roots 63/33/0/0/0, overall 24, 8 leaves, members exclude 이탈자", () => {
    expect(t.roots.map((r) => r.pct)).toEqual([63, 33, 0, 0, 0]);
    expect(t.roots.map((r) => [r.sub, r.asg])).toEqual([[5, 8], [1, 3], [0, 4], [0, 4], [0, 6]]);
    expect(overallPct(t.roots)).toBe(24);
    expect(t.leaves).toHaveLength(8);
    expect(t.members.map((m) => m.name)).toEqual(["민수", "지은", "철수", "하나"]);
    expect(unassignedCount(t.leaves)).toBe(0);
  });
  it("depth, crumb, roundId, roundLabel on a 5단계 leaf", () => {
    const alb = t.leaves.find((l) => l.id === "311")!;
    expect(alb.d).toBe(2);
    expect(alb.crumb).toBe("3주차 고가용성 아키텍처 › 로드밸런서 비교");
    expect(alb.roundId).toBe("3");
    expect(alb.roundLabel).toBe("3주차");
    expect(alb.state).toBe("planned");
    expect(t.leaves.find((l) => l.id === "11")!.state).toBe("delayed");
    expect(t.leaves.find((l) => l.id === "21")!.state).toBe("progress");
  });
  it("memberStats by userId: 철수 2/6", () => {
    expect(memberStats(t.leaves, "u1")).toEqual({ done: 2, total: 6 });
    expect(memberStats(t.leaves, "u4")).toEqual({ done: 0, total: 7 });
  });
  it("pre-order nodes", () => {
    expect(t.nodes.slice(0, 5).map((n) => n.id)).toEqual(["1", "11", "12", "2", "21"]);
  });
});

describe("buildTree with overrides (optimistic edits)", () => {
  it("assignOv narrows designated assignees by userId, keeping known codes", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, assignOv: { "21": ["u1"] } }, TODAY);
    expect(t.leaves.find((l) => l.id === "21")!.people).toEqual([{ userId: "u1", name: "철수", tone: "blue", c: "O" }]);
  });
  it("typeOv 공통 assigns every doer, fresh codes O/P by date", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, typeOv: { "21": "공통" } }, TODAY);
    const l = t.leaves.find((x) => x.id === "21")!;
    expect(l.people.map((p) => [p.name, p.c])).toEqual([["민수", "O"], ["지은", "D"], ["철수", "O"], ["하나", "O"]]);
    expect([l.sub, l.asg]).toEqual([1, 4]);
  });
  it("added child shows as temp leaf, removed hides, archived excludes from totals", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, added: { "2": ["새 과제"] }, removed: { "22": true }, archived: { "1": true } }, TODAY);
    const r2 = t.roots[1];
    expect(r2.childCount).toBe(3);
    expect(r2.kids.map((k) => k.id)).toEqual(["21", "2.new0"]);
    expect((r2.kids[1] as { people: unknown[] }).people).toHaveLength(4);
    expect(t.roots[0].archived).toBe(true);
    expect(overallPct(t.roots)).toBe(5); // 1주차 보관 제외: 2주차 1/6 (EC2 1/2 + 새 과제 0/4, S3 삭제) + 0/4 + 0/4 + 0/6 = 1/20
  });
  it("added round appends a temp root after the last round", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, added: { root: ["새 회차"] } }, TODAY);
    expect(t.rootCount).toBe(6);
    expect(t.roots[5]).toMatchObject({ id: "root.new0", label: "6주차", s: "2026-11-05", e: "2026-11-11", kids: [] });   // 서버 기본 라벨 "{n}주차"(D14)와 같게 — 응답 후 깜빡임 없음
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/components/my-study/model.test.ts`
Expected: FAIL — `buildTree` 가 `Plan` 을 기대해 `plan.tree` undefined 로 TypeError.

- [ ] **Step 4: `model.ts` 전체 교체**

```ts
/**
 * 내 스터디 화면의 순수 로직 — Curriculum DTO(전위 순서 NodeDto[]) → 트리, 편집 오버라이드, 상태 판정, 집계, 캘린더/간트 배치.
 * React 와 무관하게 입력 → 출력만 한다. "오늘"과 "나"는 인자로 받는다.
 */
import { addDays, dday, diffDays, md, parseISO } from "@/lib/date";
import { TASK_TYPE_KO } from "@/lib/api/format";
import type { Curriculum, NodeDto } from "@/lib/api/types";
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import type { TaskType } from "@/data/my-study";

/* ---------------- 코드 / 상태 ---------------- */

export type Code = "D" | "L" | "M" | "O" | "P";
export type LeafState = "unassigned" | "complete" | "planned" | "delayed" | "progress";
export type Person = { userId: string; name: string; tone: Tone; c: Code };
export type TreeMember = { userId: string; name: string; tone: Tone; doesTasks: boolean };

export const CODE_LABEL: Record<Code, string> = { D: "기한내 제출", L: "지각 제출", M: "미제출", O: "진행중", P: "예정" };
export const CODE_COLOR: Record<Code, string> = { D: "#1A7F55", L: "#8A5A00", M: "#C0392B", O: "#3A4452", P: "#5B6675" };
export const CODE_STATUS: Record<Code, TaskStatus> = { D: "done", L: "late", M: "missed", O: "open", P: "planned" };
export const STATUS_CODE: Record<TaskStatus, Code> = { done: "D", late: "L", missed: "M", open: "O", planned: "P" };
export const CODE_STATE: Record<Code, LeafState> = { D: "complete", L: "complete", M: "delayed", O: "progress", P: "planned" };

/* ---------------- 편집 오버라이드 (낙관적 갱신용) ---------------- */

export type Overrides = {
  titles: Record<string, string>;
  descs: Record<string, string>;
  dates: Record<string, { s?: string; e?: string }>;
  typeOv: Record<string, TaskType>;
  /** 지정 과제 담당자 userId[] */
  assignOv: Record<string, string[]>;
  /** 부모 id 또는 'root' → 추가된 제목 배열 (서버 응답으로 교체되기 전까지) */
  added: Record<string, string[]>;
  removed: Record<string, boolean>;
  archived: Record<string, boolean>;
};

export const EMPTY_OVERRIDES: Overrides = { titles: {}, descs: {}, dates: {}, typeOv: {}, assignOv: {}, added: {}, removed: {}, archived: {} };

/** 추가(미저장) 노드의 임시 id */
export const tempId = (parentId: string, i: number) => `${parentId}.new${i}`;
const TEMP_ORDER = 10_000;

/* ---------------- 트리 노드 ---------------- */

type NodeBase = {
  id: string;
  /** 속한 회차(루트) id — 보드 회차 필터 */
  roundId: string;
  /** depth: 루트 0 (= DTO depth − 2) */
  d: number;
  title: string;
  desc: string;
  s: string;
  e: string;
  archived: boolean;
  /** "1주차 IAM·VPC › 로드밸런서 비교" */
  crumb: string;
  roundLabel: string | null;
  /** 서버에 아직 없는 임시 노드 */
  temp: boolean;
};

export type LeafNode = NodeBase & { leaf: true; type: TaskType; people: Person[]; asg: number; sub: number; state: LeafState };
export type ParentNode = NodeBase & { leaf: false; label: string | null; kids: TreeNode[]; childCount: number; asg: number; sub: number; pct: number };
export type TreeNode = LeafNode | ParentNode;

export type Tree = {
  roots: ParentNode[];
  /** 전위 순회 전체 (삭제 제외) */
  nodes: TreeNode[];
  /** 보관 제외 리프 */
  leaves: LeafNode[];
  /** 추가 회차 포함 루트 수 */
  rootCount: number;
  /** 활성 참가자 (이탈자 제외) */
  members: TreeMember[];
};

const after = (a: string, b: string) => parseISO(a) > parseISO(b);
const before = (a: string, b: string) => parseISO(a) < parseISO(b);

export function leafState(asg: number, sub: number, s: string, e: string, today: string): LeafState {
  if (asg === 0) return "unassigned";
  if (sub === asg) return "complete";
  if (after(s, today)) return "planned";
  if (before(e, today)) return "delayed";
  return "progress";
}

/** Curriculum + 오버라이드 → 집계된 트리. 서버 사람별 코드를 그대로 쓰고, 유형/담당자 오버라이드가 있는 리프만 다시 계산한다. */
export function buildTree(cur: Curriculum, ov: Overrides, today: string): Tree {
  const members: TreeMember[] = cur.members.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.nickname, tone: m.tone, doesTasks: m.doesTasks }));
  const doers = members.filter((m) => m.doesTasks);
  const byParent = new Map<string | null, NodeDto[]>();
  for (const n of cur.nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const nodes: TreeNode[] = [];
  const fresh = (s: string): Code => (s > today ? "P" : "O");

  const tempChild = (p: NodeDto, title: string, i: number): NodeDto => ({
    id: tempId(p.id, i), parentId: p.id, roundId: p.depth === 2 ? p.id : p.roundId, depth: p.depth + 1, sortOrder: TEMP_ORDER + i, label: null, title, descriptionMd: "",
    startDate: p.startDate, endDate: p.endDate, archived: false, task: { type: "common", people: [], assigned: 0, submitted: 0, state: "unassigned" }, assigned: 0, submitted: 0, pct: null,
  });

  const walk = (n: NodeDto, crumbs: string[], rl: string | null, parentArchived: boolean, temp: boolean): TreeNode | null => {
    if (ov.removed[n.id]) return null;
    const title = ov.titles[n.id] ?? n.title;
    const desc = ov.descs[n.id] ?? n.descriptionMd;
    const dOv = ov.dates[n.id] ?? {};
    const s = dOv.s || n.startDate;
    const e = dOv.e || n.endDate;
    const archived = ov.archived[n.id] ?? (n.archived || parentArchived);
    const d = n.depth - 2;
    const roundId = d === 0 ? n.id : n.roundId;
    const kidsRaw = [...(byParent.get(n.id) ?? []), ...(ov.added[n.id] ?? []).map((t, i) => tempChild(n, t, i))];
    const base = { id: n.id, roundId, d, title, desc, s, e, archived, crumb: crumbs.join(" › "), temp };

    if (n.task && kidsRaw.length === 0) {
      const type: TaskType = ov.typeOv[n.id] ?? TASK_TYPE_KO[n.task.type];
      const known = new Map(n.task.people.map((p) => [p.userId, STATUS_CODE[p.status]]));
      const recompute = temp || n.id in ov.typeOv || n.id in ov.assignOv;
      let people: Person[];
      if (!recompute) people = n.task.people.map((p) => ({ userId: p.userId, name: p.nickname, tone: p.tone, c: STATUS_CODE[p.status] }));
      else {
        const chosen = type === "공통" ? doers : ov.assignOv[n.id] ? doers.filter((m) => ov.assignOv[n.id].includes(m.userId)) : doers.filter((m) => known.has(m.userId));
        people = chosen.map((m) => ({ userId: m.userId, name: m.name, tone: m.tone, c: known.get(m.userId) ?? fresh(s) }));
      }
      const asg = people.length;
      const sub = people.filter((p) => p.c === "D" || p.c === "L").length;
      const leaf: LeafNode = { ...base, leaf: true, type, people, asg, sub, state: leafState(asg, sub, s, e, today), roundLabel: rl };
      nodes.push(leaf);
      return leaf;
    }

    const roundLabel = d === 0 ? n.label : rl;
    const node: ParentNode = { ...base, leaf: false, label: n.label, roundLabel, kids: [], childCount: kidsRaw.length, asg: 0, sub: 0, pct: 0 };
    nodes.push(node);
    const here = d === 0 ? `${n.label} ${title}` : title;
    kidsRaw.forEach((c) => {
      const k = walk(c, [...crumbs, here], roundLabel, archived, temp || c.sortOrder >= TEMP_ORDER);
      if (k) node.kids.push(k);
    });
    const live = node.kids.filter((k) => !k.archived);
    node.asg = live.reduce((a, k) => a + k.asg, 0);
    node.sub = live.reduce((a, k) => a + k.sub, 0);
    node.pct = node.asg ? Math.round((node.sub / node.asg) * 100) : 0;
    return node;
  };

  const baseRoots = byParent.get(null) ?? [];
  const lastE = baseRoots.length ? baseRoots[baseRoots.length - 1].endDate : today;
  const tempRoots: NodeDto[] = (ov.added.root ?? []).map((t, i) => {
    const s = addDays(lastE, 1 + i * 7);
    const id = tempId("root", i);
    return { id, parentId: null, roundId: id, depth: 2, sortOrder: TEMP_ORDER + i, label: `${baseRoots.length + i + 1}주차`, title: t, descriptionMd: "", startDate: s, endDate: addDays(s, 6), archived: false, task: null, assigned: 0, submitted: 0, pct: null };
  });
  const rootList = [...baseRoots, ...tempRoots];
  const roots: ParentNode[] = [];
  rootList.forEach((n) => {
    const rt = walk(n, [], null, false, n.sortOrder >= TEMP_ORDER);
    if (rt && !rt.leaf) roots.push(rt);
  });
  const leaves = nodes.filter((n): n is LeafNode => n.leaf && !n.archived);
  return { roots, nodes, leaves, rootCount: rootList.length, members };
}

/** 접힘 상태를 반영한 보이는 행 (전위 순서) */
export function visibleNodes(roots: ParentNode[], closed: Record<string, boolean>): TreeNode[] {
  const out: TreeNode[] = [];
  const add = (n: TreeNode) => {
    out.push(n);
    if (!n.leaf && !closed[n.id]) n.kids.forEach(add);
  };
  roots.forEach(add);
  return out;
}

export function allParentsClosed(nodes: TreeNode[]): Record<string, boolean> {
  const c: Record<string, boolean> = {};
  nodes.forEach((n) => {
    if (!n.leaf) c[n.id] = true;
  });
  return c;
}

/** 전체 = 루트 합계 기준 (보관 루트 제외). asg 0 이면 null. */
export function overallPct(roots: ParentNode[]): number | null {
  const live = roots.filter((r) => !r.archived);
  const asg = live.reduce((a, r) => a + r.asg, 0);
  const sub = live.reduce((a, r) => a + r.sub, 0);
  return asg ? Math.round((sub / asg) * 100) : null;
}

export const unassignedCount = (leaves: LeafNode[]) => leaves.filter((l) => l.type === "지정" && l.asg === 0).length;

/** 참가자 한 명의 제출/담당 (보관 제외 리프, userId 기준) */
export function memberStats(leaves: LeafNode[], userId: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  leaves.forEach((l) => {
    const p = l.people.find((x) => x.userId === userId);
    if (!p) return;
    total += 1;
    if (p.c === "D" || p.c === "L") done += 1;
  });
  return { done, total };
}

export const findNode = (nodes: TreeNode[], id: string | null) => (id ? (nodes.find((n) => n.id === id) ?? null) : null);

export const ddayLabel = (today: string, e: string) => dday(today, e);

/* ---------------- 보드 ---------------- */

export type BoardCol = "todo" | "doing" | "done";

export const myCode = (l: LeafNode, meId: string | null): Code | null => (meId ? (l.people.find((p) => p.userId === meId)?.c ?? null) : null);

export function boardColumn(l: LeafNode, mine: boolean, meId: string | null): BoardCol {
  if (mine) {
    const c = myCode(l, meId);
    return c === "P" ? "todo" : c === "D" || c === "L" ? "done" : "doing";
  }
  return l.state === "planned" || l.state === "unassigned" ? "todo" : l.state === "complete" ? "done" : "doing";
}

/* ---------------- 캘린더 ---------------- */

export type CalMode = "month" | "week";

/** today 가 과제 범위 안이면 today, 아니면 첫 과제 시작일 */
export function calendarAnchor(leaves: LeafNode[], today: string): string {
  if (leaves.length === 0) return today;
  const minS = leaves.reduce((a, l) => (l.s < a ? l.s : a), leaves[0].s);
  const maxE = leaves.reduce((a, l) => (l.e > a ? l.e : a), leaves[0].e);
  return today >= minS && today <= maxE ? today : minS;
}

const dow = (iso: string) => new Date(parseISO(iso)).getUTCDay();
export const weekStartOf = (iso: string) => addDays(iso, -dow(iso));

export function calendarGrid(anchor: string, mode: CalMode): { gridStart: string; rows: number; label: string; month: number } {
  const y = +anchor.slice(0, 4);
  const mo = +anchor.slice(5, 7);
  if (mode === "week") {
    const gridStart = weekStartOf(anchor);
    return { gridStart, rows: 1, label: `${md(gridStart)} – ${md(addDays(gridStart, 6))}`, month: mo };
  }
  const first = `${y}-${String(mo).padStart(2, "0")}-01`;
  const lead = dow(first);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { gridStart: addDays(first, -lead), rows: Math.ceil((lead + dim) / 7), label: `${y}년 ${mo}월`, month: mo };
}

export function shiftAnchor(anchor: string, mode: CalMode, dir: 1 | -1): string {
  if (mode === "week") return addDays(anchor, dir * 7);
  const y = +anchor.slice(0, 4);
  const mo = +anchor.slice(5, 7) - 1 + dir;
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
}

export type CalSeg = { l: LeafNode; col: number; span: number; isStart: boolean; isEnd: boolean; lane: number };

export function weekSegments(leaves: LeafNode[], weekStart: string): CalSeg[] {
  const ws = parseISO(weekStart);
  const we = ws + 6 * 86400000;
  const segs = leaves
    .filter((l) => parseISO(l.s) <= we && parseISO(l.e) >= ws)
    .map((l) => {
      const s = Math.max(parseISO(l.s), ws);
      const e = Math.min(parseISO(l.e), we);
      return { l, col: Math.round((s - ws) / 86400000), span: Math.round((e - s) / 86400000) + 1, isStart: s === parseISO(l.s), isEnd: e === parseISO(l.e), lane: 0 };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span);
  return packLanes(segs);
}

export function packLanes<T extends { col: number; span: number; lane: number }>(segs: T[]): T[] {
  const laneEnd: number[] = [];
  segs.forEach((sg) => {
    let ln = laneEnd.findIndex((x) => x < sg.col);
    if (ln === -1) {
      ln = laneEnd.length;
      laneEnd.push(-1);
    }
    laneEnd[ln] = sg.col + sg.span - 1;
    sg.lane = ln;
  });
  return segs;
}

/* ---------------- 간트 ---------------- */

export function ganttRange(roots: ParentNode[], today: string): { start: string; nDays: number } {
  if (roots.length === 0) return { start: weekStartOf(today), nDays: 7 };
  const rS = roots.reduce((a, r) => (r.s < a ? r.s : a), roots[0].s);
  const rE = roots.reduce((a, r) => (r.e > a ? r.e : a), roots[0].e);
  const start = weekStartOf(rS);
  const end = addDays(rE, 6 - dow(rE));
  return { start, nDays: diffDays(start, end) + 1 };
}
```

- [ ] **Step 5: 통과 확인** (컴포넌트 tsc 에러는 Step 11 까지 남는다 — vitest 만 확인)

Run: `npx vitest run src/components/my-study/model.test.ts`
Expected: 8 passed

- [ ] **Step 6: 실패하는 테스트** — `src/lib/api/my-study.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_OVERRIDES, buildTree } from "@/components/my-study/model";
import { AWS } from "@/components/my-study/model.test";
import type { MeStudies, RoomDetail } from "./types";
import { patchOf, toSidebarGroups, toStudyRoom } from "./my-study";

const TODAY = "2026-10-12";
const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"]) => ({ userId, nickname, tone });
const aws: RoomDetail = {
  today: TODAY, id: "6", slug: "aws", title: "AWS SAA 자격증 3개월 완주", intro: "IAM부터", descriptionMd: "소개", rulesMd: "- 마감은 23:59\n- 2회 연속 미제출",
  status: "active", archived: false, isPublic: true, joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
  leader: P("u2", "민수", "mint"), leaderDoesTasks: true, tags: [{ slug: "aws", label: "AWS", tone: "mint", auto: true }],
  members: [
    { ...P("u2", "민수", "mint"), role: "leader", status: "active", joinedAt: null }, { ...P("u3", "지은", "peach"), role: "member", status: "active", joinedAt: null },
    { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }, { ...P("u4", "하나", "lav"), role: "member", status: "active", joinedAt: null },
    { ...P("u5", "도윤", "slate"), role: "member", status: "inactive", joinedAt: null },
  ],
  me: { state: "active" },
  currentRound: { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 2, assigned: 3, submitted: 1, pct: 33, tasks: [
    { id: "21", title: "EC2 인스턴스 유형 정리", type: "designated", startDate: "2026-10-08", endDate: "2026-10-14", people: [{ ...P("u3", "지은", "peach"), status: "done" }, { ...P("u1", "철수", "blue"), status: "open" }] },
  ] },
  rounds: [
    { id: "1", label: "1주차", title: "IAM·VPC", startDate: "2026-10-01", endDate: "2026-10-07", leafCount: 2, assigned: 8, submitted: 5, pct: 63 },
    { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 2, assigned: 3, submitted: 1, pct: 33 },
    { id: "3", label: "3주차", title: "고가용성 아키텍처", startDate: "2026-10-15", endDate: "2026-10-21", leafCount: 1, assigned: 4, submitted: 0, pct: 0 },
    { id: "4", label: "4주차", title: "오토스케일링", startDate: "2026-10-22", endDate: "2026-10-28", leafCount: 1, assigned: 4, submitted: 0, pct: 0 },
    { id: "5", label: "5주차", title: "데이터베이스", startDate: "2026-10-29", endDate: "2026-11-04", leafCount: 2, assigned: 6, submitted: 0, pct: 0 },
  ],
  stats: { roundCount: 5, leafCount: 8, commonCount: 5, designatedCount: 3, totalAssignments: 25, totalSubmissions: 6, overallPct: 24, unassignedCount: 0, startWeekdays: [4] },
  myProgress: { submitted: 2, assigned: 6, nextDue: { nodeId: "21", title: "EC2 인스턴스 유형 정리", roundLabel: "2주차", dueDate: "2026-10-14" } },
  invite: null, pendingCount: 0,
};
const tree = buildTree(AWS, EMPTY_OVERRIDES, TODAY);

describe("toStudyRoom (mystudy §1.2–1.4)", () => {
  const r = toStudyRoom(aws, tree, TODAY, "u1");
  it("header fields", () => {
    expect(r).toMatchObject({ id: "aws", status: "active", period: "2026.10.01(목) – 12.31(목)", dday: "D-80", ddayLong: "종료까지 D-80", joinMode: "그룹장 승인 후 참가", visibility: "공개", leader: "민수", leaderTone: "mint", capCur: 4, capMax: 6, minText: "최소 3명 · 충족", minOk: true, action: "joined" });
    expect(r.rules).toEqual(["마감은 23:59", "2회 연속 미제출"]);
  });
  it("members incl. 이탈·me flags by userId", () => {
    expect(r.members.map((m) => [m.name, !!m.me, !!m.left])).toEqual([["민수", false, false], ["지은", false, false], ["철수", true, false], ["하나", false, false], ["도윤", false, true]]);
    expect(r.members[0]).toMatchObject({ leader: true, noBar: false, userId: "u2", tone: "mint" });
  });
  it("current round card and next due", () => {
    expect(r.cur.pill).toBe("2주차 · 진행중");
    expect(r.cur.meta).toBe("10.08(목) – 10.14(수) · 마감 D-2");
    expect(r.cur.tasks[0]).toEqual({ title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14", people: [["지은", "done"], ["철수", "open"]], tones: { 지은: "peach", 철수: "blue" } });
    expect(r.next).toEqual({ nodeId: "21", title: "EC2 인스턴스 유형 정리", path: "2주차 EC2·S3 · 지정 과제", due: "10.14(수) 23:59 마감", dday: "D-2" });
  });
  it("rounds window with roundId for tree lookup", () => {
    expect(r.rounds.map((x) => [x.label, x.state, x.roundId, !!x.current])).toEqual([["1주차", "기간 종료", "1", false], ["2주차", "진행중", "2", true], ["3주차", "예정", "3", false]]);
    expect(r.moreRounds).toBe("이후 2개 회차가 더 있어요 · 커리큘럼 탭에서 전체 보기");
  });
  it("sqld pending: minText 2명 더 필요, action pending, recruit rounds use alt", () => {
    const sqld: RoomDetail = { ...aws, slug: "sqld", status: "recruit", joinMode: "approval", startDate: "2026-10-26", endDate: "2026-11-22", maxMembers: 5, minMembers: 3, memberCount: 1, leader: P("u9", "가은", "amber"), leaderDoesTasks: false,
      members: [{ ...P("u9", "가은", "amber"), role: "leader", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "pending", joinedAt: null }], me: { state: "pending" }, currentRound: null, myProgress: null,
      rounds: [{ id: "s1", label: "1주차", title: "데이터 모델링의 이해", startDate: "2026-10-26", endDate: "2026-11-01", leafCount: 2, assigned: 0, submitted: 0, pct: null }] };
    const s = toStudyRoom(sqld, tree, TODAY, "u1");
    expect(s).toMatchObject({ minText: "최소 3명 · 2명 더 필요해요", minOk: false, action: "pending", dday: "D-14", next: null });
    expect(s.members).toEqual([{ name: "가은", done: 0, total: 0, leader: true, me: false, left: false, pending: false, noBar: true, userId: "u9", tone: "amber" }, { name: "철수", done: 0, total: 0, leader: false, me: true, left: false, pending: true, noBar: false, userId: "u1", tone: "blue" }]);
    expect(s.rounds[0]).toMatchObject({ state: "예정", alt: "과제 2개", sub: 0, total: 0 });
  });
  it("ended + member → closed; no minMembers → empty minText", () => {
    expect(toStudyRoom({ ...aws, status: "ended", minMembers: null }, tree, TODAY, "u1")).toMatchObject({ action: "closed", minText: "", minOk: true });
  });
  it("designated task with 0 assignees in the current round → people [] (OverviewTab shows 담당자 미정, no NaN — S15)", () => {
    const cr = aws.currentRound!;
    const noOne = { id: "23", title: "담당자 없는 과제", type: "designated" as const, startDate: "2026-10-08", endDate: "2026-10-14", people: [] };
    const r0 = toStudyRoom({ ...aws, currentRound: { ...cr, tasks: [...cr.tasks!, noOne] } }, tree, TODAY, "u1");
    expect(r0.cur.tasks[1]).toEqual({ title: "담당자 없는 과제", type: "지정", dates: "10.08 – 10.14", people: [], tones: {} });
  });
});

describe("toSidebarGroups (mystudy §1.1)", () => {
  it("labels, when, left", () => {
    const ms: MeStudies = { today: TODAY, groups: [
      { kind: "active", items: [{ slug: "aws", title: "AWS", intro: "a", membership: "joined", when: { kind: "deadline", date: "2026-10-14" } }, { slug: "spring", title: "Spring", intro: "s", membership: "joined", when: { kind: "deadline", date: "2026-10-18" } }] },
      { kind: "recruit", items: [{ slug: "sqld", title: "SQLD", intro: "q", membership: "pending", when: { kind: "start", date: "2026-10-26" } }] },
      { kind: "ended", items: [{ slug: "algo", title: "알고", intro: "l", membership: "joined", when: { kind: "end", date: "2026-09-30" } }] },
    ] };
    expect(toSidebarGroups(ms, TODAY)).toEqual([
      { label: "진행중", items: [{ id: "aws", title: "AWS", intro: "a", when: "10.14 마감", left: 2 }, { id: "spring", title: "Spring", intro: "s", when: "10.18 마감", left: 6 }] },
      { label: "모집중 · 신청한 방", items: [{ id: "sqld", title: "SQLD", intro: "q", when: "10.26 시작" }] },
      { label: "종료", items: [{ id: "algo", title: "알고", intro: "l", when: "09.30 종료" }] },
    ]);
    expect(toSidebarGroups({ today: TODAY, groups: [{ kind: "ended", items: [] }] }, TODAY)).toEqual([]);
  });
});

describe("patchOf", () => {
  it("collects only overridden fields of a node", () => {
    const n = tree.nodes.find((x) => x.id === "21")!;
    expect(patchOf(n, { ...EMPTY_OVERRIDES, titles: { "21": "EC2 정리" }, dates: { "21": { e: "2026-10-15" } }, typeOv: { "21": "공통" } })).toEqual({ title: "EC2 정리", endDate: "2026-10-15", taskType: "common" });
    expect(patchOf(n, { ...EMPTY_OVERRIDES, assignOv: { "21": ["u1"] }, descs: { "21": "설명" } })).toEqual({ assigneeIds: ["u1"], descriptionMd: "설명" });
    expect(patchOf(n, EMPTY_OVERRIDES)).toEqual({});
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/lib/api/my-study.test.ts`
Expected: FAIL — `Cannot find module './my-study'`

- [ ] **Step 8: `src/lib/api/my-study.ts`**

```ts
import { rpc, type Db } from "@/lib/api/errors";
import { curOf, ddayOf, mmdd, periodLong, roundRow, roundsWindow, rulesOf, uiStatus } from "@/lib/api/format";
import type { Curriculum, MeStudies, NodePatch, RoomDetail } from "@/lib/api/types";
import { dday, diffDays, weekdayKo } from "@/lib/date";
import type { MemberInfo, NextDue, Room, RoundRow, SidebarGroup } from "@/data/my-study";
import type { Overrides, Tree, TreeNode } from "@/components/my-study/model";

export const fetchCurriculum = (slug: string, client?: Db) => rpc<Curriculum>("curriculum_get", { p_slug: slug, p_include_archived: true }, client);
export const fetchMyStudies = (client?: Db) => rpc<MeStudies>("me_studies", {}, client);
export const nodeCreate = (slug: string, parentId: string | null) => rpc<Curriculum>("node_create", { p_slug: slug, p_parent_id: parentId });
export const nodeUpdate = (slug: string, nodeId: string, patch: NodePatch) => rpc<Curriculum>("node_update", { p_slug: slug, p_node_id: nodeId, p_patch: patch });
export const nodeDelete = (slug: string, nodeId: string) => rpc<Curriculum>("node_delete", { p_slug: slug, p_node_id: nodeId });
export const nodeArchive = (slug: string, nodeId: string, archived: boolean) => rpc<Curriculum>(archived ? "node_archive" : "node_unarchive", { p_slug: slug, p_node_id: nodeId });

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

/** room_get → 내 스터디 Room (mystudy §1.2–1.4). 숫자 집계(members done/total, rounds sub/total)는 화면이 tree 로 덮어쓴다. */
export function toStudyRoom(d: RoomDetail, tree: Tree, today: string, meId: string): Room {
  const dd = ddayOf(d.status, today, d.startDate, d.endDate);
  const cur = curOf(d, today);
  const win = roundsWindow(d.rounds, d.status, today);
  const curId = d.currentRound?.id ?? null;
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
  const action: Room["action"] = d.status === "ended" ? "closed" : d.me?.state === "active" || d.me?.state === "leader" ? "joined" : d.me?.state === "pending" ? "pending" : "closed";
  return {
    id: d.slug, title: d.title, intro: d.intro, status: uiStatus(d.status),
    period: periodLong(d.startDate, d.endDate), dday: dd.short, ddayLong: dd.long,
    joinMode: d.joinMode === "approval" ? "그룹장 승인 후 참가" : "바로 참가",
    visibility: d.isPublic ? "공개" : "비공개 · 초대 링크로만 참가",
    leader: d.leader.nickname, leaderTone: d.leader.tone, tags: d.tags.map((t) => ({ label: t.label, tone: t.tone, auto: t.auto })),
    capCur: d.memberCount, capMax: d.maxMembers, ...minTextOf(d), members,
    cur: { pill: cur.pill, title: cur.title, meta: cur.meta, tasks: cur.tasks.map((t) => ({ title: t.title, type: t.type, dates: t.dates, people: t.people.map((p) => [p.name, p.status] as [string, typeof p.status]), tones: Object.fromEntries(t.people.map((p) => [p.name, p.tone])) })) },
    about: d.descriptionMd, rules: rulesOf(d.rulesMd), rounds,
    moreRounds: win.more ? `${win.more} · 커리큘럼 탭에서 전체 보기` : "",
    action, next: nextOf(d, tree, today),
  };
}

const GROUP_LABEL = { active: "진행중", recruit: "모집중 · 신청한 방", ended: "종료" } as const;

export function toSidebarGroups(ms: MeStudies, today: string): SidebarGroup[] {
  return ms.groups
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      label: GROUP_LABEL[g.kind],
      items: g.items.map((it) => {
        const w = it.when;
        const when = w.kind === "deadline" ? `${mmdd(w.date)} 마감` : w.kind === "start" ? `${mmdd(w.date)} 시작` : `${mmdd(w.date)} 종료`;
        return w.kind === "deadline" ? { id: it.slug, title: it.title, intro: it.intro, when, left: diffDays(today, w.date) } : { id: it.slug, title: it.title, intro: it.intro, when };
      }),
    }));
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
```

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/lib/api/my-study.test.ts`
Expected: my-study 9 passed + import 된 `model.test.ts` 의 describe 도 함께 실행(`AWS` 를 export 하므로 — 정상). 숫자보다 FAIL 0 을 본다.

- [ ] **Step 10: `useCurriculumApi.ts` + `state.ts`** — 구조 변경은 즉시 RPC(낙관적 Overrides → 응답으로 교체), 내용 변경은 "저장" 1회(D9).

`state.ts`: `patchOv` 는 그대로. `ScreenState` 에 변경 없음.

```ts
// src/components/my-study/useCurriculumApi.ts
"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toApiError } from "@/lib/api/errors";
import { nodeArchive, nodeCreate, nodeDelete, nodeUpdate, patchOf } from "@/lib/api/my-study";
import type { Curriculum, NodePatch } from "@/lib/api/types";
import type { ToastMsg } from "@/components/ui/Toast";
import { EMPTY_OVERRIDES, type Overrides, type TreeNode } from "./model";
import type { Update } from "./state";

export type CurriculumApi = {
  create: (parentId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  archive: (id: string, on: boolean) => Promise<void>;
  save: (n: TreeNode, ov: Overrides) => Promise<void>;
};

const dropKey = <T,>(rec: Record<string, T>, key: string) => {
  const { [key]: _omit, ...rest } = rec; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

export function useCurriculumApi(slug: string, setCur: Dispatch<SetStateAction<Curriculum>>, update: Update, toast: (m: ToastMsg) => void): CurriculumApi {
  const router = useRouter();

  const fail = useCallback(
    (e: unknown) => {
      const err = toApiError(e);
      toast({ text: err.message, tone: "bad" });
      if (err.code === "ROOM_NOT_EDITABLE" || err.code === "NOT_LEADER") update({ curMode: "view", editSel: null });
    },
    [toast, update],
  );

  const create = useCallback(
    async (parentId: string | null) => {
      const key = parentId ?? "root";
      update((p) => ({ ov: { ...p.ov, added: { ...p.ov.added, [key]: [...(p.ov.added[key] ?? []), parentId ? "새 과제" : "새 회차"] } }, closed: parentId ? { ...p.closed, [parentId]: false } : p.closed, confirm: false, saved: "" }));
      try {
        const cur = await nodeCreate(slug, parentId);
        const created = cur.nodes.filter((n) => n.parentId === parentId).sort((a, b) => b.sortOrder - a.sortOrder)[0];
        setCur(cur);
        update((p) => ({ ov: { ...p.ov, added: dropKey(p.ov.added, key) }, editSel: created?.id ?? null }));
      } catch (e) {
        update((p) => ({ ov: { ...p.ov, added: dropKey(p.ov.added, key) } }));
        fail(e);
      }
    },
    [slug, setCur, update, fail],
  );

  const remove = useCallback(
    async (id: string) => {
      update((p) => ({ ov: { ...p.ov, removed: { ...p.ov.removed, [id]: true } }, editSel: null, confirm: false }));
      try {
        setCur(await nodeDelete(slug, id));
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) } }));
      } catch (e) {
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) }, editSel: id }));
        fail(e);
      }
    },
    [slug, setCur, update, fail],
  );

  const archive = useCallback(
    async (id: string, on: boolean) => {
      update((p) => ({ ov: { ...p.ov, archived: { ...p.ov.archived, [id]: on } }, confirm: false, saved: on ? "보관했어요 · 제출물은 그대로 남아요" : "보관을 해제했어요" }));
      try {
        setCur(await nodeArchive(slug, id, on));
      } catch (e) {
        fail(e);
      } finally {
        update((p) => ({ ov: { ...p.ov, archived: dropKey(p.ov.archived, id) } }));
      }
    },
    [slug, setCur, update, fail],
  );

  const save = useCallback(
    async (n: TreeNode, ov: Overrides) => {
      const patch: NodePatch = patchOf(n, ov);
      if (Object.keys(patch).length === 0) return update({ saved: "바뀐 내용이 없어요" });
      try {
        const cur = await nodeUpdate(slug, n.id, patch);
        setCur(cur);
        update((p) => ({
          ov: { ...p.ov, titles: dropKey(p.ov.titles, n.id), descs: dropKey(p.ov.descs, n.id), dates: dropKey(p.ov.dates, n.id), typeOv: dropKey(p.ov.typeOv, n.id), assignOv: dropKey(p.ov.assignOv, n.id) },
          saved: "저장했어요 · 태그를 자동으로 다시 골랐어요",
        }));
        router.refresh(); // 자동 태그가 바뀌었을 수 있다(D9)
      } catch (e) {
        fail(e);
      }
    },
    [slug, setCur, update, fail, router],
  );

  return { create, remove, archive, save };
}

export const NO_API: CurriculumApi = { create: async () => undefined, remove: async () => undefined, archive: async () => undefined, save: async () => undefined };
export { EMPTY_OVERRIDES };
```

- [ ] **Step 11: 컴포넌트 수정 (TODAY/ME/목업 상수 제거)** — 각 파일에서 바꿀 곳만 적는다. 공통: `import { TODAY } from "@/lib/routes"` → `import { useToday } from "@/lib/today"` 후 컴포넌트 안에서 `const today = useToday();`, `import { ME }` → `import { useMe } from "@/lib/me"` 후 `const meId = useMe()?.id ?? null;`.

`MyStudyScreen.tsx` (전체 교체):
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { toSidebarGroups, toStudyRoom } from "@/lib/api/my-study";
import { cancelApplication } from "@/lib/api/room-view";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { buildTree } from "./model";
import { INITIAL_STATE, goLeafPatch, type CurMode, type Patch, type ScreenState } from "./state";
import { StudySidebar } from "./StudySidebar";
import { StudyHeaderInfo, type TabId } from "./StudyHeaderInfo";
import { OverviewTab } from "./tabs/OverviewTab";
import { JoinInfoCard } from "./tabs/JoinInfoCard";
import { CurriculumTab } from "./tabs/CurriculumTab";
import { BoardTab } from "./tabs/BoardTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { GanttTab } from "./tabs/GanttTab";
import { useCurriculumApi } from "./useCurriculumApi";

type Props = { detail: RoomDetail; curriculum: Curriculum; studies: MeStudies; initialTab?: TabId; initialMode?: CurMode; initialLeaf?: string };

export function MyStudyScreen({ detail, curriculum, studies, initialTab = "overview", initialMode = "view", initialLeaf }: Props) {
  const me = useMe();
  const router = useRouter();
  const isLeader = detail.me?.state === "leader";
  const [cur, setCur] = useState(curriculum);
  // 알림 링크 ?task={nodeId}(D8): 그 리프가 이 방 커리큘럼에 있으면 커리큘럼 탭 + 리프 열림으로 시작(goLeafPatch 가 tab 을 curriculum 으로 바꾼다)
  const focusLeaf = initialLeaf && curriculum.nodes.some((n) => n.id === initialLeaf && n.task) ? initialLeaf : null;
  const [S, setS] = useState<ScreenState>({
    ...INITIAL_STATE,
    tab: initialTab,
    curMode: isLeader ? initialMode : "view",
    ...(focusLeaf ? goLeafPatch(focusLeaf) : {}),
  });
  const [toast, setToast] = useState<ToastMsg>(null);
  const update = useCallback((patch: Patch) => setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) })), []);
  const today = cur.today;
  const tree = useMemo(() => buildTree(cur, S.ov, today), [cur, S.ov, today]);
  const room = useMemo(() => toStudyRoom(detail, tree, today, me?.id ?? ""), [detail, tree, today, me]);
  const groups = useMemo(() => toSidebarGroups(studies, today), [studies, today]);
  const goLeaf = useCallback((id: string) => update(goLeafPatch(id)), [update]);
  const api = useCurriculumApi(detail.slug, setCur, update, setToast);
  const closeToast = useCallback(() => setToast(null), []);

  const cancelPending = async () => {
    try {
      await cancelApplication(detail.slug);
      setToast({ text: "신청을 취소했어요", tone: "ok" });
      router.refresh();
    } catch (e) {
      setToast({ text: toApiError(e).message, tone: "bad" });
    }
  };

  return (
    <TodayProvider today={today}>
      <div className="flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
        <AppHeader active="myStudy" variant="card" bell={<NotificationBell />} />
        <div className="mx-auto flex min-h-0 w-full max-w-[1408px] flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
          <StudySidebar selected={detail.slug} groups={groups} />
          <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-[900px]:px-4">
            <div className="flex flex-wrap items-start gap-7">
              <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
                <StudyHeaderInfo room={room} tab={S.tab} onTab={(t) => update({ tab: t, calPick: null })} />
                {S.tab === "overview" && <OverviewTab room={room} tree={tree} onGoCurriculum={() => update({ tab: "curriculum" })} />}
                {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} api={api} canEdit={isLeader} />}
                {S.tab === "board" && <BoardTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "calendar" && <CalendarTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "gantt" && <GanttTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
              </section>
              {S.tab === "overview" && <JoinInfoCard room={room} tree={tree} onMyTasks={() => update({ tab: "board", bMode: "mine", calPick: null })} goLeaf={goLeaf} onCancelPending={cancelPending} />}
            </div>
          </main>
        </div>
        <Toast msg={toast} onClose={closeToast} />
      </div>
    </TodayProvider>
  );
}
```

`StudySidebar.tsx`: props `{ selected: string; groups: SidebarGroup[] }`, `ROOMS`/`SIDEBAR_GROUPS` import 제거, 루프를 `groups.map((g) => … g.items.map((it) => …))` 로, 제목/소개를 `{it.title}` / `{it.intro}` 로.

`StudyHeaderInfo.tsx`: 그룹장 아바타 `tone={room.leaderTone ?? toneOfName(room.leader)}`.

`bits.tsx`: `AvatarStack` 의 `key={p.userId}`, `<Avatar name={p.name} size={size} tone={p.tone} />`.

`OverviewTab.tsx`: 아바타 `tone={t.tones?.[name] ?? toneOfName(name)}`; 전체 일정 루프의 `const rt = tree.roots[i]` → `const rt = tree.roots.find((r) => r.id === rd.roundId)`. **담당자 0명 과제 가드(S15)** — 현재 회차에 담당자 없는 지정 과제가 있으면 `subs / t.people.length` 가 `NaN` 이 된다. `const pct = …` 줄과 진행 칸을 다음으로 바꾼다:

```tsx
                const pct = t.people.length === 0 ? 0 : Math.round((subs / t.people.length) * 100);
```
```tsx
                    <div className="flex w-24 flex-col gap-[5px]">
                      {t.people.length === 0 ? (
                        <span className="text-right text-[12px] font-semibold text-muted">담당자 미정</span>
                      ) : (
                        <>
                          <span className="text-right text-[12px] font-semibold">{allPlanned ? `${t.dates.split(" – ")[0]} 시작` : `${subs}/${t.people.length} 제출`}</span>
                          <ProgressBar pct={pct} height={5} fill={subs === t.people.length ? "#1E9E6A" : "#12A386"} />
                        </>
                      )}
                    </div>
```
어댑터 쪽은 Step 6 의 "designated task with 0 assignees" 사례가 `people: []` 를 고정한다.

`JoinInfoCard.tsx`: props 에 `onCancelPending: () => void` 추가 → "신청 취소" 버튼 `onClick={onCancelPending}`; `memberStats(tree.leaves, m.userId ?? "")`; `<Avatar … tone={m.tone ?? toneOfName(m.name)} …>`; `nextLeaf = room.next?.nodeId ? tree.leaves.find((l) => l.id === room.next!.nodeId) : undefined`; `key={m.userId ?? m.name}`.

`CurriculumTab.tsx`: props `{ tree; S; update; api: CurriculumApi; canEdit: boolean }`. 세그먼트는 `canEdit && <Seg …/>` 로만 노출(그룹장 아님 → 참가자 보기 고정). `addChild = (id: string) => api.create(id)`, `addRound = () => api.create(null)`. `onAddChild={!n.leaf || n.d <= 2 ? () => addChild(n.id) : undefined}` — 리프에도 "+" 를 허용하면 제출물 없는 리프가 부모로 바뀐다(E1). 단순화를 위해 기존처럼 부모에만 둔다: `onAddChild={!n.leaf ? () => addChild(n.id) : undefined}`. `<EditPanel n={selNode} members={tree.members} S={S} update={update} api={api} />`.

`EditPanel.tsx`: props 에 `api: CurriculumApi`, `members: TreeMember[]`. `names` → `const ids = n.leaf ? n.people.map((p) => p.userId) : [];` `setType` 의 `assignOv` 초기값 `ids`; `toggleMember(m: TreeMember)` 는 `m.userId` 로; 칩 `key={m.userId}`, `<Avatar name={m.name} tone={m.tone} size={22} />`, `{m.name}`; 선택됨 수 `${ids.length}명`. 설명 textarea 바인딩: `value={n.desc} onChange={(e) => update((p) => ({ ...patchOv(p, "descs", { ...p.ov.descs, [id]: e.target.value }), saved: "" }))}`. `askRemove`: `n.archived ? api.archive(id, false) : update({ confirm: true, saved: "" })`. `confirmYes`: `hasSub ? api.archive(id, true) : api.remove(id)`. "저장" 버튼: `onClick={() => api.save(n, S.ov)}`. 임시 노드(`n.temp`)는 저장 버튼을 `disabled` 하고 "서버에 만드는 중…" 표시.

`BoardTab.tsx`: `const today = useToday(); const meId = useMe()?.id ?? null;` `inRound = (l) => S.bRound === "all" || l.roundId === S.bRound`; `myCode(l, meId)`, `boardColumn(l, mine, meId)`; `Card` 에 `today`·`meId` prop 전달 → `diffDays(today, l.e)`, `ddayLabel(today, l.e)`, `myCode(l, meId)`.

`CalendarTab.tsx`: `whoName` → `whoId = S.calWho === "all" ? null : S.calWho === "me" ? meId : S.calWho`; `whoCode = (l) => whoId ? l.people.find((p) => p.userId === whoId)?.c ?? null : null`; 참가자 칩 `tree.members.filter((m) => m.userId !== meId).map((m) => [m.userId, m.name, m])`, `<Avatar name={m.name} tone={m.tone} size={22} />`; 오늘 버튼 `calAnchor: today`; `k === today`; `calendarAnchor(tree.leaves, today)`; `ddayLabel(today, pick.e)`; 팝오버 `key={p.userId}`, `tone={p.tone}`, `(나)` 판정 `p.userId === meId`.

`GanttTab.tsx`: `ganttRange(tree.roots, today)`, `diffDays(start, today)`, `k === today`.

`LeafDetail.tsx`: `const today = useToday(); const meId = useMe()?.id;` `me = p.userId === meId`, `tone={p.tone}`, `key={p.userId}`, `ddayLabel(today, n.e)`.

- [ ] **Step 12: `MyStudyEmpty.tsx` + 페이지 2개**

```tsx
// src/components/my-study/MyStudyEmpty.tsx
import Link from "next/link";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { routes } from "@/lib/routes";

export function MyStudyEmpty() {
  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="myStudy" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-3 rounded-[20px] border border-dashed border-line-dash bg-surface px-6 py-16 text-center">
        <p className="m-0 text-[17px] font-semibold">아직 참가한 스터디가 없어요</p>
        <p className="m-0 text-[14px] text-muted">둘러보기에서 마음에 드는 방에 참가하거나 직접 만들어 보세요.</p>
        <div className="mt-2 flex gap-2">
          <Link href={routes.home()} className="flex h-11 items-center rounded-[12px] border border-line-3 bg-surface px-[18px] text-[14px] font-semibold text-ink">방 둘러보기</Link>
          <Link href={routes.createRoom()} className="flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white">방 만들기</Link>
        </div>
      </main>
    </div>
  );
}
```

```tsx
// src/app/my-study/page.tsx — 첫 스터디로, 없으면 빈 상태
import { redirect } from "next/navigation";
import { MyStudyEmpty } from "@/components/my-study/MyStudyEmpty";
import { requireMe } from "@/lib/api/me.server";
import { fetchMyStudies } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export default async function MyStudyIndex() {
  await requireMe(routes.myStudy());
  const studies = await fetchMyStudies(await createClient());
  const first = studies.groups.flatMap((g) => g.items)[0];
  if (first) redirect(routes.myStudy(first.slug));
  return <MyStudyEmpty />;
}
```

```tsx
// src/app/my-study/[id]/page.tsx
import { notFound } from "next/navigation";
import { MyStudyScreen } from "@/components/my-study/MyStudyScreen";
import type { TabId } from "@/components/my-study/StudyHeaderInfo";
import { toApiError } from "@/lib/api/errors";
import { requireMe } from "@/lib/api/me.server";
import { fetchCurriculum, fetchMyStudies } from "@/lib/api/my-study";
import { fetchRoomDetail } from "@/lib/api/room-view";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

const TABS: TabId[] = ["overview", "curriculum", "board", "calendar", "gantt"];

export default async function MyStudyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; mode?: string; task?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireMe(routes.myStudy(id));
  const client = await createClient();
  try {
    const [detail, curriculum, studies] = await Promise.all([fetchRoomDetail(id, client), fetchCurriculum(id, client), fetchMyStudies(client)]);
    const tab = TABS.includes(sp.tab as TabId) ? (sp.tab as TabId) : "overview";
    // key 로 방 변경 시 화면 상태(탭·편집 오버라이드 등)를 리셋한다.
    // ?task= 는 알림(D8) 진입 — 리프 포커스. 숫자 id 가 아니면 무시
    const task = sp.task && /^\d+$/.test(sp.task) ? sp.task : undefined;
    return (
      <MyStudyScreen key={`${id}:${task ?? ""}`} detail={detail} curriculum={curriculum} studies={studies}
        initialTab={tab} initialMode={sp.mode === "edit" ? "edit" : "view"} initialLeaf={task} />
    );
  } catch (e) {
    if (toApiError(e).code === "ROOM_NOT_FOUND") notFound();
    throw e;
  }
}
```

- [ ] **Step 13: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. 확인:
- 철수 `/my-study` → `/my-study/aws`. 개요: 전체 진척률 24%, 참가자 민수 2/5·지은 2/7·철수 2/6·하나 0/7·도윤 "–"(이탈), 내 다음 마감 EC2 D-2. "그룹장 편집 미리보기" 세그먼트 **없음**.
- 보드 회차 칩 "2주차" → EC2·S3 만.
- 민수(`minsu` 계정)로 `/my-study/aws?tab=curriculum&mode=edit` → 편집 모드로 열림 → "회차 추가" → 즉시 "6주차 새 회차" 행 + 네트워크 `node_create` → 응답으로 id 교체(라벨은 서버 기본값과 같아 바뀌지 않음). 제목 수정 → 저장 → "저장했어요 · …" + `node_update` 1회.
- 철수로 헤더 벨 → "EC2 인스턴스 유형 정리 마감 3일 전" 클릭 → `/my-study/aws?task=<EC2 id>` → 커리큘럼 탭에서 EC2 리프가 열려 있다(S11).
- `grep -rn "TODAY\|\bME\b" src/components/my-study` 결과 없음. `grep -rn "PLANS\|SIDEBAR_GROUPS" src/components src/app` 결과 없음.

- [ ] **Step 14: Commit**

```bash
git add src/data/my-study.ts src/lib/api/my-study.ts src/lib/api/my-study.test.ts src/components/my-study src/app/my-study
git commit -m "feat(web): my-study from curriculum_get/room_get/me_studies with optimistic node edits via RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---
### Task 13: 내 일정(Schedule) — `me_schedule(from,to)` 창 계산·매핑, 응답 `today` 로 초기 월

**Files:**
- Create: `src/lib/api/schedule.ts`
- Modify: `src/data/schedule.ts` (타입 확장), `src/components/schedule/{ScheduleScreen,Toolbar,MonthGrid,ListView,DayPanel,UpcomingPanel}.tsx`, `src/app/schedule/page.tsx`
- Test: `src/lib/api/schedule.test.ts`

**Interfaces:**
- Consumes: Task 1 `rpc`, `ScheduleResponse`, `ScheduleTask`, `MetaDto`; Task 3 `requireMe`; `src/components/schedule/calc.ts` `monthWeeks`; `src/lib/palette` `Tone`.
- Produces:
  ```ts
  export const MAX_WINDOW_DAYS = 62;
  export type Window = { from: string; to: string; sel: string };
  export function scheduleWindow(y: number, m: number, sel: string): Window;     // 달 격자 ± sel 확장, 62일 초과면 sel 리셋(schedule §7-8)
  export function fetchSchedule(from: string, to: string, client?: Db): Promise<ScheduleResponse>;
  export const STUDY_TONE: Record<Tone, { bg: string; fg: string; dot: string }>;
  export type ScheduleData = { today: string; studies: Study[]; studyMap: Record<string, Study>; tasks: Task[]; markers: Marker[]; upcoming: Task[] };
  export function toScheduleData(r: ScheduleResponse): ScheduleData;
  export function sortUpcoming(tasks: Task[]): Task[];                              // e ASC, study, title(ko)
  // ScheduleScreen({ initial: ScheduleResponse })
  ```

- [ ] **Step 1: `src/data/schedule.ts` 타입 확장**

```ts
export type StudyId = string;                                   // slug
export type Study = { id: StudyId; name: string; bg: string; fg: string; dot: string; pending?: boolean; membership?: "leader" | "joined" | "pending" };
export type Task = { id: string; study: StudyId; title: string; s: string; e: string; st: TaskStatus; round: string; /** false = 내 담당 아님(st null 보정, 아이콘 없음) */ mine?: boolean };
```
`TASKS` 상수 생성부의 `id` 를 `String(id)` 로 바꾼다(`RAW.map(([…], id) => ({ id: String(id), … }))`). 나머지 상수는 그대로(화면은 더 이상 import 하지 않는다).

- [ ] **Step 2: 실패하는 테스트** — `src/lib/api/schedule.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { scheduleWindow, sortUpcoming, toScheduleData } from "./schedule";
import type { ScheduleResponse } from "./types";

const TODAY = "2026-10-12";

describe("scheduleWindow (schedule §5·§7-8) — 2026년 10월 격자는 09-27(일) ~ 10-31(토)", () => {
  it("sel inside the grid → grid as is", () => {
    expect(scheduleWindow(2026, 9, TODAY)).toEqual({ from: "2026-09-27", to: "2026-10-31", sel: TODAY });
  });
  it("sel outside but within 62 days → extend", () => {
    expect(scheduleWindow(2026, 9, "2026-11-20")).toEqual({ from: "2026-09-27", to: "2026-11-20", sel: "2026-11-20" });
    expect(scheduleWindow(2026, 9, "2026-09-10")).toEqual({ from: "2026-09-10", to: "2026-10-31", sel: "2026-09-10" });
  });
  it("sel too far (> 62 days) → reset sel to the grid's first day", () => {
    expect(scheduleWindow(2026, 9, "2026-12-15")).toEqual({ from: "2026-09-27", to: "2026-10-31", sel: "2026-09-27" });
  });
});

const res: ScheduleResponse = {
  today: TODAY,
  studies: [
    { slug: "aws", title: "AWS SAA 자격증 3개월 완주", membership: "joined", tone: "mint", status: "active", startDate: "2026-10-01", endDate: "2026-12-31" },
    { slug: "spring", title: "Spring 김영한 로드맵 완강", membership: "joined", tone: "lav", status: "active", startDate: "2026-10-05", endDate: "2027-01-31" },
    { slug: "sqld", title: "SQLD 4주 벼락치기", membership: "pending", tone: "amber", status: "recruit", startDate: "2026-10-26", endDate: "2026-11-22" },
  ],
  tasks: [
    { id: "21", slug: "aws", title: "EC2 인스턴스 유형 정리", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" },
    { id: "90", slug: "docker", title: "리더 전용", s: "2026-10-08", e: "2026-10-14", st: null, round: "1주차" },
    { id: "91", slug: "docker", title: "리더 전용 2", s: "2026-10-20", e: "2026-10-24", st: null, round: "2주차" },
  ],
  markers: [{ date: "2026-10-12", slug: "spring", round: "2주차" }],
  upcoming: [
    { id: "b", slug: "spring", title: "싱글톤 컨테이너 실습 코드", s: "2026-10-15", e: "2026-10-18", st: "planned", round: "2주차" },
    { id: "a", slug: "spring", title: "섹션 6~7 정리 노트", s: "2026-10-12", e: "2026-10-18", st: "open", round: "2주차" },
    { id: "21", slug: "aws", title: "EC2 인스턴스 유형 정리", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" },
    { id: "90", slug: "docker", title: "리더 전용", s: "2026-10-08", e: "2026-10-14", st: null, round: "1주차" },   // leaderDoesTasks=false 방 — upcoming 에서 빠져야 한다
  ],
};

describe("toScheduleData (schedule §6)", () => {
  const d = toScheduleData(res);
  it("studies: tone → palette, pending suffix", () => {
    expect(d.studies[0]).toEqual({ id: "aws", name: "AWS SAA 자격증 3개월 완주", bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386", pending: undefined, membership: "joined" });
    expect(d.studies[2]).toMatchObject({ id: "sqld", name: "SQLD 4주 벼락치기 · 승인 대기", pending: true, bg: "#FBEFD3", fg: "#7A4F00", dot: "#C98A00" });
    expect(d.studyMap.spring.dot).toBe("#7C5BD0");
    expect(d.today).toBe(TODAY);
  });
  it("tasks: st null → planned/open by date with mine=false (Review Focus 3)", () => {
    expect(d.tasks.map((t) => [t.id, t.st, t.mine])).toEqual([["21", "open", true], ["90", "open", false], ["91", "planned", false]]);
    expect(d.tasks[0]).toMatchObject({ study: "aws", round: "2주차", s: "2026-10-08", e: "2026-10-14" });
  });
  it("markers pass through with study=slug", () => {
    expect(d.markers).toEqual([{ date: "2026-10-12", study: "spring", round: "2주차" }]);
  });
  it("upcoming is sorted e ASC then study, title (schedule §3-4)", () => {
    expect(d.upcoming.map((t) => t.title)).toEqual(["EC2 인스턴스 유형 정리", "섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  });
  it("upcoming drops st:null items even if the server sent them (Review Focus 3, S17)", () => {
    expect(res.upcoming.some((t) => t.st === null)).toBe(true);                // 픽스처에 null 항목이 실제로 있다
    expect(d.upcoming.map((t) => t.id)).not.toContain("90");
    expect(d.upcoming).toHaveLength(3);
  });
});

describe("sortUpcoming", () => {
  it("is stable on ties", () => {
    const a = { id: "1", study: "b", title: "가", s: "", e: "2026-10-18", st: "open" as const, round: "" };
    const b = { id: "2", study: "a", title: "나", s: "", e: "2026-10-18", st: "open" as const, round: "" };
    expect(sortUpcoming([a, b]).map((t) => t.id)).toEqual(["2", "1"]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/api/schedule.test.ts`
Expected: FAIL — `Cannot find module './schedule'`

- [ ] **Step 4: `src/lib/api/schedule.ts`**

```ts
import { monthWeeks } from "@/components/schedule/calc";
import { rpc, type Db } from "@/lib/api/errors";
import type { ScheduleResponse, ScheduleTask } from "@/lib/api/types";
import { diffDays } from "@/lib/date";
import type { Tone } from "@/lib/palette";
import type { Marker, Study, Task } from "@/data/schedule";

export const MAX_WINDOW_DAYS = 62;
export type Window = { from: string; to: string; sel: string };

/** 달 격자(일~토) 를 기본 창으로, sel 이 밖이면 sel 까지 넓힌다. 62일을 넘으면 sel 을 격자 첫날로 리셋한다(schedule §7-8). */
export function scheduleWindow(y: number, m: number, sel: string): Window {
  const weeks = monthWeeks(y, m);
  const from0 = weeks[0][0];
  const to0 = weeks[weeks.length - 1][6];
  const from = sel < from0 ? sel : from0;
  const to = sel > to0 ? sel : to0;
  if (diffDays(from, to) > MAX_WINDOW_DAYS) return { from: from0, to: to0, sel: from0 };
  return { from, to, sel };
}

export const fetchSchedule = (from: string, to: string, client?: Db) => rpc<ScheduleResponse>("me_schedule", { p_from: from, p_to: to }, client);

/** 목업 STUDIES 색을 tone 키로 (aws=mint, spring=lav, sqld=amber) */
export const STUDY_TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  mint: { bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386" },
  lav: { bg: "#EEE7FB", fg: "#5B3AA0", dot: "#7C5BD0" },
  amber: { bg: "#FBEFD3", fg: "#7A4F00", dot: "#C98A00" },
  blue: { bg: "#E3ECFD", fg: "#2F5BC2", dot: "#3B6FE0" },
  peach: { bg: "#FDE8E1", fg: "#B4462B", dot: "#C9583A" },
  slate: { bg: "#E9EEF0", fg: "#4A5563", dot: "#7A8594" },
};

export type ScheduleData = { today: string; studies: Study[]; studyMap: Record<string, Study>; tasks: Task[]; markers: Marker[]; upcoming: Task[] };

const toTask = (t: ScheduleTask, today: string): Task => ({
  id: t.id, study: t.slug, title: t.title, s: t.s, e: t.e, round: t.round,
  st: t.st ?? (today < t.s ? "planned" : "open"),
  mine: t.st !== null,
});

export const sortUpcoming = (tasks: Task[]): Task[] => [...tasks].sort((a, b) => a.e.localeCompare(b.e) || a.study.localeCompare(b.study) || a.title.localeCompare(b.title, "ko"));

export function toScheduleData(r: ScheduleResponse): ScheduleData {
  const studies: Study[] = r.studies.map((s) => ({
    id: s.slug,
    name: s.membership === "pending" ? `${s.title} · 승인 대기` : s.title,
    ...STUDY_TONE[s.tone],
    pending: s.membership === "pending" ? true : undefined,
    membership: s.membership,
  }));
  return {
    today: r.today,
    studies,
    studyMap: Object.fromEntries(studies.map((s) => [s.id, s])),
    tasks: r.tasks.map((t) => toTask(t, r.today)),
    markers: r.markers.map((m) => ({ date: m.date, study: m.slug, round: m.round })),
    upcoming: sortUpcoming(r.upcoming.filter((t) => t.st !== null).map((t) => toTask(t, r.today))),
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/api/schedule.test.ts`
Expected: 9 passed

- [ ] **Step 6: 컴포넌트 수정** — `TODAY`·`STUDY`·`STUDIES`·`shortName` import 를 props 로. (`shortName` 은 `src/data/schedule.ts` 에 남겨 두고 계속 쓴다 — `" · "` 앞이 제목.)

`ScheduleScreen.tsx` 전체 교체:
```tsx
"use client";

import { useCallback, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { fetchSchedule, scheduleWindow, toScheduleData } from "@/lib/api/schedule";
import type { ScheduleResponse } from "@/lib/api/types";
import { Toolbar, type View } from "./Toolbar";
import { MonthGrid } from "./MonthGrid";
import { ListView } from "./ListView";
import { Legend } from "./Legend";
import { DayPanel } from "./DayPanel";
import { UpcomingPanel } from "./UpcomingPanel";

export function ScheduleScreen({ initial }: { initial: ScheduleResponse }) {
  const [data, setData] = useState(() => toScheduleData(initial));
  const today = data.today;
  const [y, setY] = useState(+today.slice(0, 4));
  const [m, setM] = useState(+today.slice(5, 7) - 1);
  const [sel, setSel] = useState(today);
  const [view, setView] = useState<View>("month");
  const [off, setOff] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastMsg>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const on = (id: string) => !off.includes(id);
  const tasks = data.tasks.filter((t) => on(t.study));
  const markers = data.markers.filter((mk) => on(mk.study));
  const upcoming = data.upcoming.filter((t) => on(t.study));

  /** 달이 바뀌면 창을 다시 계산해 재조회. sel 이 창 밖으로 멀면 scheduleWindow 가 리셋한다. */
  const load = async (ny: number, nm: number, nsel: string) => {
    const w = scheduleWindow(ny, nm, nsel);
    setY(ny);
    setM(nm);
    setSel(w.sel);
    setLoading(true);
    try {
      setData(toScheduleData(await fetchSchedule(w.from, w.to)));
    } catch (e) {
      setToast({ text: toApiError(e).message, tone: "bad" });
    } finally {
      setLoading(false);
    }
  };
  const shift = (dm: number) => {
    const d = new Date(Date.UTC(y, m + dm, 1));
    void load(d.getUTCFullYear(), d.getUTCMonth(), sel);
  };
  const goToday = () => {
    const ty = +today.slice(0, 4);
    const tm = +today.slice(5, 7) - 1;
    if (ty === y && tm === m) setSel(today);
    else void load(ty, tm, today);
  };
  const toggle = (id: string) => setOff(on(id) ? [...off, id] : off.filter((x) => x !== id));

  return (
    <div className="box-border flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
      <AppHeader active="schedule" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full max-w-[1408px] min-h-0 flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
        <main className="flex min-h-0 min-w-0 flex-[999_1_720px] flex-col rounded-[20px] bg-surface px-6 pt-6 pb-[18px] max-sm:px-4 max-sm:pt-4" aria-busy={loading}>
          <Toolbar y={y} m={m} view={view} off={off} studies={data.studies} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={goToday} onToggle={toggle} onView={setView} />
          {view === "month" ? (
            <MonthGrid y={y} m={m} sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} onPick={setSel} />
          ) : (
            <ListView y={y} m={m} today={today} studies={data.studyMap} tasks={tasks} />
          )}
          <Legend />
        </main>
        <aside aria-label="일정 요약" className="flex min-h-0 flex-[1_1_320px] max-w-[380px] flex-col gap-4 max-[900px]:max-w-none">
          <DayPanel sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} />
          <UpcomingPanel today={today} studies={data.studyMap} upcoming={upcoming} />
        </aside>
      </div>
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
```

- `Toolbar.tsx`: props 에 `studies: Study[]` 추가, `STUDIES.map` → `studies.map`, `off: string[]`, `onToggle: (id: string) => void`. `import { STUDIES, type StudyId }` 제거.
- `MonthGrid.tsx`: props 에 `today: string; studies: Record<string, Study>` 추가 → `WeekRow`·`TaskBar` 로 전달. `TODAY` → `today`, `STUDY[…]` → `studies[…]`. `TaskBar` 마감 아이콘은 `isEnd && t.mine !== false` 일 때만.
- `ListView.tsx`: props `today`, `studies`. `TODAY` → `today`, `STUDY` → `studies`.
- `DayPanel.tsx`: props `today`, `studies`. `type Item` 의 `study: string`. `STUDY[mk.study]` → `studies[mk.study]`, `dday(TODAY, …)` → `dday(today, …)`, `sel === TODAY` → `sel === today`.
- `UpcomingPanel.tsx`: props `{ today: string; studies: Record<string, Study>; upcoming: Task[] }` — 자체 필터·정렬 제거(서버 upcoming), `diffDays(today, t.e)`, `dday(today, t.e)`, `shortName(studies[t.study])`.

- [ ] **Step 7: `src/app/schedule/page.tsx`**

```tsx
import type { Metadata } from "next";
import { ScheduleScreen } from "@/components/schedule/ScheduleScreen";
import { rpc } from "@/lib/api/errors";
import { requireMe } from "@/lib/api/me.server";
import { fetchSchedule, scheduleWindow } from "@/lib/api/schedule";
import type { MetaDto } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 내 일정" };

export default async function SchedulePage() {
  await requireMe(routes.schedule());
  const client = await createClient();
  const { today } = await rpc<MetaDto>("meta_get", {}, client);
  const w = scheduleWindow(+today.slice(0, 4), +today.slice(5, 7) - 1, today);
  const initial = await fetchSchedule(w.from, w.to, client);
  return <ScheduleScreen initial={initial} />;
}
```

- [ ] **Step 8: 검증**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 통과. 철수 `/schedule` → DB `today`(로컬 고정 2026-10-12)의 달 = 2026년 10월 격자, 칩 5개(AWS…, Spring…, SQLD … · 승인 대기, Docker…(그룹장), 알고리즘…(종료) — `me_schedule.studies`), 다가오는 마감에 EC2(D-2 빨강)·섹션 6~7·싱글톤. "다음 달" → 네트워크 `me_schedule` 1회, 11월 격자에 sqld 1주차 마커(10-26 은 11월 격자 첫 주에 포함). `grep -rn "TODAY\|STUDIES\|STUDY\b\|TASKS\|MARKERS" src/components/schedule` 결과 없음(`shortName` 만 남는다).

- [ ] **Step 9: Commit**

```bash
git add src/lib/api/schedule.ts src/lib/api/schedule.test.ts src/data/schedule.ts src/components/schedule src/app/schedule
git commit -m "feat(web): schedule from me_schedule with window extension and server upcoming

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 14: 환경변수 · README · `.vercelignore` · Vercel/Supabase 설정 체크리스트 · 목업 상수 잔재 검사

**Files:**
- Modify: `README.md`, `.env.example`(확인만 — 플랜 01 Task 3 이 교체함), `src/lib/routes.ts`(`TODAY`·`ME` 상수 제거 여부 결정)
- Create: `.vercelignore`

**Interfaces:** 없음 (문서·설정).

- [ ] **Step 1: 목업 상수 잔재 검사 (Global Constraints)**

```bash
grep -rn "NEXT_PUBLIC_API_URL" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
grep -rn "TODAY\|\bME\b" src --include=*.ts --include=*.tsx | grep -v "\.test\.ts" | grep "@/lib/routes"
grep -rn "ROOMS\|PLANS\|SIDEBAR_GROUPS\|STUDIES\|MARKERS\|TASKS\|INITIAL_JOIN\|ROOM_GROUPS" src/components src/app | grep "from \"@/data/"
```
Expected: 세 명령 모두 출력 없음. 출력이 있으면 해당 태스크로 돌아가 고친다. 테스트 파일(`*.test.ts`)은 `TODAY` 리터럴 문자열을 쓰므로 무관.

이제 `src/lib/routes.ts` 의 `TODAY`·`ME` export 를 **삭제**한다(어디서도 import 하지 않으므로). `src/data/*.ts` 의 상수(`ROOMS` 등)는 플랜 Global Constraints 대로 남긴다.

- [ ] **Step 2: `.vercelignore`**

```
supabase/
docs/
```

- [ ] **Step 3: README 수정**

- 2행 `스터디 그룹 목표·일정 관리 웹. 현재는 목업 데이터 기반 프론트엔드.` → `스터디 그룹 목표·일정 관리 웹. Next.js 16 + Supabase(Postgres RPC · Auth 이메일 OTP · Storage).`
- "화면 ↔ 라우트" 표에 행 추가:

```markdown
| 로그인 (이메일 OTP) | `/login` | `src/components/auth/LoginScreen.tsx` |
| 닉네임 설정 | `/onboarding` | `src/components/auth/OnboardingScreen.tsx` |
| 내 프로필 | `/me` | `src/components/auth/ProfileScreen.tsx` |
| 초대 링크 | `/invite/[token]` | `src/components/auth/InviteScreen.tsx` |
| 방 만들기 | `/rooms/new` | `src/components/room-new/NewRoomForm.tsx` |
```
- 공용 줄을 `공용: `src/components/ui`(헤더·알림·아바타·다이얼로그·토스트), `src/lib`(routes·palette·date·types·today·me), `src/lib/api/*`(Supabase RPC 어댑터 — 화면은 `src/data/*.ts` 타입만 본다).` 로.
- "## 백엔드 (Supabase)" 절(플랜 01 이 작성) 끝에 추가:

```markdown
- 프론트 어댑터: `src/lib/api/{errors,format,me,notifications,invite,rooms,room-view,my-study,schedule}.ts`. 순수 변환 함수는 `npm test`(Vitest)로 목업 숫자(toeic 8주, aws 24%·D-2, algo 87%)를 회귀 검증한다.
- 로컬 E2E: `docs/superpowers/plans/2026-10-13-backend-05-frontend-integration.md` Task 15 체크리스트(ego-browser, http://localhost:3100, OTP 는 Inbucket).
- Vercel: `vercel env add NEXT_PUBLIC_SUPABASE_URL production` / `vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production` (preview 도 동일). `service_role` 은 넣지 않는다. `.vercelignore` 로 `supabase/`·`docs/` 제외.
```

- [ ] **Step 4: Vercel 환경변수**

```bash
vercel env ls                                   # NEXT_PUBLIC_API_URL 이 있으면 아래로 제거
vercel env rm NEXT_PUBLIC_API_URL production -y; vercel env rm NEXT_PUBLIC_API_URL preview -y
vercel env add NEXT_PUBLIC_SUPABASE_URL production      # 호스팅 프로젝트 URL  https://<ref>.supabase.co
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production # 대시보드 Settings → API → anon public
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env ls                                   # 두 키 × production/preview 만 보여야 한다
```

- [ ] **Step 5: Supabase 대시보드 Auth 체크리스트** (호스팅 프로젝트 — 로컬 `config.toml` 은 플랜 01 이 맞춰 둠)

| 위치 | 값 |
|---|---|
| Authentication → Providers → Email | Enabled, **Confirm email OFF**(OTP 가 곧 확인), Secure email change 기본 |
| Authentication → Email Templates → Magic Link / OTP | 본문에 `{{ .Token }}` 포함 (예: `<p>인증 코드: <b>{{ .Token }}</b> (10분 안에 입력)</p>`) |
| Authentication → Settings | OTP expiry 600초, OTP length 6, Email rate limit ≥ 30/h, Minimum interval 60초 |
| Authentication → URL Configuration | Site URL `https://sgtudy.vercel.app`, Redirect URLs `https://sgtudy.vercel.app/**`, `http://localhost:3000/**`, `http://localhost:3100/**` |
| Settings → API | anon key → Vercel, service_role 은 로컬 `.env.local` 만 |

- [ ] **Step 6: 검증·Commit**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: 통과(빌드는 `supabase stop` 후 — 메모리). 빌드 로그에 `/`, `/rooms/[id]`, `/my-study/[id]`, `/schedule`, `/login` 등이 **ƒ (Dynamic)** 으로 표시된다.

```bash
git add README.md .vercelignore src/lib/routes.ts
git commit -m "docs: README backend/E2E/Vercel notes, vercelignore, drop mock TODAY/ME constants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 15: E2E — 로컬 Supabase + 프로덕션 빌드(localhost:3100) 를 ego-browser 로 통과

**Files:** 없음(검증만). 스크린샷은 `$TMPDIR/sgtudy-e2e/` 에 저장(커밋하지 않는다).

**Interfaces:**
- Consumes: 시드(플랜 01~04), 로컬 Supabase, 플랜 01 의 `supabase/seed.sql` §1 이메일(`cheolsu@sgtudy.local`, 민수는 §1 표의 `email_local` + `@sgtudy.local`), 초대 토큰 `seed-<slug>`, Inbucket API.
- 범위 밖(명시) → **plan 06**: 과제 제출·파일 업로드(§4.10), 그룹장 승인/거절·초대 링크 복사(§4.4), 모집 시작/지금 시작. 제출은 시드 제출(aws 철수 IAM·VPC done)로 보드 "제출 완료" 칸만, 승인은 Step 8 에서 SQL 로 대신한다.

**기준일 고정(B6):** plan 01~04 의 `seed.sql` 마지막 줄 `insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;`(00 개요) 때문에 로컬 DB 의 `kst_today()` 는 실행일과 무관하게 **2026-10-12** 다. 아래 단언은 전부 이 날짜 기준의 정확값이다(D-day 패턴 매칭 없음). Step 1 에서 이 고정을 먼저 확인하고, 아니면 진행하지 않는다.

- [ ] **Step 1: 환경 기동** (메모리 — 빌드와 supabase 를 동시에 돌리지 않는다)

```bash
vm_stat | grep -E 'free|compressor'
supabase start && supabase db reset            # 시드 포함 — 마지막 줄이 app.today 를 2026-10-12 로 고정
eval "$(supabase status -o env)"; grep -q "$API_URL" .env.local || echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL" >> .env.local   # anon key 도 같은 방식으로 확인

# 기준일 고정 확인 (B6) — DB 세션과 PostgREST(앱이 실제로 타는 경로) 둘 다
psql "$DB_URL" -tAc "select public.kst_today()"                                    # → 2026-10-12
curl -s "$API_URL/rest/v1/rpc/meta_get" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'   # → {"today":"2026-10-12",…}
# 둘 중 하나라도 다르면: PostgREST 커넥션이 ALTER 이전 세션이다 → supabase stop && supabase start 후 다시 확인. 그래도 다르면 seed.sql 마지막 줄을 확인하고 멈춘다.

mkdir -p "$TMPDIR/sgtudy-e2e"
npm run build                                  # supabase 가 떠 있으면 메모리 확인 후. 실패 시 supabase stop → build → supabase start
PORT=3100 nohup npm run start > "$TMPDIR/sgtudy-e2e/next.log" 2>&1 &
echo $! > "$TMPDIR/sgtudy-e2e/next.pid"        # 매 Bash 호출이 새 셸이라 잡 번호(%1)를 못 쓴다 — pid 파일로 정리
sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/   # 200
```

OTP 읽기 헬퍼(Inbucket v1 API — 메일함 이름 = 이메일 local part):
```bash
otp() { local box="$1"; local id; id=$(curl -s "http://127.0.0.1:54324/api/v1/mailbox/$box" | python3 -c 'import sys,json; m=json.load(sys.stdin); print(m[-1]["id"] if m else "")'); curl -s "http://127.0.0.1:54324/api/v1/mailbox/$box/$id" | python3 -c 'import sys,json,re; print(re.search(r"\b(\d{6})\b", json.load(sys.stdin)["body"]["text"]).group(1))'; }
```

- [ ] **Step 2: 신규 사용자 로그인 → 온보딩** (ego-browser, 공간 하나를 끝까지 재사용. 첫 라운드에서 `spaceId` 를 출력해 두고 이후 `SPACE_ID=<id>` 환경변수로 넘겨 `taskSpace(process.env.SPACE_ID)` 로 재개)

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("sgtudy e2e");
const p = task.page("p1");
await p.goto("http://localhost:3100/login?returnTo=/rooms/toeic");
await p.fill("loc=css:input[type=email]", "e2e-new@sgtudy.local");
await p.click("loc=role:button[name='인증 코드 받기']");
await p.waitForSelector("loc=role:group[name='6자리 인증 코드']");
console.log({ spaceId: task.spaceId });
EOF
CODE=$(otp e2e-new); echo $CODE
SPACE_ID=<첫 라운드의 spaceId> CODE=$CODE ego-browser nodejs -e '
const task = await taskSpace(process.env.SPACE_ID); const p = task.page("p1");
await p.click("loc=css:input[aria-label=\"1번째 자리\"]");
await p.keyboard.type(process.env.CODE);
await p.waitForURL(/\/onboarding/);
await p.fill("loc=css:input[autocomplete=nickname]", "이투이");
await p.waitForSelector("text=사용할 수 있어요");
await p.click("loc=role:button[name=\"시작하기\"]");
await p.waitForURL(/\/rooms\/toeic$/);
await p.screenshot({ path: process.env.TMPDIR + "/sgtudy-e2e/01-onboarded.png" });
console.log(await p.snapshot());
' 
```
(`SPACE_ID`·`CODE` 는 환경변수로 넘긴다 — 스크립트 안에 식별자를 그대로 쓰지 않는다. 이후 Step 도 같은 방식.)
체크: URL 이 `/rooms/toeic`, 헤더에 "이" 아바타, 참가 카드 CTA "참가하기".

- [ ] **Step 3: 로그아웃 → 철수 로그인**

프로필 메뉴 → 로그아웃 → 헤더가 "로그인" 버튼으로 바뀜(스냅샷 확인) → `/login` → `cheolsu@sgtudy.local` → `otp cheolsu` → `/`. 체크: 탭 카운트 `8 / 4 / 1`, 카드 8장, aws 카드 "내 진척률 33%"(철수 2/6 — D5) + 강조 `D-2`(EC2 10/14 마감, OPEN), toeic 카드 `D-21`, spring 카드 없음(비공개), "내가 참가한 방" 탭에 spring 포함 4장, "내가 만든 방" 에 docker 1장. 검색 "토익" → 1장. 태그 `#자격증` 토글 → 3장. 스크린샷 `02-main.png`.

- [ ] **Step 4: 모바일 390** (CDP 로 뷰포트 변경 — ego-browser 의 허용된 탈출구)

```js
await p.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
for (const url of ["/", "/rooms/aws", "/my-study/aws", "/schedule", "/login"]) {
  await p.goto("http://localhost:3100" + url);
  await p.waitForLoadState();
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(url, { scrollWidth: sw });           // 390 이어야 한다 (가로 스크롤 없음)
  await p.screenshot({ path: `${process.env.TMPDIR}/sgtudy-e2e/03-mobile${url.replace(/\//g, "_")}.png` });
}
await p.cdp("Emulation.clearDeviceMetricsOverride", {});
```
체크: 5개 URL 모두 `scrollWidth === 390`. (`/login` 은 로그인 상태라 `/` 로 리다이렉트되는 것이 정상.)

- [ ] **Step 5: RoomView 참가 / 취소 / 승인 대기**

1. `/rooms/toeic` → "참가하기" 클릭 → 토스트 "참가했어요", 인원 `3 / 8명`, 버튼 "참가 완료" + "참가 취소", 사이드바 toeic 항목에 "참가함" 마크(`router.refresh` 뒤).
2. "참가 취소" → `role=alertdialog` "참가를 취소할까요?" → "참가 취소" 확인 → 인원 `2 / 8명`, CTA 다시 "참가하기".
3. `/rooms/sqld` → "승인 대기중" + "신청 취소" 버튼, 참가자 목록에 "철수 · 승인 대기" 회색 행(클릭하지 않는다 — Step 8 이 승인 흐름에 쓴다).
4. `/rooms/jcg` → "정원 마감" 비활성(10/19 시작 전이라 RECRUIT 유지 — 기준일 고정 덕에 실행일과 무관). `/rooms/nope` → 404 페이지.
스크린샷 `04-roomview-join.png`.

- [ ] **Step 6: MyStudy (철수 → 민수 편집)**

1. `/my-study` → `/my-study/aws` 로 리다이렉트. 개요: "전체 진척률 24%", 참가자 행 "철수 2/6"·"도윤 · 이탈 · –", "내 다음 마감 EC2 인스턴스 유형 정리 · D-2", 현재 회차 카드 "2주차 · 진행중". 커리큘럼 탭에 "그룹장 편집 미리보기" 세그먼트 **없음**. 보드 → "내 칸반" 제출 완료 칸에 IAM·VPC 2장, 회차 칩 "2주차" → 진행중 칸에 EC2 1장.
2. 로그아웃 → 민수(`seed.sql` §1 의 민수 email_local)로 로그인 → `/my-study/aws?tab=curriculum&mode=edit` → 편집 모드로 열림(세그먼트 "그룹장 편집 미리보기" 선택됨).
3. "EC2 인스턴스 유형 정리" 행 클릭 → 우측 패널 제목을 `EC2 인스턴스 유형 정리 (E2E)` 로 → "저장" → "저장했어요 · 태그를 자동으로 다시 골랐어요" → 새로고침 → 제목 유지 → 다시 원래 제목으로 저장.
4. "회차 추가" → 행 "6주차 새 회차" 즉시 추가, 1초 안에 임시 id 가 서버 id 로 바뀜(라벨은 서버 기본값 `"{n}주차"` 와 같아 그대로 — 스냅샷에서 `6주차` 행 존재) → 그 행 선택 → "삭제" → 다이얼로그 → 삭제 → 행 사라짐.
스크린샷 `05-mystudy-edit.png`.

- [ ] **Step 7: Schedule**

철수로 다시 로그인 → `/schedule`: 칩 **5개**(`me_schedule.studies` — aws·spring·sqld(` · 승인 대기`)·docker(그룹장)·algo(종료), plan 03 시드 기준), 격자 달 = **2026년 10월**, 10/12 셀에 "오늘" 배지, "다가오는 마감" 첫 항목 "EC2 인스턴스 유형 정리"(10/14). "다음 달" 클릭 → 헤더 "2026년 11월", 과제 막대 갱신. "오늘" → 10월로 복귀. "목록" 탭 → 주 단위 그룹. 스크린샷 `06-schedule.png`.

- [ ] **Step 8: 알림 — 승인 처리로 알림 생성 → 배지 → 읽음**

가은(sqld 그룹장) 승인 UI 는 plan 06(§4.4 그룹장 패널) 소관이라 SQL 로 승인한다(`current_user_id()` 는 `request.jwt.claims.sub` 를 읽는다):
```bash
GAEUN=$(psql "$DB_URL" -tAc "select id from public.profiles where nickname='가은'")
CHEOLSU=$(psql "$DB_URL" -tAc "select id from public.profiles where nickname='철수'")
psql "$DB_URL" -c "begin; select set_config('request.jwt.claims', '{\"sub\":\"$GAEUN\",\"role\":\"authenticated\"}', true); select public.room_approve('sqld', '$CHEOLSU'); commit;"
```
브라우저(철수): 승인 전 배지는 `3`(plan 04 시드 §4 미읽음 3건). 60초 안에(또는 새로고침) 배지 `4` → 벨 클릭 → 드롭다운 맨 위 "SQLD 4주 벼락치기 참가가 승인됐어요"(읽지 않음 점) → 클릭 → `/my-study/sqld` 로 이동, 배지 `3` → 벨 다시 열면 그 항목은 읽음 상태(배경 흰색), "모두 읽음" **활성**(시드 3건이 남음) → "모두 읽음" 클릭 → 배지 사라짐, 버튼 비활성. 시드 항목 "EC2 인스턴스 유형 정리 마감 3일 전" 은 링크 `/my-study/aws?task=<id>` — 클릭 시 커리큘럼 탭에서 EC2 리프가 열린다(Task 12, S11). 스크린샷 `07-notifications.png`.

- [ ] **Step 9: 초대 링크**

로그아웃 상태로 `/invite/seed-cs` → 미리보기(제목 "CS 면접 질문 …", "3 / 6명 · 바로 참가") + "로그인하고 참가" → 철수 로그인 → `/invite/seed-cs` 복귀 → "참가하기" → `/my-study/cs`. `/invite/bogus` → "유효하지 않은 초대 링크예요".

- [ ] **Step 10: 정리**

```bash
kill "$(cat "$TMPDIR/sgtudy-e2e/next.pid")" 2>/dev/null          # npm
lsof -ti tcp:3100 | xargs kill 2>/dev/null                       # npm 이 띄운 next 자식까지
supabase db reset   # E2E 가 바꾼 상태(toeic 참가 취소 이력, sqld 승인, cs 참가, 신규 사용자) 복구 — app.today 고정도 다시 걸린다
```
결과를 `docs/superpowers/plans/2026-10-13-backend-05-frontend-integration.md` 의 이 태스크 체크박스에 체크하고, 실패한 단계는 원인·수정 커밋 해시를 Self-Review 메모 아래에 한 줄씩 적는다(이 문서 수정 커밋: `docs: phase 7 e2e results`).

---

### Task 16: Vercel 배포 + 스모크

**Files:** 없음.

**Interfaces:**
- Consumes: Task 14 의 Vercel 환경변수·Auth 설정, 호스팅 Supabase 프로젝트에 마이그레이션 적용(`supabase link --project-ref <ref> && supabase db push`). 호스팅 DB 에는 `auth.users` 직접 INSERT 시드를 넣지 않는다(플랜 01 §1) — 방·사용자가 비어 있는 상태에서 실제 이메일로 검증한다.

- [ ] **Step 1: 배포**

```bash
git status                      # clean
git push origin main            # 프로덕션 자동 배포 (또는 vercel --prod)
vercel ls | head -5             # READY 확인
vercel logs https://sgtudy.vercel.app --since 10m | grep -i "meta_get\|error" || echo "no errors"
```

- [ ] **Step 2: 스모크 (ego-browser, 실제 이메일)**

1. https://sgtudy.vercel.app/ — 비로그인 헤더(로고·방 둘러보기·로그인), 카드 0장이면 빈 상태 "조건에 맞는 방이 없어요" + "방 만들기".
2. `/login` → 본인 이메일 → 받은 메일의 6자리 → `/onboarding` → 닉네임 → `/`.
3. "방 만들기" → 제목 "배포 스모크", 소개, 오늘~+14일, 4명 → `/my-study/<slug>?tab=curriculum&mode=edit` → "회차 추가" → 행 생성 → 저장.
4. `/` "내가 만든 방" 에 "준비중" 배지 카드. `/schedule` 렌더(과제 없음). `/me` 토글 ON/OFF.
5. 로그아웃 → `/my-study` → `/login?returnTo=%2Fmy-study` 로 리다이렉트.
6. 모바일 390 에서 `/` 가로 스크롤 없음.

- [ ] **Step 3: 정리**

스모크로 만든 방은 Supabase 대시보드 SQL 에서 `select public.room_delete('<slug>')`(그룹장 세션 필요 — Task 15 Step 8 과 같은 `set_config` 방식) 로 지우거나 그대로 둔다. 결과를 이 문서 체크박스에 반영하고 커밋(`docs: phase 7 deploy smoke results`).

---

## Phase 종료 게이트

아래가 전부 참이어야 **Phase 7a 종료**다(백엔드 전체 종료가 아니다 — §4.10 제출 UI·§4.4 그룹장 패널·모집 시작/지금 시작·태그 편집·`node_move` UI·라우트별 loading/not-found 는 plan 06 = Phase 7b).

1. `npm run lint && npx tsc --noEmit && npx vitest run` 통과 — 이 플랜의 Vitest 파일 15개(`errors`, `routes`, `kst`, `me`, `notifications`, `otp`, `nickname`, `invite`, `format`, `rooms`, `validate`, `room-view`, `model`, `my-study`, `schedule`) + plan 01 의 `return-to` 전부 PASS.
2. `npm run build` 통과, 새 라우트 5개(`/login`, `/onboarding`, `/me`, `/invite/[token]`, `/rooms/new`) 가 빌드 출력에 보인다.
3. Task 14 Step 1 의 grep 세 개가 비어 있다(목업 상수·`NEXT_PUBLIC_API_URL` 잔재 없음).
4. Task 15 체크리스트 10단계 전부 체크(Step 1 의 `kst_today()`·`meta_get` = 2026-10-12 확인 포함), 스크린샷 7장 존재.
5. Task 16 스모크 6항목 체크, Vercel 로그에 RPC 에러 없음.
6. `git log --oneline` 에 Task 1~14 커밋 14개 + 결과 문서 커밋이 있고, 모든 커밋에 `Co-Authored-By`·`Claude-Session` 트레일러가 있다(`git log --format=%B -n 16 | grep -c Claude-Session` ≥ 16).

## Self-Review 메모

작성 후 스펙(00 개요 · 01 결정 · 03 API · analysis §6 · 디자인 §4.1/4.3/4.12/4.13/4.14) 을 다시 대조한 결과와, 실행자가 알아야 할 결정 사항.

- **태스크 번호**: 이 파일 상단 "파일 구조" 표와 Review Focus 가 16-태스크 번호(Task 8 = `format.ts`, Task 13 = schedule)를 이미 가리키고 있어 그 번호를 따랐다. 팀 리드 요청의 "Task 3~10" 묶음은 각각 3+4 / 5+6+7 / 8+9+10 / 11 / 12 / 13 / 14 / 15+16 에 대응한다.
- **스펙 커버리지**: §4.1 로그인·온보딩(5·6), §4.3 방 만들기(10), §4.12 초대(7), §4.13 프로필(6), §4.14 헤더·알림(3·4), analysis main/roomview/mystudy/schedule §6 전환표(9·11·12·13), D1 slug·문자열 id(어댑터 전부), D6 returnTo(2·5), D7 비로그인·404(11·12 페이지), D13 문구 조립(8), D14 ended+member→joined(11), round(days/7)주(8). **커버하지 않는 것 → plan 06(00 개요 등록, Phase 7b)**: §4.10 과제 제출·파일 업로드 화면, §4.4 그룹장 사이드 패널(승인/거절·초대 링크 복사), 모집 시작·지금 시작 버튼, §2.6 태그 수동 편집, §4.6 들여쓰기·드래그(`node_move`), §4.11 설정 탭(이탈 처리·알림 설정·방 삭제), §5 라우트별 `loading`/`not-found`/권한 없음. 이 플랜은 루트 `error.tsx` + `meta_get` 폴백만 둔다. 알림 Realtime 은 2단계. Task 15 는 제출을 시드 데이터로, 승인을 SQL 로 대체했다.
- **RPC 인자 이름**은 플랜 03·04 가 아직 확정되지 않아 가정값이다(상단 표). 실행자는 각 어댑터 태스크 첫 단계에서 `database.types.ts` 와 대조한다. `rpc()` 가 `Record<string, unknown>` 을 받는 것은 의도된 느슨함이며, 이름이 틀리면 PostgREST 가 `PGRST202`(함수 없음) → `toApiError` 가 `UNKNOWN` + 원문으로 떨어뜨리므로 화면에서 바로 보인다.
- **`safeReturnTo` 단일 출처**: plan 01 `src/lib/supabase/return-to.ts` 의 `safeReturnTo`·`loginUrl` 을 Task 2 가 `routes.ts` 에서 re-export 만 한다(재구현 없음 — `routes.test.ts` 가 같은 함수 참조인지 단언). Vitest 설정도 plan 01 것을 재사용(Task 1 Step 1 은 확인만).
- **기준일·숫자**: aws 내 진척률은 D5 의 2/6 = **33%**(목업 50% 폐기), "N주 완주" = 기간 주 수(`periodWeeks`, algo 13), "N회차" = depth-2 노드 수(algo 시드 3) — D14. E2E 는 seed 의 `app.today` 고정(2026-10-12)으로 정확값을 단언한다.
- **타입 변경 범위**: `RoomId`(room-view·my-study) 와 `StudyId` 를 리터럴 유니온 → `string` 으로 넓히고, `Task.id` 를 number → string 으로 바꿨다. Global Constraints 의 "유니온 확장만 허용" 범위 안으로 해석했으며, 목업 상수(`ROOMS` 등)는 그대로 컴파일된다. `CurTask.people` 튜플은 유지하고 `tones` 맵을 덧붙였다(상수 호환).
- **glance 규칙 차이**: 회차가 2개뿐인 jcg 는 목업 "2회차" 를 지키기 위해 "매주 X요일 시작" 을 회차 ≥ 3 일 때만 붙인다(roomview §3.7 의 "1종이면 매주" 보다 좁음). active 방의 tasks 문구는 목업 상수 "진행 중 · 공통·지정 혼합" 대신 analysis 제안 `"{leaf}개 · 공통 c · 지정 d"` 를 채택했다.
- **sidebar `left`·`when`** 은 `me_studies.when` 으로만 만들고, 사이드바는 `room_get` 을 다시 부르지 않는다(제목·소개는 `StudyItem` 에 있음).
- **낙관적 갱신 범위**: 구조 변경(생성·삭제·보관)만 Overrides 로 즉시 반영하고 응답으로 교체한다. 내용 변경은 저장 전까지 로컬이며, 다른 노드로 이동해도 유지된다(기존 동작). 저장 실패 시 오버라이드를 지우지 않으므로 사용자가 다시 시도할 수 있다.
- **Review Focus 재확인**: 1 → Task 8 `periodCard` spring 사례 ✓, 2 → Task 8 `curIndexOf`/`roundsWindow`/`curOf` gap 사례 ✓, 3 → Task 13 `toScheduleData` st null 사례 + upcoming 의 null 항목 제외 사례 ✓, 4 → Task 1 ✓(기존), 5 → Task 2 ✓(plan 01 강한 버전 재사용, `/\evil.com`·`/rooms/../me` 포함).
- **Placeholder 검사**: "TBD/TODO/나중에/similar to" 없음. 타입 확장은 전체 타입 블록으로 적었다(말줄임 없음). Task 7 은 `format.ts` 의 `periodLong` 하나만 쓴다(별도 `periodOf` 없음) — 선행 의존은 본문에 명시. `RoomSidebar`·MyStudy 컴포넌트 다수는 "바꿀 곳만" 산문으로 지시한다(파일 전체 재작성 아님).
