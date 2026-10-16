# 과제 상세 · 제출 (plan 06 §4.10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보기 모드 과제 상세에서 담당자가 마크다운 본문·링크·파일로 제출·수정하고, 모두가 담당자별 제출 현황을 보고(권한 안에서 펼쳐 읽기), 알림·일정·보드·간트 진입이 제출 영역에 포커스되게 한다.

**Architecture:** 백엔드는 이미 있는 `task_get`·`file_register`·`submission_upsert`(0007)를 쓴다. 유일한 백엔드 추가는 선택 사항인 0015 `file_discard`(Task 10, 사용자 결정 D1). 순수 로직은 `src/components/my-study/submission.ts`·`uploads.ts`·`submissionDraft.ts`(vitest), Supabase 접근은 `src/lib/api/submission.ts`·`src/lib/api/upload.ts` 어댑터(D13 — 컴포넌트는 Supabase 를 모른다). 화면은 `tabs/SubmissionSection.tsx`(데이터·포커스) → `MySubmissionCard.tsx`(보기/작성) + `SubmissionStatusList.tsx`(현황). `LeafBody` 의 담당자 격자를 현황 목록으로 바꾼다.

**Tech Stack:** Next.js 16.4 (App Router) · React 19.3 · Tailwind v4 · Supabase RPC/Storage REST · vitest(node, `src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom` + `renderToStaticMarkup`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-16-task-submission-design.md`

## Global Constraints

- 마이그레이션은 **0015 만**(Task 10, D1 = 예일 때). 0013(백엔드 백로그)·0014(개인 과제)는 다른 작업 소유 — 만들거나 고치지 않는다. 기존 마이그레이션 수정 금지.
- 이 저장소의 SQL 테스트는 pgTAP 이 아니라 `supabase/tests/*-sql.test.ts`(deno + PGlite, `_harness.ts`·`_fixtures.ts`)다. 같은 방식으로 쓴다.
- 문구는 스펙 §2 그대로(한국어). 사용자 용어: "진행목표", "과제", "제출". 코드 식별자·`?tab=curriculum` 은 그대로.
- 한 페이지 스크롤: 새 영역에 안쪽 세로 스크롤러(`overflow-y-auto`, `max-h-*`+overflow) 금지. `MarkdownEditor` 는 `maxHeight="none"`.
- 누르는 자리 ≥ 44px(`h-11`/`min-h-11`), 행 버튼 `aria-label` 에 대상(파일명·URL·사람 이름) 포함. 상태는 `StatusIcon`(색+모양).
- 레이아웃 확인 폭 390 / 820 / 1440, 가로 스크롤 없음.
- 서버 저장은 확정형(응답으로만 화면 갱신, 스펙 R4). 클라이언트는 Storage 객체를 지우지 않는다(R13).
- localStorage 접근은 전부 try/catch, 없어도 동작.
- Supabase 는 `src/lib/api/*` 에서만 import. 새 npm 의존성 금지.
- Next API 를 새로 쓰면 먼저 `node_modules/next/dist/docs/` 해당 문서를 읽는다(이 플랜은 새 Next API 를 쓰지 않는 것이 목표).
- 서브에이전트 금지(각 작업자 스스로 실행).
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 종료. `lsof -iTCP:3700 -sTCP:LISTEN -P` 로 다른 서버 확인. dev 서버는 `npx next dev -p 3700`.
- 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지. 쿠키/스토리지 삭제 금지. 로그인 정보는 `.superpowers/sdd/2026-10-14-editor-ux/common.md`.
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run` (Task 10 은 `npm run test:db` 추가). 커밋은 `git commit -- <paths>` 로 자기 파일만. 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```
- 줄 번호는 이 플랜 작성 시점 기준 — 항상 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. **처음 제출의 비가역성** — 시각·지각은 첫 `submission_upsert` 에 고정된다. 낙관적 갱신·자동 제출(임시 저장이 RPC 를 부르는 실수)이 없어야 한다. → Task 3(임시본은 localStorage 만), Task 8(주 버튼만 RPC).
2. **카드 상태 판정 순서** — 담당 해제 + 기존 제출, 종료 방 + 기존 제출, 보관 + 기존 제출이 "읽기 전용" 으로, 시작 전이 "작성 숨김" 으로. → Task 2 `myCardStateOf` 테스트.
3. **Storage 키 형식** — 서버 정규식(`0007:193-194`, `0003:149`)과 한 글자라도 다르면 업로드·등록이 거절된다. 대문자 확장자·확장자 없음·`.tar.gz`. → Task 2 `objectKey`/`extOf` 테스트.
4. **열람 권한 누출 없음** — 현황 줄 펼침은 `task_get.submissions` 에 있는 것만. 트리의 `people` 로 제출물을 추측해 그리지 않는다. → Task 2 `statusRows`, Task 7 DOM 테스트.
5. **빼기 의미** — 저장된 제출에 붙은 파일은 목록에서만 빼고(다음 저장이 soft delete), 미연결 파일만 `file_discard`. 반대로 하면 저장된 제출이 깨진다. → Task 6 `removePlanOf` 테스트, Task 10 SQL 테스트 `FILE_ATTACHED`.
6. **포커스 한 번만** — `viewFocus` 가 남으면 재조회마다 화면이 튄다. → Task 5·9.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 작업 트리 확인**

Run: `git -C /Users/picpal/Desktop/workspace/sgtudy status --short && git -C /Users/picpal/Desktop/workspace/sgtudy log --oneline -5`
Expected: `src/components/my-study/**`·`src/lib/api/**` 에 커밋 안 된 변경 없음. 있으면 **멈추고** 보고(다른 에이전트 작업 중).

- [ ] **Step 2: 자리표 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && grep -n "plan 06: 제출" src/components/my-study/tabs/LeafBody.tsx && ls supabase/migrations | tail -3`
Expected: LeafBody 에 자리표 1줄. 마지막 마이그레이션 번호를 기록(0015 가 이미 있으면 멈추고 보고).

- [ ] **Step 3: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과. 실패하면 멈추고 보고.

- [ ] **Step 4: D1 확인** — 컨트롤러에게 D1(0015 `file_discard`) 결정을 묻고 기록. "아니오" 면 Task 10 을 건너뛰고 Task 1 의 `discardFile`·Task 8 의 호출을 빼며 Task 6 의 `removePlanOf` 는 `"discard"` 대신 `"drop"` 만 쓴다.

---

### Task 1: DTO 타입 + 어댑터 `src/lib/api/submission.ts` (mechanical · sonnet)

**Files:**
- Modify: `src/lib/api/types.ts` (끝에 추가)
- Create: `src/lib/api/submission.ts`
- Create: `src/lib/api/submission.test.ts`
- Modify: `src/lib/api/errors.ts` (브라우저 클라이언트 getter export)

- [ ] **Step 1: 타입 추가** — `src/lib/api/types.ts` 끝:

```ts
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
```

- [ ] **Step 2: errors.ts** — `const browserClient = …` 아래에 `export const browserDb = (): Db => browserClient();` 한 줄.

- [ ] **Step 3: 실패하는 테스트** — `src/lib/api/submission.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { discardFile, fetchTask, fileUrl, registerFile, roomIdOfNode, upsertSubmission } from "./submission";

type Call = [string, unknown];
const fake = (opts: { rpc?: unknown; row?: unknown; signed?: string } = {}) => {
  const calls: Call[] = [];
  const q = {
    select: (c: string) => { calls.push(["select", c]); return q; },
    eq: (k: string, v: unknown) => { calls.push(["eq", [k, v]]); return q; },
    single: () => Promise.resolve({ data: opts.row ?? null, error: null }),
  };
  const client = {
    rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data: opts.rpc ?? {}, error: null }); },
    from: (t: string) => { calls.push(["from", t]); return q; },
    storage: { from: (b: string) => ({ createSignedUrl: (p: string, s: number, o: unknown) => { calls.push(["sign", [b, p, s, o]]); return Promise.resolve({ data: { signedUrl: opts.signed ?? "https://x/s" }, error: null }); } }) },
  } as unknown as Db;
  return { calls, client };
};

describe("submission adapter", () => {
  it("fetchTask → task_get(p_slug, p_node:number)", async () => {
    const f = fake({ rpc: { today: "2026-10-12" } });
    expect(await fetchTask("aws", "21", f.client)).toEqual({ today: "2026-10-12" });
    expect(f.calls).toEqual([["task_get", { p_slug: "aws", p_node: 21 }]]);
  });
  it("upsertSubmission sends body, links, fileIds", async () => {
    const f = fake();
    await upsertSubmission("21", { body: "b", links: ["https://a"], fileIds: ["f1"] }, f.client);
    expect(f.calls).toEqual([["submission_upsert", { p_node: 21, p_body: "b", p_links: ["https://a"], p_file_ids: ["f1"] }]]);
  });
  it("registerFile → file_register", async () => {
    const f = fake();
    await registerFile("21", { path: "1/21/u/x.png", name: "노트.png", mime: "image/png", size: 4 }, f.client);
    expect(f.calls).toEqual([["file_register", { p_node: 21, p_path: "1/21/u/x.png", p_name: "노트.png", p_mime: "image/png", p_size: 4 }]]);
  });
  it("discardFile → file_discard (0015)", async () => {
    const f = fake();
    await discardFile("f1", f.client);
    expect(f.calls).toEqual([["file_discard", { p_file: "f1" }]]);
  });
  it("roomIdOfNode reads goal_nodes.room_id under RLS", async () => {
    const f = fake({ row: { room_id: 7 } });
    expect(await roomIdOfNode("21", f.client)).toBe("7");
    expect(f.calls).toEqual([["from", "goal_nodes"], ["select", "room_id"], ["eq", ["id", 21]]]);
  });
  it("fileUrl reads object_path then signs for 300s as a download with the original name", async () => {
    const f = fake({ row: { object_path: "1/21/u/x.png" }, signed: "https://signed" });
    expect(await fileUrl({ id: "f1", name: "노트.png" }, f.client)).toBe("https://signed");
    expect(f.calls.at(-1)).toEqual(["sign", ["attachments", "1/21/u/x.png", 300, { download: "노트.png" }]]);
  });
});
```

- [ ] **Step 4: 실패 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/lib/api/submission.test.ts` → FAIL(모듈 없음).

- [ ] **Step 5: 구현** — `src/lib/api/submission.ts`:

```ts
import { ApiException, browserDb, rpc, toApiError, type Db } from "./errors";
import type { FileMeta, Submission, TaskDetail } from "./types";

/* 과제 상세·제출 어댑터 (0007_submissions.sql). 컴포넌트는 이 파일만 부른다 (D13) */
export const BUCKET = "attachments";
const num = (id: string) => Number(id);

export const fetchTask = (slug: string, nodeId: string, client?: Db) => rpc<TaskDetail>("task_get", { p_slug: slug, p_node: num(nodeId) }, client);
export const upsertSubmission = (nodeId: string, d: { body: string; links: string[]; fileIds: string[] }, client?: Db) =>
  rpc<Submission>("submission_upsert", { p_node: num(nodeId), p_body: d.body, p_links: d.links, p_file_ids: d.fileIds }, client);
export const registerFile = (nodeId: string, f: { path: string; name: string; mime: string; size: number }, client?: Db) =>
  rpc<FileMeta>("file_register", { p_node: num(nodeId), p_path: f.path, p_name: f.name, p_mime: f.mime, p_size: f.size }, client);
/** 0015 — 제출에 연결되지 않은 내 첨부를 정리(업로드 한도에서 뺀다). 연결된 파일은 FILE_ATTACHED */
export const discardFile = (fileId: string, client?: Db) => rpc<{ id: string; status: "deleted" }>("file_discard", { p_file: fileId }, client);

async function single<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiException(toApiError(error));
  if (!data) throw new ApiException({ code: "NOT_FOUND", message: "찾을 수 없어요" });
  return data as T;
}

/** Storage 키의 room 세그먼트 — DTO 에 room id 가 없어 goal_nodes 를 RLS 로 읽는다 (스펙 R8) */
export async function roomIdOfNode(nodeId: string, client?: Db): Promise<string> {
  const c = client ?? browserDb();
  const row = await single<{ room_id: number }>(c.from("goal_nodes").select("room_id").eq("id", num(nodeId)).single());
  return String(row.room_id);
}

/** 첨부 열기 — FileMeta 에 경로가 없어 files.object_path 를 RLS 로 읽고 300초 서명 URL (03-api §5) */
export async function fileUrl(f: Pick<FileMeta, "id" | "name">, client?: Db): Promise<string> {
  const c = client ?? browserDb();
  const row = await single<{ object_path: string }>(c.from("files").select("object_path").eq("id", f.id).single());
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(row.object_path, 300, { download: f.name });
  if (error || !data) throw new ApiException({ code: "UNKNOWN", message: "파일을 열 수 없어요" });
  return data.signedUrl;
}
```

(타입 오류가 나면 `c.from(...)` 체인을 `as unknown as PromiseLike<…>` 로 맞춘다 — database.types 의 `goal_nodes`/`files` Row 에 두 컬럼이 있는지 먼저 `grep -n "object_path\|room_id" src/lib/supabase/database.types.ts`.)

- [ ] **Step 6: 통과 확인** — 같은 명령 → PASS. 게이트 후 커밋 `feat(submission): 과제 상세·제출 DTO 와 어댑터`.

---

### Task 2: 순수 로직 `src/components/my-study/submission.ts` (judgment · opus)

**Files:**
- Create: `src/components/my-study/submission.ts`
- Create: `src/components/my-study/submission.test.ts`

- [ ] **Step 1: 실패하는 테스트** — `submission.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Submission, TaskDetail } from "@/lib/api/types";
import {
  SUB_LIMITS, addLink, checkFile, extOf, focusTargetOf, metaLine, mimeOf, myBadgeOf, myCardStateOf, objectKey,
  sizeText, stampKst, statusRows, submitBlocker, submitErrorAction, submitLabel,
} from "./submission";

const sub = (o: Partial<Submission> = {}): Submission =>
  ({ id: "s1", bodyMd: "본문", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: false, updatedAt: "2026-10-12T03:00:00.000Z", ...o });
const P = (userId: string, nickname: string, status: "done" | "late" | "missed" | "open" | "planned") => ({ userId, nickname, tone: "mint" as const, status });
const detail = (o: Partial<TaskDetail> = {}, node: Partial<TaskDetail["node"]> = {}): TaskDetail => ({
  today: "2026-10-12",
  node: { id: "21", parentId: "2", roundId: "2", depth: 3, sortOrder: 1, label: null, title: "EC2", descriptionMd: "", startDate: "2026-10-08", endDate: "2026-10-14", archived: false,
    task: { type: "designated", people: [P("u3", "지은", "done"), P("u1", "철수", "open")], assigned: 2, submitted: 1, state: "progress" }, assigned: 2, submitted: 1, pct: 50, ...node },
  path: [], mySubmission: null, isAssignee: true, allSubmitted: false, submissions: [], ...o,
});

describe("extOf / objectKey (서버 키 정규식 0007:193-194)", () => {
  it("lowercases, keeps last segment, drops invalid", () => {
    expect(extOf("photo.PNG")).toBe("png");
    expect(extOf("a.tar.gz")).toBe("gz");
    expect(extOf("README")).toBeNull();
    expect(extOf(".env")).toBeNull();
    expect(extOf("x.한글")).toBeNull();
    expect(extOf("x.abcdefghijk")).toBeNull(); // 11자
  });
  it("builds {room}/{node}/{user}/{uuid}[.ext]", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(objectKey("7", "21", "u-1", id, "노트.PNG")).toBe(`7/21/u-1/${id}.png`);
    expect(objectKey("7", "21", "u-1", id, "README")).toBe(`7/21/u-1/${id}`);
  });
});

describe("mimeOf / checkFile", () => {
  it("trusts an allowed browser type, falls back to extension when empty", () => {
    expect(mimeOf({ name: "a.png", type: "image/png" })).toBe("image/png");
    expect(mimeOf({ name: "a.md", type: "" })).toBe("text/markdown");
    expect(mimeOf({ name: "a.zip", type: "" })).toBe("application/zip");
    expect(mimeOf({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(mimeOf({ name: "a.exe", type: "" })).toBeNull();
  });
  it("rejects size, type and slot overflow with spec copy", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: SUB_LIMITS.fileBytes + 1 }, 5)).toEqual({ ok: false, error: "10MB를 넘는 파일이에요" });
    expect(checkFile({ name: "a.exe", type: "", size: 1 }, 5)).toEqual({ ok: false, error: "올릴 수 없는 형식이에요" });
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 }, 0)).toEqual({ ok: false, error: "첨부는 5개까지예요" });
    expect(checkFile({ name: "a.png", type: "image/png", size: SUB_LIMITS.fileBytes }, 1)).toEqual({ ok: true, mime: "image/png" });
    expect(checkFile({ name: "a.png", type: "image/png", size: 0 }, 1)).toEqual({ ok: false, error: "빈 파일은 올릴 수 없어요" });
  });
});

describe("addLink", () => {
  it("trims and appends http(s) links", () => expect(addLink("  https://a.example/x ", [])).toEqual({ ok: true, links: ["https://a.example/x"] }));
  it("rejects non-http, spaces, duplicates, overflow, too long", () => {
    expect(addLink("ftp://a", [])).toEqual({ ok: false, error: "http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요" });
    expect(addLink("https://a b", [])).toMatchObject({ ok: false });
    expect(addLink("https://a", ["https://a"])).toEqual({ ok: false, error: "이미 넣은 링크예요" });
    expect(addLink("https://z", Array.from({ length: 20 }, (_, i) => `https://${i}`))).toEqual({ ok: false, error: "링크는 20개까지예요" });
    expect(addLink("https://" + "a".repeat(2000), [])).toMatchObject({ ok: false });
    expect(addLink("   ", [])).toEqual({ ok: false, error: "" }); // 빈 입력은 조용히 무시
  });
});

describe("submitBlocker", () => {
  const ready = { status: "ready" as const };
  it("needs one of body/link/file", () => expect(submitBlocker({ body: "  ", links: [], files: [] }, true)).toBe("내용·링크·파일 중 하나는 있어야 해요"));
  it("blocks while uploading or with failed rows", () => {
    expect(submitBlocker({ body: "a", links: [], files: [{ status: "uploading" }] }, true)).toBe("파일을 올리는 중이에요");
    expect(submitBlocker({ body: "a", links: [], files: [{ status: "error" }] }, true)).toBe("올리지 못한 파일을 빼거나 다시 올려 주세요");
  });
  it("offline and body length", () => {
    expect(submitBlocker({ body: "a", links: [], files: [] }, false)).toBe("인터넷 연결을 확인해 주세요");
    expect(submitBlocker({ body: "a".repeat(50_001), links: [], files: [] }, true)).toBe("본문은 50,000자까지예요");
  });
  it("ok with only a file", () => expect(submitBlocker({ body: "", links: [], files: [ready] }, true)).toBeNull());
});

describe("myCardStateOf — 판정 순서 (Review Focus 2)", () => {
  const S = (d: TaskDetail, room: "draft" | "recruit" | "active" | "ended" = "active") => myCardStateOf(d, room);
  it("not assignee, nothing submitted → hidden", () => expect(S(detail({ isAssignee: false }))).toEqual({ kind: "hidden" }));
  it("released with a submission → readonly", () =>
    expect(S(detail({ isAssignee: false, mySubmission: sub() }))).toEqual({ kind: "readonly", note: "담당에서 빠져 더 고칠 수 없어요 · 제출물은 남아 있어요" }));
  it("ended room", () => {
    expect(S(detail({ mySubmission: sub() }), "ended")).toEqual({ kind: "readonly", note: "종료된 스터디라 더 고칠 수 없어요" });
    expect(S(detail(), "ended")).toEqual({ kind: "blocked", note: "종료된 스터디라 제출할 수 없어요" });
  });
  it("room not started", () => expect(S(detail(), "recruit")).toEqual({ kind: "blocked", note: "스터디가 시작되면 제출할 수 있어요" }));
  it("archived task", () => {
    expect(S(detail({ mySubmission: sub() }, { archived: true }))).toEqual({ kind: "readonly", note: "보관된 과제라 제출·수정할 수 없어요" });
    expect(S(detail({}, { archived: true }))).toEqual({ kind: "blocked", note: "보관된 과제라 제출·수정할 수 없어요" });
  });
  it("before start → blocked with date", () => expect(S(detail({}, { startDate: "2026-10-15" }))).toEqual({ kind: "blocked", note: "10.15(목)부터 제출할 수 있어요" }));
  it("submitted → submitted, else compose", () => {
    expect(S(detail({ mySubmission: sub() }))).toEqual({ kind: "submitted" });
    expect(S(detail())).toEqual({ kind: "compose" });
  });
});

describe("labels", () => {
  it("submitLabel", () => {
    expect(submitLabel(null, "2026-10-12", "2026-10-14")).toBe("제출하기");
    expect(submitLabel(null, "2026-10-15", "2026-10-14")).toBe("지각 제출하기");
    expect(submitLabel(sub(), "2026-10-15", "2026-10-14")).toBe("수정 저장");
  });
  it("myBadgeOf", () => {
    expect(myBadgeOf(detail())).toEqual({ status: "open", text: "제출 전 · D-2" });
    expect(myBadgeOf(detail({ today: "2026-10-15" }))).toEqual({ status: "missed", text: "미제출 · 마감 지남" });
    expect(myBadgeOf(detail({ mySubmission: sub({ isLate: true }) }))).toEqual({ status: "late", text: "지각 제출" });
    expect(myBadgeOf(detail({ mySubmission: sub() }))).toEqual({ status: "done", text: "기한내 제출" });
    expect(myBadgeOf(detail({}, { startDate: "2026-10-13" }))).toEqual({ status: "planned", text: "예정" });
  });
  it("stampKst / metaLine / sizeText", () => {
    expect(stampKst("2026-10-12T03:00:00.000Z")).toBe("10.12(월) 12:00");
    expect(stampKst("2026-10-03T15:00:30.000Z")).toBe("10.04(일) 00:00");
    expect(metaLine(sub())).toBe("처음 제출 10.12(월) 12:00");
    expect(metaLine(sub({ updatedAt: "2026-10-13T00:10:00.000Z" }))).toBe("처음 제출 10.12(월) 12:00 · 마지막 수정 10.13(화) 09:10");
    expect(sizeText(900)).toBe("900B");
    expect(sizeText(4096)).toBe("4KB");
    expect(sizeText(1_572_864)).toBe("1.5MB");
  });
});

describe("statusRows (Review Focus 4)", () => {
  it("assignees in order, attaches readable submissions, marks me", () => {
    const d = detail({ submissions: [{ ...sub({ id: "a" }), author: { userId: "u3", nickname: "지은", tone: "peach" } }] });
    const rows = statusRows(d, "u1");
    expect(rows.map((r) => [r.userId, r.status, r.me, r.submission?.id ?? null, r.released])).toEqual([["u3", "done", false, "a", false], ["u1", "open", true, null, false]]);
  });
  it("appends released authors after assignees", () => {
    const d = detail({ submissions: [{ ...sub({ id: "x", isLate: true }), author: { userId: "u9", nickname: "도윤", tone: "slate" } }] });
    expect(statusRows(d, "u1").at(-1)).toMatchObject({ userId: "u9", status: "late", released: true });
  });
  it("archived (people empty) builds rows from submissions only", () => {
    const d = detail({ submissions: [{ ...sub({ id: "a" }), author: { userId: "u3", nickname: "지은", tone: "peach" } }] }, { archived: true, task: { type: "common", people: [], assigned: 0, submitted: 0, state: "unassigned" } });
    expect(statusRows(d, "u2").map((r) => [r.userId, r.released])).toEqual([["u3", false]]);
  });
  it("never invents a submission for a done person without one (pending viewer)", () =>
    expect(statusRows(detail(), "u1")[0].submission).toBeNull());
});

describe("focusTargetOf", () => {
  it("compose → mine, otherwise status", () => {
    expect(focusTargetOf({ kind: "compose" })).toBe("mine");
    expect(focusTargetOf({ kind: "submitted" })).toBe("status");
    expect(focusTargetOf({ kind: "hidden" })).toBe("status");
  });
});

describe("submitErrorAction", () => {
  it("maps server codes", () => {
    for (const code of ["TASK_NOT_ASSIGNED", "TASK_ARCHIVED", "PARENT_ARCHIVED", "ROOM_NOT_ACTIVE", "TASK_NOT_STARTED", "NODE_NOT_FOUND"])
      expect(submitErrorAction({ code, message: "m" })).toEqual({ kind: "refetch", text: "m" });
    expect(submitErrorAction({ code: "FILE_NOT_READY", message: "m", details: { fileId: "f1" } })).toEqual({ kind: "file", fileId: "f1", text: "이 파일을 다시 올려 주세요" });
    expect(submitErrorAction({ code: "NOT_FOUND", message: "m", details: { fileId: "f1" } })).toEqual({ kind: "file", fileId: "f1", text: "이 파일을 다시 올려 주세요" });
    expect(submitErrorAction({ code: "INVALID_LINK", message: "m", details: { field: "links", index: "2" } })).toEqual({ kind: "link", index: 2, text: "m" });
    expect(submitErrorAction({ code: "AUTH_REQUIRED", message: "m" })).toEqual({ kind: "login", text: "m" });
    expect(submitErrorAction({ code: "UNKNOWN", message: "Failed to fetch" })).toEqual({ kind: "toast", text: "제출하지 못했어요 · 연결을 확인하고 다시 눌러 주세요" });
    expect(submitErrorAction({ code: "VALIDATION_FAILED", message: "본문은 50,000자까지예요" })).toEqual({ kind: "toast", text: "본문은 50,000자까지예요" });
  });
});
```

(주의: 서버 hint 의 `index` 는 숫자 JSON 이지만 `ApiError.details` 타입이 `Record<string,string>` 이라 `Number(...)` 로 읽는다. `AUTH_REQUIRED` 코드 이름은 `grep -n "AUTH_REQUIRED" supabase/migrations/0002_functions_core.sql` 로 확인.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/components/my-study/submission.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `submission.ts` (React 무관). 핵심 규칙:
  - `SUB_LIMITS = { body: 50_000, bodyWarn: 45_000, links: 20, linkLen: 2000, files: 5, fileBytes: 10_485_760 }`, `ALLOWED_MIME` = 0007:13-14 와 같은 9개, `EXT_MIME` = png·jpg·jpeg·gif·webp·pdf·zip·txt·md·markdown.
  - `extOf(name)`: 마지막 `.` 뒤(첫 글자가 `.` 인 이름 전체는 제외), 소문자, `/^[a-z0-9]{1,10}$/` 아니면 null.
  - `mimeOf`: `type` 이 비었으면 확장자, 비지 않았으면 ALLOWED 에 있을 때만 그 값. 그 외 null.
  - `checkFile(f, slotsLeft)`: 순서 slots(≤0 → "첨부는 5개까지예요") → mime → size 0 → size 초과.
  - `addLink(raw, links)`: trim, 빈 문자열 → `{ok:false, error:""}`, 개수 → 정규식 `^https?:\/\/\S+$`(대소문자 무시) → 길이 → 중복.
  - `submitBlocker(d, online)`: online → 업로드 중 → 오류 줄 → 본문 길이 → 비어 있음. (테스트 순서와 맞출 것.)
  - `myCardStateOf(d, roomStatus)`: 스펙 §2.2 표 순서. 날짜는 `md`·`weekdayKo`(`@/lib/date`).
  - `myBadgeOf(d)`: mine → late/done, `today < start` → planned "예정", `today > end` → missed, 그 외 open `제출 전 · ${dday(today,end)}`.
  - `stampKst(iso)`: `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts` → `${md(ymd)}(${weekdayKo(ymd)}) HH:MM`.
  - `metaLine`: 수정 시각이 처음 제출보다 60초 넘게 뒤일 때만 뒤 조각.
  - `sizeText`: <1024 B, <1 MiB 반올림 KB, 그 외 소수 1자리 MB.
  - `statusRows(d, meId)`: `people` 순서 + `submissions` 매칭(author.userId), people 에 없는 author → `released: true`(단 people 이 비어 있는 보관 리프면 false), status = 제출 있으면 late/done. 반환 `{ userId, name, tone, status, me, released, submission }`.
  - `focusTargetOf(state)`, `submitErrorAction(err)` — 테스트대로.

- [ ] **Step 4: 통과 확인** → PASS. 게이트, 커밋 `feat(submission): 제출 상태·검증·키 규칙 순수 로직`.

---

### Task 3: 이 기기 임시 저장 `src/components/my-study/submissionDraft.ts` (mechanical · sonnet)

**Files:**
- Create: `src/components/my-study/submissionDraft.ts`
- Create: `src/components/my-study/submissionDraft.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { clearDraft, draftDiffers, draftKey, readDraft, writeDraft, type Draft } from "./submissionDraft";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
const D: Draft = { body: "b", links: ["https://a"], files: [{ id: "f1", name: "a.png", contentType: "image/png", size: 4, status: "ready" }], at: "2026-10-12T03:00:00.000Z" };

describe("submission draft", () => {
  it("key is per node and user", () => expect(draftKey("21", "u1")).toBe("sgtudy.subdraft.v1:21:u1"));
  it("round-trips", () => { const s = mem(); writeDraft(s, "k", D); expect(readDraft(s, "k")).toEqual(D); clearDraft(s, "k"); expect(readDraft(s, "k")).toBeNull(); });
  it("ignores broken JSON and wrong shapes", () => { const s = mem(); s.setItem("k", "{"); expect(readDraft(s, "k")).toBeNull(); s.setItem("k", JSON.stringify({ body: 1 })); expect(readDraft(s, "k")).toBeNull(); });
  it("never throws when storage is blocked or missing", () => {
    expect(readDraft(boom, "k")).toBeNull(); expect(() => writeDraft(boom, "k", D)).not.toThrow(); expect(() => clearDraft(null, "k")).not.toThrow();
  });
  it("differs from the saved submission?", () => {
    expect(draftDiffers(D, null)).toBe(true);
    expect(draftDiffers({ ...D, body: "", links: [], files: [] }, null)).toBe(false);
    expect(draftDiffers(D, { bodyMd: "b", links: ["https://a"], files: D.files })).toBe(false);
    expect(draftDiffers(D, { bodyMd: "c", links: ["https://a"], files: D.files })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** → `npx vitest run src/components/my-study/submissionDraft.test.ts` FAIL.
- [ ] **Step 3: 구현** — `type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null`, `Draft = { body: string; links: string[]; files: FileMeta[]; at: string }`. 모든 함수 try/catch. `readDraft` 는 `typeof body === "string" && Array.isArray(links) && Array.isArray(files)` 검사. `draftDiffers(d, saved)`: saved 가 null 이면 내용이 하나라도 있으면 true; 아니면 body·links·files id 목록 비교. **RPC 를 부르지 않는다**(Review Focus 1).
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(submission): 제출 작성 임시 저장(localStorage)`.

---

### Task 4: 진행률 업로드 `src/lib/api/upload.ts` (judgment · opus)

**Files:**
- Create: `src/lib/api/upload.ts`
- Create: `src/lib/api/upload.test.ts`

Storage REST: `POST {NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/attachments/{key}`, 헤더 `authorization: Bearer {access_token}`, `apikey: {anon key}`, `content-type: {mime}`, `x-upsert: false`, 본문 = File. 403 = 정책 거부(담당 아님), 413 = 크기, 415/400 = 형식.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { uploadObject, uploadErrorText } from "./upload";

class FakeXhr {
  static last: FakeXhr;
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown; status = 0; aborted = false;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
  send(b: unknown) { this.body = b; }
  abort() { this.aborted = true; this.onabort?.(); }
}
const base = { url: "https://p.supabase.co", anonKey: "anon", token: "tok", key: "7/21/u/x.png", body: new Blob(["x"]), contentType: "image/png", xhr: () => new FakeXhr() as unknown as XMLHttpRequest };

describe("uploadObject", () => {
  it("POSTs to the storage object URL with auth headers and reports progress", async () => {
    const seen: number[] = [];
    const p = uploadObject({ ...base, onProgress: (n) => seen.push(n) });
    const x = FakeXhr.last;
    expect([x.method, x.url]).toEqual(["POST", "https://p.supabase.co/storage/v1/object/attachments/7/21/u/x.png"]);
    expect(x.headers).toMatchObject({ authorization: "Bearer tok", apikey: "anon", "content-type": "image/png", "x-upsert": "false" });
    x.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
    x.status = 200; x.onload?.();
    await p;
    expect(seen).toEqual([50, 100]);
  });
  it("rejects with a status on HTTP errors", async () => {
    const p = uploadObject(base);
    FakeXhr.last.status = 413; FakeXhr.last.onload?.();
    await expect(p).rejects.toMatchObject({ status: 413 });
  });
  it("aborts via signal", async () => {
    const ac = new AbortController();
    const p = uploadObject({ ...base, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ aborted: true });
    expect(FakeXhr.last.aborted).toBe(true);
  });
  it("network error → status 0", async () => {
    const p = uploadObject(base);
    FakeXhr.last.onerror?.();
    await expect(p).rejects.toMatchObject({ status: 0 });
  });
});

describe("uploadErrorText", () => {
  it("maps statuses to spec copy", () => {
    expect(uploadErrorText(413)).toBe("10MB를 넘는 파일이에요");
    expect(uploadErrorText(415)).toBe("올릴 수 없는 형식이에요");
    expect(uploadErrorText(403)).toBe("이 과제에 파일을 올릴 수 없어요");
    expect(uploadErrorText(0)).toBe("올리지 못했어요 · 다시 시도해 주세요");
    expect(uploadErrorText(500)).toBe("올리지 못했어요 · 다시 시도해 주세요");
  });
});
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/lib/api/upload.test.ts`.
- [ ] **Step 3: 구현** — `uploadObject(o: { url; anonKey; token; key; body: Blob; contentType; onProgress?: (pct: number) => void; signal?: AbortSignal; xhr?: () => XMLHttpRequest }): Promise<void>`; 실패는 `{ status: number; aborted?: true }` 객체로 reject. 키는 세그먼트별 `encodeURIComponent` 후 `/` 로 잇는다(지금 키는 ASCII 라 그대로). 성공 시 `onProgress(100)` 한 번. `uploadErrorText(status)`.
  추가로 같은 파일에 브라우저 전용 조립 함수:

```ts
/** 실제 업로드: 세션 토큰을 붙여 uploadObject. 컴포넌트는 이것만 부른다 */
export async function uploadAttachment(key: string, file: Blob, contentType: string, onProgress: (pct: number) => void, signal: AbortSignal): Promise<void> {
  const { data } = await browserDb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw { status: 401 };
  await uploadObject({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, token, key, body: file, contentType, onProgress, signal });
}
```
  `uploadErrorText(401)` = "로그인이 만료됐어요 · 다시 로그인해 주세요" (테스트 한 줄 추가).
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(submission): 진행률이 보이는 Storage 업로드`.

---

### Task 5: 진입 포커스 상태 `viewFocus` (mechanical · sonnet)

**Files:**
- Modify: `src/components/my-study/state.ts`
- Modify: `src/components/my-study/state.test.ts`
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (목록 행 클릭·DetailView onOpen 에서 `viewFocus: null`)

- [ ] **Step 1: 테스트 수정** — `state.test.ts` 의 goLeafPatch 기대값에 `viewFocus: "submission"` 추가, 그리고:

```ts
it("INITIAL_STATE has no pending focus", () => expect(INITIAL_STATE.viewFocus).toBeNull());
it("modeSwitchPatch clears a pending focus", () =>
  expect(modeSwitchPatch({ ...INITIAL_STATE, viewSel: "7", viewFocus: "submission" }, "edit")).toMatchObject({ viewFocus: null }));
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/components/my-study/state.test.ts`.
- [ ] **Step 3: 구현** — `ScreenState` 에 `/** 보기 상세가 열리며 한 번 옮길 포커스 — 보드·캘린더·간트·알림 진입은 제출 영역 (스펙 §2.6) */ viewFocus: "submission" | null;`, INITIAL `null`, `goLeafPatch` 에 `viewFocus: "submission"`, `modeSwitchPatch` 반환에 `viewFocus: null`. `CurriculumTab` 의 `update({ viewSel: n.id })` 와 DetailView `onOpen={(id) => update({ viewSel: id })}` 에 `viewFocus: null` 추가.
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(my-study): 과제 상세 진입 포커스 상태`.

---

### Task 6: 업로드 목록 리듀서 `src/components/my-study/uploads.ts` (judgment · opus)

**Files:**
- Create: `src/components/my-study/uploads.ts`
- Create: `src/components/my-study/uploads.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import type { FileMeta } from "@/lib/api/types";
import { fromSaved, removePlanOf, slotsLeft, uploadsReducer, readyIds, type UploadRow } from "./uploads";

const meta = (id: string): FileMeta => ({ id, name: `${id}.png`, contentType: "image/png", size: 4, status: "ready" });

describe("uploadsReducer", () => {
  it("add → progress → ready", () => {
    let s: UploadRow[] = [];
    s = uploadsReducer(s, { type: "add", row: { key: "k1", fileId: "f1", name: "a.png", size: 4, status: "uploading", progress: 0 } });
    s = uploadsReducer(s, { type: "progress", key: "k1", progress: 40 });
    expect(s[0]).toMatchObject({ status: "uploading", progress: 40 });
    s = uploadsReducer(s, { type: "ready", key: "k1", meta: meta("f1") });
    expect(s[0]).toMatchObject({ status: "ready", progress: 100, meta: meta("f1") });
  });
  it("fail keeps the row with an error; remove drops it; markError by fileId", () => {
    let s = fromSaved([meta("f1"), meta("f2")]);
    s = uploadsReducer(s, { type: "markError", fileId: "f2", error: "이 파일을 다시 올려 주세요" });
    expect(s[1]).toMatchObject({ status: "error", error: "이 파일을 다시 올려 주세요" });
    s = uploadsReducer(s, { type: "remove", key: s[0].key });
    expect(s.map((r) => r.fileId)).toEqual(["f2"]);
  });
  it("progress after remove is ignored (aborted upload races)", () =>
    expect(uploadsReducer([], { type: "progress", key: "gone", progress: 10 })).toEqual([]));
});

describe("helpers", () => {
  it("slotsLeft counts every row (uploading + ready + error)", () => expect(slotsLeft(fromSaved([meta("a"), meta("b")]))).toBe(3));
  it("readyIds in order", () => expect(readyIds(fromSaved([meta("a"), meta("b")]))).toEqual(["a", "b"]));
  it("removePlanOf: saved-attached → drop only; unattached ready → discard; uploading → abort; error → drop (Review Focus 5)", () => {
    const saved = new Set(["a"]);
    const rows = fromSaved([meta("a"), meta("b")]);
    expect(removePlanOf(rows[0], saved)).toBe("drop");
    expect(removePlanOf(rows[1], saved)).toBe("discard");
    expect(removePlanOf({ key: "k", fileId: "c", name: "c", size: 1, status: "uploading", progress: 5 }, saved)).toBe("abort");
    expect(removePlanOf({ key: "k", fileId: "c", name: "c", size: 1, status: "error", progress: 0, error: "x" }, saved)).toBe("drop");
  });
});
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/components/my-study/uploads.test.ts`.
- [ ] **Step 3: 구현** — `UploadRow = { key: string; fileId: string; name: string; size: number; status: "uploading" | "ready" | "error"; progress: number; error?: string; meta?: FileMeta }`. `fromSaved(files)` → ready 줄(key = `saved:${id}`). 액션 `add|progress|ready|fail{key,error}|markError{fileId,error}|remove{key}`. `slotsLeft = SUB_LIMITS.files - rows.length`. D1 = 아니오면 `"discard"` 를 `"drop"` 으로.
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(submission): 첨부 업로드 목록 상태`.

---

### Task 7: 제출 현황 목록 `tabs/SubmissionStatusList.tsx` (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/SubmissionStatusList.tsx`
- Create: `src/components/my-study/tabs/SubmissionStatusList.dom.test.ts`
- Create: `src/components/my-study/tabs/SubmissionView.tsx` (제출물 한 건 읽기: MarkdownView 본문 · 링크 목록 `<a target=_blank rel="noopener noreferrer">` · 파일 버튼 목록. 카드·현황 공용)

Props: `{ rows: StatusRow[]; sub: number; asg: number; note: string | null; headingRef?: Ref<HTMLHeadingElement>; onOpenFile: (f: FileMeta) => void }`. 펼침 상태는 컴포넌트 안 `useState<Set<string>>`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionStatusList } from "./SubmissionStatusList";
import type { StatusRow } from "../submission";

const row = (o: Partial<StatusRow>): StatusRow => ({ userId: "u3", name: "지은", tone: "peach", status: "done", me: false, released: false, submission: null, ...o });
const S = { id: "s", bodyMd: "**본문**", links: ["https://a.example"], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: true, updatedAt: "2026-10-12T03:00:00.000Z" };
const render = (rows: StatusRow[], note: string | null = null) => {
  const el = document.createElement("div");
  el.innerHTML = renderToStaticMarkup(createElement(SubmissionStatusList, { rows, sub: 1, asg: 2, note, onOpenFile: () => {} }));
  return el;
};

describe("SubmissionStatusList", () => {
  it("heading shows sub/asg and is focusable", () => {
    const h = render([row({})]).querySelector("h3")!;
    expect(h.textContent).toBe("제출 현황 1/2");
    expect(h.getAttribute("tabindex")).toBe("-1");
  });
  it("rows with a readable submission are 44px collapsed toggles; others are plain", () => {
    const doc = render([row({ submission: S, status: "late" }), row({ userId: "u1", name: "철수", status: "open", me: true })]);
    const btns = doc.querySelectorAll("button[aria-expanded]");
    expect(btns.length).toBe(1);
    expect(btns[0].getAttribute("aria-expanded")).toBe("false");
    expect(btns[0].className).toContain("min-h-11");
    expect(btns[0].getAttribute("aria-label")).toBe("지은 제출물 펼치기");
    expect(doc.textContent).toContain("지각");
    expect(doc.textContent).toContain("철수 (나)");
  });
  it("released authors get a tag; note renders", () => {
    const doc = render([row({ released: true, submission: S })], "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요");
    expect(doc.textContent).toContain("담당 제외");
    expect(doc.textContent).toContain("참가가 승인되면");
  });
  it("no inner vertical scroller", () => expect(render([row({ submission: S })]).innerHTML).not.toMatch(/overflow-y-auto|max-h-/));
});
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/components/my-study/tabs/SubmissionStatusList.dom.test.ts`.
- [ ] **Step 3: 구현** — 스펙 §2.4. 줄: `Avatar`(30) · 이름(+" (나)") · `StatusIcon` + `STATUS_LABEL` · `stampKst(firstSubmittedAt)` · 지각 배지 · 담당 제외 태그. 펼침 영역은 `SubmissionView`. `StatusRow` 타입은 Task 2 의 `statusRows` 반환 타입을 export 해서 쓴다.
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(submission): 담당자별 제출 현황 목록`.

---

### Task 8: 내 제출 카드 · 작성 화면 (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/MySubmissionCard.tsx` (머리: h3 "내 제출" + 배지 · 상태별 본문 · [수정하기])
- Create: `src/components/my-study/tabs/SubmissionComposer.tsx` (본문 `MarkdownEditor` · 링크 · 파일 · 버튼 줄)
- Create: `src/components/my-study/tabs/LinkListEditor.tsx`
- Create: `src/components/my-study/tabs/FileUploadList.tsx` (드롭존 + 줄 + 진행률)
- Create: `src/components/my-study/useSubmissionComposer.ts` (작성 상태·업로드 큐·임시 저장·제출)
- Create: `src/components/my-study/tabs/MySubmissionCard.dom.test.ts`

`useSubmissionComposer({ slug, nodeId, userId, detail, onSaved, onRefetch, toast })` 가 책임진다:
- 초기값 = `mySubmission`(없으면 빈 값) 또는 사용자가 [이어 쓰기]한 임시본. `rows` 는 `useReducer(uploadsReducer, fromSaved(mine.files))`.
- 파일 고르기: 각 파일 `checkFile(f, slotsLeft)` → 거절이면 오류 줄(`status:"error"`)만 추가. 통과하면 `fileId = crypto.randomUUID()`, `key = objectKey(roomId, nodeId, userId, fileId, name)`(roomId 는 처음 한 번 `roomIdOfNode`), 동시에 2개까지 `uploadAttachment` → 성공하면 `registerFile` → `ready`. 실패 → `uploadErrorText` 또는 서버 문구. `AbortController` 를 key 별로 보관, 언마운트 때 전부 abort.
- 빼기: `removePlanOf` → abort / drop / discard(`discardFile` 은 실패해도 조용히 무시 — best effort).
- 임시 저장: body·links·ready 파일이 바뀌면 500ms 뒤 `writeDraft`. `pendingWrite` 동안과 업로드 중엔 `beforeunload` 등록.
- 제출: `busy` ref 가드 → `upsertSubmission` → 성공: `clearDraft`, 토스트(처음·기한내 "제출했어요" / 처음·지각 "지각 제출했어요" / 수정 "수정했어요"), `onSaved(sub)` → 실패: `submitErrorAction` 대로(refetch → `onRefetch()` + 토스트, file → `markError`, link → 그 링크 줄 빨강, login → `router.push(routes.login(location.pathname + location.search))`, toast).
- `online` = `useSyncExternalStore`(online/offline 이벤트).

카드 문구·상태는 Task 2 함수만 쓴다(`myCardStateOf`, `myBadgeOf`, `submitLabel`, `submitBlocker`, `metaLine`).

- [ ] **Step 1: 실패하는 DOM 테스트** — 상태별 정적 렌더(작성 화면은 `MarkdownEditor` 가 dynamic 이라 스켈레톤만 나와도 된다):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MySubmissionCardView } from "./MySubmissionCard";

const sub = { id: "s", bodyMd: "본문", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: false, updatedAt: "2026-10-12T03:00:00.000Z" };
const html = (p: Parameters<typeof MySubmissionCardView>[0]) => { const d = document.createElement("div"); d.innerHTML = renderToStaticMarkup(createElement(MySubmissionCardView, p)); return d; };

describe("MySubmissionCardView", () => {
  it("submitted: badge, meta, 44px 수정하기", () => {
    const d = html({ state: { kind: "submitted" }, badge: { status: "done", text: "기한내 제출" }, mine: sub, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.querySelector("h3")?.textContent).toBe("내 제출");
    expect(d.textContent).toContain("기한내 제출");
    expect(d.textContent).toContain("처음 제출 10.12(월) 12:00");
    const b = Array.from(d.querySelectorAll("button")).find((x) => x.textContent === "수정하기")!;
    expect(b.className).toMatch(/h-11|min-h-11/);
  });
  it("readonly shows the note and no edit button", () => {
    const d = html({ state: { kind: "readonly", note: "보관된 과제라 제출·수정할 수 없어요" }, badge: { status: "done", text: "기한내 제출" }, mine: sub, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.textContent).toContain("보관된 과제라");
    expect(Array.from(d.querySelectorAll("button")).some((x) => x.textContent === "수정하기")).toBe(false);
  });
  it("blocked shows only the note", () => {
    const d = html({ state: { kind: "blocked", note: "10.15(목)부터 제출할 수 있어요" }, badge: { status: "planned", text: "예정" }, mine: null, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.textContent).toContain("10.15(목)부터");
    expect(d.querySelector("textarea, [contenteditable]")).toBeNull();
  });
});
```

(`MySubmissionCardView` = 훅 없는 표시 컴포넌트, `composer` 슬롯에 `SubmissionComposer` 를 넣는다. `MySubmissionCard` 는 훅을 쓰는 겉 컴포넌트.)

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/components/my-study/tabs/MySubmissionCard.dom.test.ts`.
- [ ] **Step 3: 구현** — 스펙 §2.2·§2.3·§2.7·§2.8. 버튼 줄 390 에서 `flex-wrap`. 주 버튼 비활성 이유는 `aria-describedby` 로 연결된 보이는 문장. 링크 입력 Enter 는 `e.nativeEvent.isComposing` 이면 무시. 드롭존은 `onDragOver` preventDefault + `onDrop` → 같은 파일 처리 함수, 키보드는 [파일 고르기] 버튼으로 대체. 진행률 줄은 `role="progressbar" aria-valuenow`.
- [ ] **Step 4: PASS**, 게이트, 커밋 `feat(submission): 내 제출 카드와 작성 화면`.

---

### Task 9: 상세 화면 연결 — `SubmissionSection` · LeafBody · 포커스 · 나가기 확인 · 재조회 (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/SubmissionSection.tsx`
- Create: `src/components/my-study/useTaskDetail.ts`
- Modify: `src/components/my-study/tabs/LeafBody.tsx` (담당자 격자 → `SubmissionSection`, 자리표 제거)
- Modify: `src/components/my-study/tabs/DetailView.tsx` (props `slug`, `roomStatus`, `focus`, `onFocused`, `onSubmitted`, 나가기 가드)
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (DetailView 에 `S.viewFocus`, `api.refresh`, `toast` 전달)
- Modify: `src/components/my-study/useCurriculumApi.ts` (`refresh: () => Promise<void>` = `fetchCurriculum(slug).then(setCur)` 추가)
- Modify: `src/components/my-study/MyStudyScreen.tsx` (CurriculumTab 에 `toast={setToast}` 전달 — 이미 api 는 받음)
- Create: `src/components/my-study/tabs/LeafBody.dom.test.ts`

동작:
- `useTaskDetail(slug, nodeId)` → `{ detail, error, loading, refetch }`. 노드가 바뀌면 새로 받고, 늦게 온 이전 응답은 버린다(요청 id 비교).
- `SubmissionSection`: `allSubmitted` 배너(role=status, "모든 담당자가 제출했어요") → (담당 아님 안내 / `MySubmissionCard`) → `SubmissionStatusList`. 로딩 중엔 카드 스켈레톤 + 트리 `people` 로 만든 현황(펼침 없음). 실패 시 "제출 정보를 불러오지 못했어요 [다시 시도]".
- 현황 안내 문구: PENDING(내가 `detail.me.state === "pending"` — `CurriculumTab` 에 `viewerPending` 으로 전달) → "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요"; 보관 리프 + 그룹장 아님 → "보관된 과제예요 · 제출물은 그룹장과 작성자만 볼 수 있어요".
- 제출 성공 → `refetch()` + `api.refresh()`.
- 포커스: `focus === "submission"` 이고 `detail` 이 처음 도착하면 `focusTargetOf(myCardStateOf(...))` 의 h3 로 `scrollIntoView({block:"start"})` + `focus({preventScroll:true})` 후 `onFocused()` → `update({ viewFocus: null })`. DetailView 의 기존 h2 포커스 effect 는 `focus` 가 있으면 건너뛴다.
- 나가기 가드: `SubmissionSection` 이 `onUploadingChange(boolean)` 을 올리고, DetailView 는 업로드 중일 때 [← 진행목표]·경로 버튼·Esc 를 바로 실행하지 않고 막대 아래 `InlineConfirm` ("파일을 올리는 중이에요 · 나가면 올리기가 취소돼요", [머무르기] / [나가기]) 를 연다.

- [ ] **Step 1: 실패하는 DOM 테스트** — LeafBody 가 로딩 중에도 트리 people 로 현황을 그리고 자리표가 사라졌는지:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeafBody } from "./LeafBody";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

describe("LeafBody (before task_get resolves)", () => {
  const leaf = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).leaves.find((l) => l.title === "IAM 정책 이해")!;
  const doc = () => { const d = document.createElement("div"); d.innerHTML = renderToStaticMarkup(createElement(LeafBody, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast: () => {}, viewerPending: false, onUploadingChange: () => {} })); return d; };
  it("renders the status list from tree people with no expand toggles", () => {
    const d = doc();
    expect(d.querySelector("h3")?.textContent).toContain("제출 현황");
    expect(d.querySelectorAll("button[aria-expanded]").length).toBe(0);
    expect(d.textContent).toContain("하나");
  });
  it("shows a busy skeleton for my card", () => expect(doc().querySelector('[aria-busy="true"]')).not.toBeNull());
});
```

(서버 렌더에서는 effect 가 돌지 않아 `task_get` 이 호출되지 않는다 — 로딩 상태가 그려진다. `useMe` 가 Provider 없이 null 을 주는지 `src/lib/me.ts` 확인, 아니면 테스트에서 `MeProvider` 로 감싼다.)

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/components/my-study/tabs/LeafBody.dom.test.ts`.
- [ ] **Step 3: 구현** — 위 동작. `LeafBody` 의 `{/* plan 06: 제출 */}` 와 담당자 격자를 지우고 `SubmissionSection` 으로. `n.asg === 0` 문구는 현황 목록 안으로.
- [ ] **Step 4: 전체 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` → 통과. 커밋 `feat(my-study): 과제 상세에 제출·현황 연결 (plan 06 §4.10)`.

---

### Task 10: 0015 `file_discard` (judgment · opus) — D1 = 예일 때만

**Files:**
- Create: `supabase/migrations/0015_file_discard.sql`
- Create: `supabase/tests/file-discard-sql.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (`Functions` 에 `file_discard` 추가 — 로컬 Supabase 가 떠 있으면 `npm run db:types`, 아니면 기존 `file_register` 항목 모양대로 손으로)

**왜 필요한가:** 스펙 §1.7 — 화면에서 뺀 미연결 READY 파일이 `file_register` 의 "업로드 중 묶음 5개" 계산(`0007:223-226`)에 24시간 남아 제출 전 재업로드를 막는다. 클라이언트가 Storage 객체를 지워도 `files` 행이 남아 풀리지 않는다.

- [ ] **Step 1: 실패하는 SQL 테스트** — `supabase/tests/file-discard-sql.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

async function uploadedAndRegistered(q: Q, node: string, room: string, uid: string) {
  const fid = crypto.randomUUID();
  const path = `${room}/${node}/${uid}/${fid}.png`;
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)", [path, uid, JSON.stringify({ size: 10, mimetype: "image/png" })]);
  await one(q, "select public.file_register($1::bigint, $2, 'a.png', 'image/png', 10)", [node, path]);
  return fid;
}
const discard = (q: Q, fid: string) => one(q, "select public.file_discard($1::uuid) as r", [fid]).then((r) => r.r);

cases("file_discard", db, [
  { name: "discarding unattached uploads frees file_register slots", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, u);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await uploadedAndRegistered(q, ec2, room, u));
    await expectFail(uploadedAndRegistered(q, ec2, room, u), "FILE_LIMIT_EXCEEDED");
    assertEquals(await discard(q, ids[0]), { id: ids[0], status: "deleted" });
    await uploadedAndRegistered(q, ec2, room, u);                               // 자리가 났다
    assertEquals(await discard(q, ids[0]), { id: ids[0], status: "deleted" }); // 멱등
  } },
  { name: "attached files are refused (FILE_ATTACHED); others' files are NOT_FOUND", run: async (q) => {
    const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, u);
    const fid = await uploadedAndRegistered(q, ec2, room, u);
    await submit(q, ec2, "첨부", [], [fid]);
    await expectFail(discard(q, fid), "FILE_ATTACHED");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(discard(q, fid), "NOT_FOUND");
  } },
  { name: "anon → AUTH_REQUIRED", run: async (q) => {
    await q("select set_config('app.uid', '', true)");
    await expectFail(discard(q, crypto.randomUUID()), "AUTH_REQUIRED");
  } },
]);
```

(`expectFail` 이 Promise 를 받는지 `_harness.ts:84` 로 확인. `AUTH_REQUIRED` 코드명은 `require_user` 정의로 확인.)

- [ ] **Step 2: FAIL 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/file-discard-sql.test.ts` → 함수 없음으로 FAIL.

- [ ] **Step 3: 마이그레이션** — `supabase/migrations/0015_file_discard.sql`:

```sql
-- 0015_file_discard.sql — 제출에 연결되지 않은 내 첨부 정리 (task-submission 스펙 §1.7, R9)
-- 배포 후 수정 금지. 0007 file_register 의 "업로드 중 묶음 5개" 계산에서 빼기 위해 files 행만 DELETED 로 바꾼다.
-- Storage 객체는 지우지 않는다(00 개요 — 2단계 Edge Function cleanup-files 가 DELETED 행을 정리).
-- 연결된 첨부(submission_id 있음)는 거절: 제출에서 빼는 것은 submission_upsert 가 맡는다(0007:148-149).
create or replace function public.file_discard(p_file uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  f     public.files;
begin
  select * into f from public.files
  where id = p_file and owner_user_id = v_uid and purpose = 'ATTACHMENT'
  for update;
  if not found then perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', p_file::text)); end if;
  if f.submission_id is not null then
    perform public.fail('FILE_ATTACHED', '제출에 붙은 파일은 제출을 고쳐서 빼 주세요', jsonb_build_object('fileId', p_file::text));
  end if;
  if f.status <> 'DELETED' then
    update public.files set status = 'DELETED', deleted_at = now() where id = p_file;
  end if;
  return jsonb_build_object('id', p_file::text, 'status', 'deleted');
end $$;

grant execute on function public.file_discard(uuid) to authenticated;
```

- [ ] **Step 4: PASS 확인** — 같은 deno 명령 → PASS, 이어서 `npm run test:db` 전체 통과(기존 `schema-sql`/`rls-sql` 의 GRANT 목록 검사가 있으면 기대값에 `file_discard` 추가 — `grep -rn "file_register" supabase/tests/*.ts` 로 목록형 검사 위치를 찾는다).
- [ ] **Step 5: 타입** — `database.types.ts` `Functions` 에 `file_discard: { Args: { p_file: string }; Returns: Json }`. 게이트 → 커밋 `feat(db): 0015 file_discard — 뺀 첨부를 업로드 한도에서 제외`.
- [ ] **Step 6: 호스티드 적용은 하지 않는다** — 컨트롤러에 "0015 호스티드 적용(supabase db push, ref neqlsvufmdxgqnwtevau) 사용자 승인 필요" 로 보고.

---

### Task 11: 브라우저 확인 390 / 820 / 1440 (judgment · opus)

**Files:** 없음(스크린샷은 `.superpowers/sdd/2026-10-16-task-submission/`)

- [ ] **Step 1:** `vm_stat | grep -E 'free|compressor'`, `lsof -iTCP:3700 -sTCP:LISTEN -P` 확인 후 `npx next dev -p 3700`(백그라운드). 로컬 Supabase 가 0015 까지 적용됐는지 `npm run db:reset` 여부는 컨트롤러에 묻는다(데이터 초기화).
- [ ] **Step 2: ego-browser** 로 철수(aws 참가자) 로그인 → `/my-study/aws?task={EC2 인스턴스 유형 정리 id}`: 내 제출 카드로 스크롤·포커스, 작성 화면 바로 열림. 본문 입력 → 링크 추가(잘못된 주소 오류 확인) → PNG·PDF 업로드(진행률), 11MB 파일 거절, .exe 거절 → 제출 → "기한내 제출"·현황 갱신·보드 "제출 완료" 칸.
- [ ] **Step 3:** 수정하기 → 파일 하나 빼고 다른 파일 → 수정 저장 → 메타 "마지막 수정". 새로고침 중간에 작성 → 임시본 안내 → 이어 쓰기.
- [ ] **Step 4:** 민수(그룹장) → 같은 과제: 카드 없음/있음(그룹장 과제 여부), 현황 줄 펼쳐 철수 제출물·파일 열기(서명 URL 다운로드). 마감 지난 미제출 과제(IAM 정책 이해, 하나)로 하나 로그인 → "지각 제출하기".
- [ ] **Step 5:** 폭 390 / 820 / 1440 각 스크린샷: 가로 스크롤 없음(`document.documentElement.scrollWidth <= innerWidth`), 안쪽 스크롤러 없음, 버튼 44px.
- [ ] **Step 6:** dev 서버 종료, 브라우저 창 finish. 발견한 문제는 해당 Task 로 돌아가 고친다.

---

## Self-Review

- **스펙 커버리지:** §2.1 배치(9) · §2.2 카드 상태(2·8) · §2.3 작성(4·6·8) · §2.4 현황(2·7) · §2.5 파일 열기(1·7) · §2.6 포커스(5·9) · §2.7 확정 저장·임시본(3·8·9) · §2.8 나가기 가드(8·9) · §3 엣지(2·4·6·8 테스트) · §1.7/R9(10) · §4 수용 기준(11).
- **범위 밖:** 이미지 미리보기, 평가·코멘트·AI 피드백, 두 기기 충돌 감지, 개인 과제 모델(0014), 호스티드 0015 적용.
- **D1 = 아니오:** Task 10 삭제, Task 1 `discardFile` 와 그 테스트 삭제, Task 6 `"discard"` → `"drop"`, Task 8 의 `FILE_LIMIT_EXCEEDED` 토스트에 스펙 §6 D1 대체 문구.
