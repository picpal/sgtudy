# 진행목표 항목 첨부 파일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회차·묶음·공통 과제·지정 과제·개인 목표의 편집 화면에서 파일을 올려 [저장]으로 붙이고, 보기 상세에서 권한 있는 사람이 서명 URL 로 내려받게 한다.

**Architecture:** DB = 마이그레이션 1개 `0030_node_attachments.sql`(추가형). `files` 에 purpose `NODE_DOC` + 열 `attached_at`(null = 올렸지만 저장 전), Storage 키 `n/{room}/{node}/{uuid}.{ext}` 와 그 키 전용 INSERT·SELECT 정책, `files_select` 재생성, RPC 4개(`node_file_register`·`node_files_set`·`node_file_discard`·`node_files`), `goal_nodes` BEFORE DELETE 트리거(어떤 삭제 경로든 첨부 → DELETED), `job_cleanup` 재정의(미저장 24h). `node_update`·`curriculum_json`·`node_delete` 는 **재정의하지 않는다**(뒤따르는 AI 플랜 0031–0033 과 충돌 회피). 웹 = 어댑터 `src/lib/api/nodeFiles.ts` → 순수 로직 `src/components/my-study/nodeFiles.ts` → 훅 `useNodeFileUploads.ts`(선택 id 를 밖에서 제어) → `FileUploadList`(재사용) · `NodeAttachments`(보기 목록). 팀 항목은 `Overrides.files` 로 기존 저장·이탈 확인 흐름에 얹고, 개인 목표는 `PersonalForm` 로컬 상태.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase PG17(plpgsql `security definer set search_path=''`, `public.fail`) · Storage REST 업로드(`src/lib/api/upload.ts`) · vitest(`src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom` + `renderToStaticMarkup`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-19-node-attachments-design.md`. 스펙 §11 D1~D7 은 **확정**(2026-10-19 사용자 승인): D1 항목당 5개 · D2 인라인 이미지 v1 제외 · D3 멤버 전용(외부인 불가) · D4 알림 없음 · D5 남의 개인 목표에 그룹장은 빼기만 · D6 보관 팀 항목 첨부는 편집자만 · D7 **이 기능 먼저 배포 → `0030`**(AI 연동은 0031–0033 으로 밀림).

## Global Constraints

- 마이그레이션은 **`0030_node_attachments.sql` 하나만**. 0001~0029 수정 금지. 0031~0033 은 AI 연동 플랜 몫 — 만들지 않는다. `0030_*` 이 이미 있으면 멈추고 번호를 컨트롤러와 다시 정한다(스펙 §10·D7).
- 재정의 금지 목록: `node_update`·`node_delete`·`node_archive`·`curriculum_json`·`personal_*`·`file_register`·`file_discard`·`submission_upsert`. 이 플랜이 재정의하는 것은 `job_cleanup`(0008 판 복사 + 추가) 과 정책 `files_select`(0003 판 + 갈래) 뿐.
- SQL 테스트는 pgTAP 이 아니라 `supabase/tests/*-sql.test.ts`(deno + PGlite, `_harness.ts`·`_fixtures.ts`). 각 case 는 롤백된다.
- 모든 새 plpgsql 함수: `security definer set search_path = ''`, 객체는 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. GRANT 는 필요한 것만(0002 default privileges 로 기본 비공개, 01-decisions D7 — 스펙 §11 D7 과 다름).
- Storage 객체는 SQL·클라이언트 어디서도 지우지 않는다 — DELETED 로 바꾸면 `cleanup-files` 가 지운다(기존 R13).
- 문구는 스펙 §4 그대로(한국어). 사용자 용어 "진행목표", "항목", "첨부 파일".
- 한 페이지 스크롤: 새 안쪽 스크롤러 금지. 버튼 ≥ 44px(`h-11`/`min-h-11`), 행 버튼 `aria-label` 에 파일명 포함. 확인 폭 390 / 820 / 1440, 가로 스크롤 없음.
- Supabase 는 `src/lib/api/*` 에서만 import. 새 npm 의존성 금지. 새 Next API 를 쓰게 되면 먼저 `node_modules/next/dist/docs/` 해당 문서를 읽는다(이 플랜은 새 Next API 를 쓰지 않는다).
- 서브에이전트 금지(각 작업자 스스로 실행).
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 종료. dev 서버는 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`).
- 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지. 쿠키/스토리지 삭제 금지.
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL 작업은 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만. 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```
- 줄 번호는 작성 시점 기준 — 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. **권한 판정이 한 곳** — `node_doc_readable`/`node_doc_writable` 을 RPC·Storage 정책·`files_select` 가 같이 쓰는가. 정책 식 안에서 AND 순서에 기대 캐스트하지 않는가(정규식 검사는 plpgsql 함수 안에서 먼저). → Task 1 테스트.
2. **제출 첨부 회귀 없음** — `files_select` 세 번째 갈래를 `purpose='ATTACHMENT'` 로 좁혀도 기존 동작 동일, `job_cleanup` 의 기존 세 숫자 그대로, 기존 `attachments_*` 정책 3개 그대로. → Task 1·2, 기존 `npm run test:db` 전부.
3. **미저장 vs 저장** — 올림 = READY·`attached_at null`, [저장] = `node_files_set` 만 붙인다. 미저장 객체는 아무도 서명할 수 없다. 다른 사람이 올린 미저장 id 로 붙이기 불가. → Task 2.
4. **개인 목표 그룹장 = 빼기만** — `node_files_set` 의 부분집합 판정과 "새 id 는 내 미저장만" 규칙이 함께 막는가. 위임 편집자는 `NOT_OWNER`. → Task 2.
5. **삭제 경로 누수 없음** — 서브트리 삭제·`personal_delete`·방 cascade 에서 트리거가 첨부를 DELETED 로. → Task 1.
6. **제어형 선택 상태** — 팀 항목은 `S.ov.files[id]` 가 진실. 저장 실패·"버리기"(dropFieldOv)로 ov 가 지워지면 목록이 저장된 상태로 자동 복귀해야 한다(훅 안 별도 상태 금지). `stripFieldOv` 도 `files` 를 비운다. → Task 4·6.
7. **실제 Storage 와 정책이 맞물리나** — PGlite 는 storage-api 를 흉내 내지 못한다. 로컬 Supabase 에서 `n/` 키 업로드(INSERT 정책만, 업로더에게 미저장 객체 SELECT 없음)·서명 URL(저장 뒤에만, 외부인 거부)이 실제로 동작하는지 → Task 9 Step 1b.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 작업 트리·번호**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && git status --short && ls supabase/migrations | tail -4`
Expected: `supabase/migrations/**`·`src/components/my-study/**`·`src/lib/api/**` 에 커밋 안 된 변경 없음. 마지막이 `0029_mine_scope_includes_led.sql`, `0030_*` 없음(AI 연동 0031+ 도 아직 없어야 한다 — D7 순서). 아니면 멈추고 보고.

- [ ] **Step 2: 재사용 대상이 그대로인지**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && grep -ln "function public.job_cleanup()" supabase/migrations/*.sql && grep -n "create policy files_select" supabase/migrations/*.sql && grep -n "attachments_delete_own\", \"attachments_insert_assignee\"" supabase/tests/rls-sql.test.ts`
Expected: `job_cleanup` 정의는 `0008` 하나뿐, `files_select` 는 `0003` 하나뿐, rls 테스트에 정책 목록 단언 1줄. 다른 파일이 이 둘을 재정의했으면 **그 최신 판**을 Task 2 의 복사 원본으로 쓴다(멈추고 컨트롤러에 알림).

- [ ] **Step 3: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과(env 없이 돌리면 `*-db.test.ts` 는 ignored — PGlite `*-sql` 만 기준선). 실패하면 멈추고 보고.

---

### Task 1: 0030 (1) — 스키마 · 권한 헬퍼 · Storage/RLS 정책 · 삭제 트리거 (opus)

**Files:**
- Create: `supabase/migrations/0030_node_attachments.sql`
- Create: `supabase/tests/node-attachments-sql.test.ts`
- Modify: `supabase/tests/rls-sql.test.ts` (storage 정책 목록 단언)

**Interfaces (이 Task 가 만드는 것):**
- 열 `files.attached_at timestamptz null`, 인덱스 `ix_files_node_doc`
- `node_file_limit() → int` (5) · `node_doc_key_ok(text) → boolean`
- `node_doc_readable(bigint, uuid)` · `node_doc_writable(bigint, uuid)` — 내부, GRANT 없음
- `node_doc_readable_me(bigint)` (anon·authenticated) · `node_doc_object_writable(text)` · `node_doc_object_readable(text)` (authenticated)
- 정책 `attachments_insert_node_doc`·`attachments_select_node_doc`(storage.objects), `files_select`(재생성)
- 트리거 `trg_goal_nodes_doc_release`

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/node-attachments-sql.test.ts`

```ts
// supabase/tests/node-attachments-sql.test.ts — 0030 진행목표 항목 첨부 (스펙 2026-10-19-node-attachments-design)
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, uuids, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const LEAF = "EC2 인스턴스 유형 정리";
const b = async (q: Q, sql: string, p: unknown[]) => (await one(q, sql, p)).v as boolean;
const readable = (q: Q, node: string, uid: string) => b(q, "select public.node_doc_readable($1::bigint, $2::uuid) as v", [node, uid]);
const writable = (q: Q, node: string, uid: string) => b(q, "select public.node_doc_writable($1::bigint, $2::uuid) as v", [node, uid]);
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
const memberSet = (q: Q, room: string, uid: string, sql: string) =>
  q(`update public.room_members set ${sql} where room_id = $1::bigint and user_id = $2::uuid`, [room, uid]);
/** 철수의 개인 목표 하나 (3주차) */
async function personalOf(q: Q, owner: string): Promise<string> {
  await setNow(q, "2026-10-12T03:00:00Z");
  await asUser(q, owner);
  const c = (await one(q, "select public.personal_create('aws', $1, '첨부 시험 목표') as c", [await roundOf(q, "3주차")])).c as Row;
  return c.createdId as string;
}
/** Storage 업로드 흉내 + node_file_register. 반환 file id */
export async function staged(q: Q, node: string, room: string, uid: string, mime = "application/pdf", ext = "pdf") {
  const fid = crypto.randomUUID();
  const path = `n/${room}/${node}/${fid}.${ext}`;
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, uid, JSON.stringify({ size: 10, mimetype: mime })]);
  await one(q, "select public.node_file_register($1::bigint, $2, 'a.' || $4, $3, 10)", [node, path, mime, ext]);
  return fid;
}
export const setFiles = (q: Q, node: string, ids: string[]) =>
  one(q, "select public.node_files_set($1::bigint, $2::uuid[]) as r", [node, uuids(ids)]).then((r) => r.r as Row[]);

cases("node attachments · helpers & policies", db, [
  { name: "node_doc_key_ok: n/{room}/{node}/{uuid}[.ext] only", run: async (q) => {
    const u = "0b9c2f6e-1d2a-4c3b-9e8f-112233445566";
    const ok = (s: string) => b(q, "select public.node_doc_key_ok($1) as v", [s]);
    assertEquals(await ok(`n/1/2/${u}.pdf`), true);
    assertEquals(await ok(`n/1/2/${u}`), true);
    assertEquals(await ok(`1/2/${u}/${u}.pdf`), false);        // 제출 키
    assertEquals(await ok(`n/1/2/${u}.PDF`), false);           // 대문자 확장자(objectKey 가 소문자로 만든다)
    assertEquals(await ok(`n/x/2/${u}.pdf`), false);
    assertEquals(await ok(`n/1/2/3/${u}.pdf`), false);
    assertEquals(await ok(`n/1/99999999999999999999/${u}.pdf`), false);   // bigint 넘침 방지(18자리)
  } },
  { name: "readable: team node — leader·ACTIVE·INACTIVE yes, PENDING·outsider no; archived → editors only", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, cheolsu, doyun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "도윤")];
    const outsider = await newUser(q);
    const pending = await newUser(q);
    await q("insert into public.room_members (room_id, user_id, role, status) values ($1, $2, 'MEMBER', 'PENDING')", [aws, pending]);
    for (const u of [minsu, cheolsu, doyun]) assertEquals(await readable(q, leaf, u), true, u);
    assertEquals(await readable(q, leaf, pending), false);   // 판정: PENDING 신청자 제외(D3)
    assertEquals(await readable(q, leaf, outsider), false);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    assertEquals(await readable(q, leaf, minsu), true);
    assertEquals(await readable(q, leaf, cheolsu), false);
    await memberSet(q, aws, cheolsu, "can_edit_curriculum = true");
    assertEquals(await readable(q, leaf, cheolsu), true);
  } },
  { name: "writable: leader·delegated editor on team nodes in DRAFT/RECRUIT/ACTIVE; never plain member, archived, ENDED", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const round = await roundOf(q, "2주차");
    const [minsu, cheolsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은")];
    assertEquals(await writable(q, leaf, minsu), true);
    assertEquals(await writable(q, round, minsu), true);        // 회차도
    assertEquals(await writable(q, leaf, cheolsu), false);
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    assertEquals(await writable(q, leaf, jieun), true);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    assertEquals(await writable(q, leaf, minsu), false);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    assertEquals(await writable(q, round, minsu), false);
  } },
  { name: "personal goal: owner writes; leader·delegated editor don't; viewers read; archived → owner·leader read", run: async (q) => {
    const aws = await roomId(q, "aws");
    const [minsu, cheolsu, jieun, doyun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은"), await uidOf(q, "도윤")];
    const g = await personalOf(q, cheolsu);
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    assertEquals(await writable(q, g, cheolsu), true);
    assertEquals(await writable(q, g, minsu), false);
    assertEquals(await writable(q, g, jieun), false);
    for (const u of [cheolsu, minsu, jieun, doyun]) assertEquals(await readable(q, g, u), true, u);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [g]);
    assertEquals(await readable(q, g, cheolsu), true);
    assertEquals(await readable(q, g, minsu), true);
    assertEquals(await readable(q, g, jieun), false);
  } },
  { name: "object helpers: writable checks room segment; readable only for attached READY rows", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    const u = crypto.randomUUID();
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`n/${aws}/${leaf}/${u}.pdf`]), true);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`n/${Number(aws) + 999}/${leaf}/${u}.pdf`]), false);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`${aws}/${leaf}/${minsu}/${u}.pdf`]), false);
    const fid = await staged(q, leaf, aws, minsu);
    const path = `n/${aws}/${leaf}/${fid}.pdf`;
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), false);   // 미저장은 아무도 못 읽는다
    await setFiles(q, leaf, [fid]);
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), true);
    await asUser(q, await newUser(q));
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), false);
  } },
  { name: "policies: storage gets the two node_doc policies; files_select keeps submission branch and adds NODE_DOC", run: async (q) => {
    const pols = await q("select polname, polcmd from pg_policy where polrelid = 'storage.objects'::regclass and polname like '%node_doc' order by 1");
    assertEquals(pols.map((p) => [p.polname, p.polcmd]), [["attachments_insert_node_doc", "a"], ["attachments_select_node_doc", "r"]]);
    const qual = (await one(q, "select pg_get_expr(polqual, polrelid) as e from pg_policy where polname = 'files_select'")).e as string;
    for (const s of ["'ATTACHMENT'", "can_read_submission", "'COVER'", "'NODE_DOC'", "node_doc_readable_me", "attached_at"]) {
      assertEquals(qual.includes(s), true, s);
    }
  } },
  { name: "grants: policy wrappers only; internal helpers closed", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).ok;
    assertEquals(await can("anon", "public.node_doc_readable_me(bigint)"), true);
    assertEquals(await can("authenticated", "public.node_doc_object_writable(text)"), true);
    assertEquals(await can("authenticated", "public.node_doc_object_readable(text)"), true);
    assertEquals(await can("anon", "public.node_doc_object_writable(text)"), false);
    for (const fn of ["public.node_doc_readable(bigint,uuid)", "public.node_doc_writable(bigint,uuid)"]) {
      assertEquals(await can("authenticated", fn), false, fn);
      assertEquals(await can("anon", fn), false, fn);
    }
  } },
  { name: "trigger: deleting a subtree or a personal goal marks its NODE_DOC files DELETED (rows stay for cleanup-files)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, cheolsu] = [await uidOf(q, "민수"), await uidOf(q, "철수")];
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu);
    await setFiles(q, leaf, [a]);
    const g = await personalOf(q, cheolsu);
    const c = await staged(q, g, aws, cheolsu);
    await setFiles(q, g, [c]);
    await q("delete from public.goal_nodes where id in (select public.node_subtree($1::bigint))", [leaf]);  // node_delete 와 같은 문장
    await asUser(q, cheolsu);
    await one(q, "select public.personal_delete('aws', $1::bigint) as r", [g]);
    const st = await q("select status, node_id from public.files where id in ($1::uuid, $2::uuid) order by status", [a, c]);
    assertEquals(st.map((r) => [r.status, r.node_id]), [["DELETED", null], ["DELETED", null]]);
  } },
]);
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/node-attachments-sql.test.ts`
Expected: FAIL — `function public.node_doc_key_ok(unknown) does not exist` 등.

- [ ] **Step 3: 마이그레이션 앞부분 작성** — `supabase/migrations/0030_node_attachments.sql`

```sql
-- 0030_node_attachments.sql — 2026-10-19 진행목표 항목(회차·묶음·공통·지정·개인 목표) 첨부. 배포 후 수정 금지.
-- 스펙: docs/superpowers/specs/2026-10-19-node-attachments-design.md
-- 담는 것: ① files.purpose 'NODE_DOC' + files.attached_at(null = 올렸지만 저장 전) ② 권한 헬퍼 ③ Storage 정책 2개(키 n/{room}/{node}/{uuid}.{ext})
--   ④ files_select 재생성(0003 판 + NODE_DOC 갈래) ⑤ goal_nodes 삭제 트리거 ⑥ RPC 4개 ⑦ job_cleanup 재정의(0008 판 + 미저장 NODE_DOC)
-- 재정의하지 않는 것: node_update·node_delete·curriculum_json·personal_*·file_register (뒤따르는 AI 연동 0031–0033 과 겹치지 않게)
-- 왜 PENDING 을 쓰지 않나: job_cleanup 이 purpose 무관하게 PENDING 1h 를 DELETED 로 바꾼다(0008). 편집 세션은 1h 를 넘길 수 있다.

-- ───────── ① 스키마 ─────────
alter table public.files add column attached_at timestamptz;   -- NODE_DOC 전용. 저장(node_files_set) 시각
create index ix_files_node_doc on public.files (node_id) where purpose = 'NODE_DOC' and status = 'READY';

create or replace function public.node_file_limit() returns int
language sql immutable set search_path = '' as $$ select 5 $$;

-- 업로더 세그먼트 없음(항목 단위 소유). 숫자는 18자리까지(bigint 캐스트 보호). 제출 키(^[0-9]+/…)와 겹치지 않는다
create or replace function public.node_doc_key_ok(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_name, '') ~ '^n/[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$'
$$;

-- ───────── ② 권한 헬퍼 (스펙 §5) ─────────
-- 읽기: 팀 = 그룹장·ACTIVE·INACTIVE(PENDING 제외, 보관이면 편집자만) / 개인 = 소유자 + personal_viewer(보관이면 소유자·그룹장). 외부인·비로그인 불가(D3)
create or replace function public.node_doc_readable(p_node bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.goal_nodes n join public.rooms r on r.id = n.room_id
    where n.id = p_node and (
      case when n.task_type = 'PERSONAL' then
        n.owner_id = p_uid or (public.personal_viewer(r.id, p_uid) and (n.archived_at is null or r.leader_id = p_uid))
      else
        (r.leader_id = p_uid or exists (select 1 from public.room_members m
                                        where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE')))
        and (n.archived_at is null or public.can_edit_curriculum(r, p_uid))
      end))
$$;

-- 추가(업로드·붙이기): 팀 = 편집자 ∧ 방 DRAFT·RECRUIT·ACTIVE / 개인 = 소유자 ∧ 소유 자격 ∧ 방 RECRUIT·ACTIVE. 둘 다 항목·방 미보관
create or replace function public.node_doc_writable(p_node bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.goal_nodes n join public.rooms r on r.id = n.room_id
    where n.id = p_node and n.archived_at is null and r.archived_at is null and (
      case when n.task_type = 'PERSONAL' then
        n.owner_id = p_uid and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(r.id, p_uid)
      else
        r.status in ('DRAFT', 'RECRUIT', 'ACTIVE') and public.can_edit_curriculum(r, p_uid)
      end))
$$;

-- 정책용 래퍼 — 정규식을 먼저 보고 나서 캐스트한다(정책 식의 AND 평가 순서에 기대지 않는다)
create or replace function public.node_doc_object_writable(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_seg text[]; v_node bigint;
begin
  if not public.node_doc_key_ok(p_name) then return false; end if;
  v_seg := string_to_array(p_name, '/');
  v_node := v_seg[3]::bigint;
  return exists (select 1 from public.goal_nodes n where n.id = v_node and n.room_id::text = v_seg[2])
     and public.node_doc_writable(v_node, public.current_user_id());
end $$;

-- 서명(SELECT): 그 경로의 files 행이 저장된 READY NODE_DOC 이고 읽기 권한이 있을 때만 — 미저장 객체는 아무도 못 연다
create or replace function public.node_doc_object_readable(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.node_doc_key_ok(p_name) then return false; end if;
  return exists (select 1 from public.files f
                 where f.object_path = p_name and f.bucket_id = 'attachments' and f.purpose = 'NODE_DOC'
                   and f.status = 'READY' and f.attached_at is not null
                   and public.node_doc_readable(f.node_id, public.current_user_id()));
end $$;

create or replace function public.node_doc_readable_me(p_node bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.node_doc_readable(p_node, public.current_user_id())
$$;

-- ───────── ③ Storage 정책 (DELETE 정책 없음 — 클라이언트는 객체를 지우지 않는다) ─────────
create policy attachments_insert_node_doc on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.node_doc_object_writable(name));
create policy attachments_select_node_doc on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.node_doc_object_readable(name));

-- ───────── ④ files_select (0003 판 + NODE_DOC). 세 번째 갈래를 ATTACHMENT 로 좁혀도 기존 동작 동일(COVER 는 node_id 없음) ─────────
drop policy files_select on public.files;
create policy files_select on public.files for select
  using (owner_user_id = (select public.current_user_id())
         or (purpose = 'COVER' and room_id is not null and public.can_read_room(room_id))
         or (purpose = 'ATTACHMENT' and node_id is not null and public.can_read_submission(node_id, owner_user_id))
         or (purpose = 'NODE_DOC' and status = 'READY' and attached_at is not null and node_id is not null
             and public.node_doc_readable_me(node_id)));

-- ───────── ⑤ 삭제 트리거 — node_delete 서브트리·personal_delete·방 cascade·이후 마이그레이션의 어떤 삭제든 ─────────
-- FK files.node_id ON DELETE SET NULL 보다 먼저(BEFORE) 표시해 둔다. 객체는 cleanup-files 가 지운다
create or replace function public.goal_nodes_doc_release() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.files set status = 'DELETED', deleted_at = now()
   where node_id = old.id and purpose = 'NODE_DOC' and status <> 'DELETED';
  return old;
end $$;
create trigger trg_goal_nodes_doc_release before delete on public.goal_nodes
  for each row execute function public.goal_nodes_doc_release();

-- GRANT (01-decisions D7): 정책이 부르는 래퍼만. files_select 는 anon 질의에도 평가된다
grant execute on function public.node_doc_readable_me(bigint) to anon, authenticated;
grant execute on function public.node_doc_object_writable(text) to authenticated;
grant execute on function public.node_doc_object_readable(text) to authenticated;
```

(이 Task 의 테스트 중 `staged`/`setFiles` 를 쓰는 case 3개는 Task 2 RPC 가 있어야 통과한다. Step 4 에서는 그 셋을 제외하고 확인하고, Task 2 Step 4 에서 전부 확인한다.)

- [ ] **Step 4: rls 테스트 갱신 + 통과 확인**

`supabase/tests/rls-sql.test.ts` 의 정책 목록 단언을 바꾼다:

```ts
  assertEquals(pols.map((p) => p.polname), ["attachments_delete_own", "attachments_insert_assignee", "attachments_insert_node_doc", "attachments_select_member", "attachments_select_node_doc"]);
```

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/node-attachments-sql.test.ts --filter "/key_ok|readable: team|writable:|personal goal:|policies:|grants:/" && deno test -A --config supabase/tests/deno.json supabase/tests/rls-sql.test.ts`
Expected: 지정한 case 전부 PASS, rls 전부 PASS.

- [ ] **Step 5: 커밋 보류** — Task 2 와 같은 마이그레이션 파일이므로 Task 2 끝에서 함께 커밋한다(중간 상태를 배포 가능한 커밋으로 남기지 않는다).

---

### Task 2: 0030 (2) — RPC 4개 · job_cleanup 재정의 (opus)

**Files:**
- Modify: `supabase/migrations/0030_node_attachments.sql` (끝에 추가)
- Modify: `supabase/tests/node-attachments-sql.test.ts` (끝에 `cases` 추가)

**Interfaces:**
```
node_file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint) → FileMeta jsonb
node_files_set(p_node bigint, p_file_ids uuid[])                                   → FileMeta[] jsonb (붙은 목록)
node_file_discard(p_file uuid)                                                      → {"id","status":"deleted"}
node_files(p_node bigint)                                                           → FileMeta[] jsonb
FileMeta = public.file_json(f) = {id, name, contentType, size, status:"ready"}
```

- [ ] **Step 1: 실패하는 테스트 추가** — 같은 파일 끝에

```ts
const list = (q: Q, node: string) => one(q, "select public.node_files($1::bigint) as r", [node]).then((r) => (r.r as Row[]).map((f) => f.id));
const statusOf = async (q: Q, fid: string) => (await one(q, "select status, attached_at is not null as att from public.files where id = $1::uuid", [fid]));

cases("node attachments · RPC", db, [
  { name: "register → staged(READY, not attached); set attaches; set again removes → DELETED; idempotent", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu); const c = await staged(q, leaf, aws, minsu, "image/png", "png");
    assertEquals(await statusOf(q, a), { status: "READY", att: false });
    assertEquals(await list(q, leaf), []);                                      // 미저장은 목록에 없다
    assertEquals((await setFiles(q, leaf, [a, c])).map((f) => f.id), [a, c]);
    assertEquals(await list(q, leaf), [a, c]);
    assertEquals((await setFiles(q, leaf, [c])).map((f) => f.id), [c]);
    assertEquals(await statusOf(q, a), { status: "DELETED", att: true });
    assertEquals((await setFiles(q, leaf, [c])).map((f) => f.id), [c]);        // 멱등
    await asUser(q, await uidOf(q, "철수"));
    assertEquals(await list(q, leaf), [c]);                                     // 멤버는 읽는다
  } },
  { name: "register validation: path·mime·size·limit; plain member → NOT_CURRICULUM_EDITOR", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const reg = (path: string, mime = "application/pdf", size = 10) =>
      one(q, "select public.node_file_register($1::bigint, $2, 'a.pdf', $3, $4::bigint)", [leaf, path, mime, size]);
    await expectFail(reg(`n/${Number(aws) + 1}/${leaf}/${crypto.randomUUID()}.pdf`), "VALIDATION_FAILED");
    await expectFail(reg(`${aws}/${leaf}/${minsu}/${crypto.randomUUID()}.pdf`), "VALIDATION_FAILED");
    await expectFail(reg(`n/${aws}/${leaf}/${crypto.randomUUID()}.exe`, "application/x-msdownload"), "FILE_TYPE_NOT_ALLOWED");
    await expectFail(reg(`n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`), "FILE_NOT_READY");     // Storage 객체 없음
    const big = crypto.randomUUID(); const bigPath = `n/${aws}/${leaf}/${big}.pdf`;
    await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
            [bigPath, minsu, JSON.stringify({ size: 10485761, mimetype: "application/pdf" })]);
    await expectFail(reg(bigPath), "FILE_TOO_LARGE");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await staged(q, leaf, aws, minsu));
    await setFiles(q, leaf, ids);                                               // 붙은 3
    ids.push(await staged(q, leaf, aws, minsu), await staged(q, leaf, aws, minsu));   // 미저장 2 → 합 5
    await expectFail(staged(q, leaf, aws, minsu), "FILE_LIMIT_EXCEEDED");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(staged(q, leaf, aws, await uidOf(q, "철수")), "NOT_CURRICULUM_EDITOR");
  } },
  { name: "set: duplicates·>5 rejected; another editor's staged id → FILE_NOT_READY; any editor can remove others' attached", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "지은")];
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu);
    await expectFail(setFiles(q, leaf, [a, a]), "VALIDATION_FAILED");
    await expectFail(setFiles(q, leaf, Array.from({ length: 6 }, () => crypto.randomUUID())), "FILE_LIMIT_EXCEEDED");
    await asUser(q, jieun);
    await expectFail(setFiles(q, leaf, [a]), "FILE_NOT_READY");                 // 민수의 미저장 파일
    await expectFail(setFiles(q, leaf, [crypto.randomUUID()]), "FILE_NOT_READY");
    await asUser(q, minsu);
    await setFiles(q, leaf, [a]);
    await asUser(q, jieun);
    assertEquals(await setFiles(q, leaf, []), []);                              // 다른 편집자가 올린 것도 뺄 수 있다
    assertEquals((await statusOf(q, a)).status, "DELETED");
  } },
  { name: "set on archived / ENDED → TASK_ARCHIVED / ROOM_NOT_EDITABLE", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    await expectFail(setFiles(q, leaf, []), "TASK_ARCHIVED");
    await q("update public.goal_nodes set archived_at = null where id = $1::bigint", [leaf]);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    await expectFail(setFiles(q, leaf, []), "ROOM_NOT_EDITABLE");
  } },
  { name: "personal: owner attaches; leader may only remove; delegated editor → NOT_OWNER; outsider → NODE_NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws");
    const [minsu, cheolsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은")];
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    const g = await personalOf(q, cheolsu);                                     // asUser 철수
    const a = await staged(q, g, aws, cheolsu); const c = await staged(q, g, aws, cheolsu);
    await setFiles(q, g, [a, c]);
    await asUser(q, jieun);
    await expectFail(setFiles(q, g, [a]), "NOT_OWNER");
    await expectFail(staged(q, g, aws, jieun), "NOT_OWNER");
    await asUser(q, minsu);
    await expectFail(staged(q, g, aws, minsu), "NOT_OWNER");                    // 그룹장 추가 불가
    assertEquals((await setFiles(q, g, [c])).map((f) => f.id), [c]);           // 빼기는 된다(모더레이션)
    await asUser(q, await newUser(q));
    await expectFail(setFiles(q, g, []), "NODE_NOT_FOUND");
    await expectFail(list(q, g), "NODE_NOT_FOUND");
  } },
  { name: "discard: staged → DELETED (frees a slot), attached → FILE_ATTACHED, others → NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu); const c = await staged(q, leaf, aws, minsu);
    await setFiles(q, leaf, [c]);
    const discard = (fid: string) => one(q, "select public.node_file_discard($1::uuid) as r", [fid]).then((r) => r.r);
    assertEquals(await discard(a), { id: a, status: "deleted" });
    assertEquals(await discard(a), { id: a, status: "deleted" });               // 멱등
    await expectFail(discard(c), "FILE_ATTACHED");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(discard(c), "NOT_FOUND");
  } },
  { name: "anon → AUTH_REQUIRED; RPC EXECUTE to authenticated only", run: async (q) => {
    await asAnon(q);
    await expectFail(one(q, "select public.node_files(1::bigint)"), "AUTH_REQUIRED");
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).ok;
    for (const fn of ["public.node_file_register(bigint,text,text,text,bigint)", "public.node_files_set(bigint,uuid[])",
                      "public.node_file_discard(uuid)", "public.node_files(bigint)"]) {
      assertEquals(await can("authenticated", fn), true, fn);
      assertEquals(await can("anon", fn), false, fn);
    }
  } },
  { name: "job_cleanup: staged NODE_DOC >24h and node-less NODE_DOC → DELETED; attached untouched; old counters unchanged", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    const ins = (id: string, node: string | null, attached: boolean, created: string) =>
      q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, created_at, attached_at)
         values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'NODE_DOC', $5, 'x.pdf', 'application/pdf', 1, 'READY', $6::timestamptz, $7::timestamptz)`,
        [id, minsu, aws, node, `n/${aws}/${leaf}/${id}.pdf`, created, attached ? created : null]);
    const [old, young, kept, orphan] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await ins(old, leaf, false, "2026-10-01T00:00:00Z");
    await ins(young, leaf, false, new Date().toISOString());
    await ins(kept, leaf, true, "2026-10-01T00:00:00Z");
    await ins(orphan, null, true, "2026-10-01T00:00:00Z");
    const r = (await one(q, "select public.job_cleanup() as r")).r as Row;
    assertEquals([r.filesExpired, r.orphansExpired, r.nodeDocsExpired], [0, 0, 2]);
    assertEquals((await statusOf(q, old)).status, "DELETED");
    assertEquals((await statusOf(q, young)).status, "READY");
    assertEquals((await statusOf(q, kept)).status, "READY");
    assertEquals((await statusOf(q, orphan)).status, "DELETED");
  } },
]);
```

(시드에 원래 오래된 PENDING/고아 ATTACHMENT 가 없다는 전제 — 다르면 `filesExpired`·`orphansExpired` 단언을 빼고 `nodeDocsExpired` 만 본다.)

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/node-attachments-sql.test.ts`
Expected: FAIL — `function public.node_file_register(...) does not exist`.

- [ ] **Step 3: 마이그레이션 끝에 추가**

```sql
-- ───────── ⑥ RPC ─────────
-- 공통 선행(내부, GRANT 없음): 방 잠금(lock-before-hide, 0007 submission_target 과 같은 트레이드오프) → 존재 은닉 → 방 상태 → 보관 → 권한.
-- p_remove_only = 요청이 "빼기만"일 때 — 개인 목표 그룹장 모더레이션(스펙 §5.1·D5)
create or replace function public.node_doc_target(p_node bigint, p_uid uuid, p_remove_only boolean) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare v_room bigint; v_slug text; r public.rooms; n public.goal_nodes;
begin
  select room_id into v_room from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_node::text, ''))); end if;
  select slug into v_slug from public.rooms where id = v_room;
  r := public.room_lock(v_slug);
  select * into n from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;

  if n.task_type = 'PERSONAL' then
    if not public.room_readable(r.id, p_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
    if n.owner_id is distinct from p_uid and not public.personal_viewer(r.id, p_uid) then
      perform public.fail('NODE_NOT_FOUND', '개인 목표를 찾을 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
    if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
      perform public.fail('ROOM_NOT_EDITABLE', '모집 중이거나 진행 중인 스터디에서만 바꿀 수 있어요', jsonb_build_object('status', lower(r.status)));
    end if;
    if n.archived_at is not null then
      perform public.fail('TASK_ARCHIVED', '보관된 목표는 고칠 수 없어요 · 먼저 보관을 해제해 주세요', jsonb_build_object('nodeId', n.id::text));
    end if;
    if n.owner_id = p_uid and public.personal_eligible(r.id, p_uid) then return n; end if;
    if p_remove_only and r.leader_id = p_uid then return n; end if;
    perform public.fail('NOT_OWNER', '본인 개인 목표에만 파일을 붙일 수 있어요');
  end if;

  perform public.require_curriculum_editor(r, p_uid);            -- ROOM_NOT_FOUND / NOT_CURRICULUM_EDITOR
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
  if n.archived_at is not null then
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목이에요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return n;
end $$;

create or replace function public.node_files_json(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.file_json(f) order by f.attached_at, f.created_at, f.id), '[]'::jsonb)
  from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
$$;

-- 0019 file_register 와 같은 검증 순서. 다른 점: 권한(node_doc_target), 키(n/…), purpose NODE_DOC, attached_at null, 한도 = 붙은 것 + 내 미저장(24h)
create or replace function public.node_file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  n      public.goal_nodes;
  v_seg  text[];
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_cnt  int;
  v_meta jsonb;
  v_size bigint;
  v_mime text;
  f      public.files;
begin
  n := public.node_doc_target(p_node, v_uid, false);
  v_seg := string_to_array(coalesce(p_path, ''), '/');
  if not public.node_doc_key_ok(p_path) or v_seg[2] <> n.room_id::text or v_seg[3] <> n.id::text then
    perform public.fail('VALIDATION_FAILED', '첨부 경로가 올바르지 않아요', '{"field":"path"}'::jsonb);
  end if;
  v_id := left(v_seg[4], 36)::uuid;
  if length(v_name) < 1 or length(v_name) > 255 then
    perform public.fail('VALIDATION_FAILED', '파일 이름은 1~255자예요', '{"field":"name"}'::jsonb);
  end if;
  if p_mime is null or not (p_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', p_mime));
  end if;
  if p_size is null or p_size < 1 then
    perform public.fail('VALIDATION_FAILED', '파일 크기가 올바르지 않아요', '{"field":"size"}'::jsonb);
  end if;
  if not public.storage_exists('attachments', p_path) then
    perform public.fail('FILE_NOT_READY', '업로드가 아직 끝나지 않았어요', jsonb_build_object('fileId', v_id::text));
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path;
  v_size := coalesce((v_meta ->> 'size')::bigint, p_size);
  v_mime := coalesce(v_meta ->> 'mimetype', p_mime);
  if not (v_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', v_mime));
  end if;
  if v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if exists (select 1 from public.files x where x.id = v_id and x.owner_user_id = v_uid and x.object_path = p_path
               and x.status = 'DELETED' and x.deleted_at <= now() - public.file_purge_grace()) then
    perform public.fail('FILE_NOT_READY', '정리된 파일이에요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
  end if;

  select count(*) into v_cnt from public.files
  where node_id = n.id and purpose = 'NODE_DOC' and status = 'READY' and id <> v_id
    and (attached_at is not null or (owner_user_id = v_uid and created_at > now() - interval '24 hours'));
  if v_cnt >= public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('첨부는 항목당 %s개까지예요', public.node_file_limit()), '{"field":"fileIds"}'::jsonb);
  end if;

  insert into public.files (id, owner_user_id, room_id, node_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status, completed_at)
  values (v_id, v_uid, n.room_id, n.id, 'NODE_DOC', 'attachments', p_path, v_name, v_mime, v_size, 'READY', now())
  on conflict (id) do update
    set status = 'READY', completed_at = now(), size_bytes = excluded.size_bytes, deleted_at = null
    where public.files.owner_user_id = excluded.owner_user_id and public.files.node_id = excluded.node_id
      and public.files.object_path = excluded.object_path and public.files.purpose = 'NODE_DOC'
      and public.files.attached_at is null
      and (public.files.status <> 'DELETED' or public.files.deleted_at is null or public.files.deleted_at > now() - public.file_purge_grace())
  returning * into f;
  if f.id is null then perform public.fail('NOT_FOUND', '다른 사용자의 파일 id 예요', jsonb_build_object('fileId', v_id::text)); end if;
  return public.file_json(f);
end $$;

-- 항목의 첨부를 목록대로(집합 의미, 멱등). 새로 붙일 id = 내 미저장 READY ∧ 같은 항목 ∧ Storage 실재. 빠진 붙은 파일 → DELETED.
-- 목록이 현재의 부분집합이면 빼기만(그룹장 모더레이션 허용). 그룹장은 미저장 파일을 만들 수 없으므로 잠금 전후 경합에도 추가는 막힌다
create or replace function public.node_files_set(p_node bigint, p_file_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_ids uuid[] := coalesce(p_file_ids, '{}');
  v_cur uuid[];
  n     public.goal_nodes;
  v_fid uuid;
begin
  if exists (select 1 from unnest(v_ids) x where x is null)
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    perform public.fail('VALIDATION_FAILED', '같은 파일이 두 번 들어 있어요', '{"field":"fileIds"}'::jsonb);
  end if;
  if cardinality(v_ids) > public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('첨부는 항목당 %s개까지예요', public.node_file_limit()), '{"field":"fileIds"}'::jsonb);
  end if;
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  n := public.node_doc_target(p_node, v_uid, v_ids <@ v_cur);
  -- 잠근 뒤 다시 읽는다
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = n.id and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  foreach v_fid in array v_ids loop
    continue when v_fid = any(v_cur);
    if not exists (select 1 from public.files f
                   where f.id = v_fid and f.owner_user_id = v_uid and f.node_id = n.id and f.purpose = 'NODE_DOC'
                     and f.status = 'READY' and f.attached_at is null and public.storage_exists(f.bucket_id, f.object_path)) then
      perform public.fail('FILE_NOT_READY', '이 파일을 다시 올려 주세요', jsonb_build_object('fileId', v_fid::text));
    end if;
  end loop;
  update public.files set status = 'DELETED', deleted_at = now() where id = any(v_cur) and not (id = any(v_ids));
  update public.files set attached_at = now() where id = any(v_ids) and attached_at is null;
  return public.node_files_json(n.id);
end $$;

-- 0015 file_discard 의 NODE_DOC 판: 내 미저장 파일을 한도에서 뺀다. 붙은 파일은 편집에서 빼고 저장(node_files_set)
create or replace function public.node_file_discard(p_file uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); f public.files;
begin
  select * into f from public.files where id = p_file and owner_user_id = v_uid and purpose = 'NODE_DOC' for update;
  if not found then perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', p_file::text)); end if;
  if f.attached_at is not null and f.status <> 'DELETED' then
    perform public.fail('FILE_ATTACHED', '항목에 붙은 파일은 편집에서 빼고 저장해 주세요', jsonb_build_object('fileId', p_file::text));
  end if;
  if f.status <> 'DELETED' then update public.files set status = 'DELETED', deleted_at = now() where id = p_file; end if;
  return jsonb_build_object('id', p_file::text, 'status', 'deleted');
end $$;

create or replace function public.node_files(p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.node_doc_readable(p_node, v_uid) then
    perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_node::text, '')));
  end if;
  return public.node_files_json(p_node);
end $$;

grant execute on function public.node_file_register(bigint, text, text, text, bigint) to authenticated;
grant execute on function public.node_files_set(bigint, uuid[]) to authenticated;
grant execute on function public.node_file_discard(uuid) to authenticated;
grant execute on function public.node_files(bigint) to authenticated;

-- ───────── ⑦ job_cleanup (0008 판 + NODE_DOC 두 줄). GRANT 하지 않는다(01-decisions D7) ─────────
create or replace function public.job_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_expired int; v_orphans int; v_mail int; v_docs int; v_lost int;
begin
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'PENDING' and created_at < now() - interval '1 hour';
  get diagnostics v_expired = row_count;

  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'ATTACHMENT' and submission_id is null and created_at < now() - interval '24 hours';
  get diagnostics v_orphans = row_count;

  -- 0030: 올리고 저장하지 않은 항목 첨부 24h · 노드를 잃은 항목 첨부(트리거 안전망)
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'NODE_DOC' and attached_at is null and created_at < now() - interval '24 hours';
  get diagnostics v_docs = row_count;
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'NODE_DOC' and node_id is null;
  get diagnostics v_lost = row_count;

  delete from public.mail_outbox where status = 'SENT' and sent_at < now() - interval '30 days';
  get diagnostics v_mail = row_count;

  return jsonb_build_object('filesExpired', v_expired, 'orphansExpired', v_orphans, 'mailPurged', v_mail,
                            'nodeDocsExpired', v_docs + v_lost);
end $$;
```

- [ ] **Step 4: 통과 확인 (전체)**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db`
Expected: 새 파일 전부 PASS(Task 1 의 보류 case 포함), 기존 `jobs-sql`·`files-sql`·`file-discard-sql`·`cleanup-files-sql`·`rls-sql`·`personal-goals-sql` 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && git commit -- supabase/migrations/0030_node_attachments.sql supabase/tests/node-attachments-sql.test.ts supabase/tests/rls-sql.test.ts -m "feat(db): 0030 — 진행목표 항목 첨부(NODE_DOC·attached_at, n/ 키 Storage 정책, node_files_* RPC, 삭제 트리거, job_cleanup 미저장 정리)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 3: 어댑터 `src/lib/api/nodeFiles.ts` (mechanical · sonnet)

**Files:**
- Create: `src/lib/api/nodeFiles.ts`
- Create: `src/lib/api/nodeFiles.test.ts`

**Interfaces:**
```ts
export const registerNodeFile: (nodeId: string, f: { path: string; name: string; mime: string; size: number }, client?: Db) => Promise<FileMeta>;
export const setNodeFiles: (nodeId: string, fileIds: string[], client?: Db) => Promise<FileMeta[]>;
export const fetchNodeFiles: (nodeId: string, client?: Db) => Promise<FileMeta[]>;
export const discardNodeFile: (fileId: string, client?: Db) => Promise<{ id: string; status: "deleted" }>;
export function discardNodeUnattached(fileId: string, client?: Db): Promise<boolean>; // throw 하지 않음
/** 볼 권한 없음(NODE_NOT_FOUND)은 빈 목록 — 보기 상세가 조용히 숨긴다 */
export function fetchNodeFilesOrEmpty(nodeId: string, client?: Db): Promise<FileMeta[]>;
```
`fileUrl`·`roomIdOfNode` 는 `./submission` 것을 그대로 쓴다(새로 만들지 않는다). `database.types.ts` 는 `rpc()` 가 이름을 문자열로 받으므로 재생성하지 않아도 된다(로컬 Supabase 가 떠 있으면 `npm run db:types` 로 갱신해도 됨).

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { discardNodeFile, discardNodeUnattached, fetchNodeFiles, fetchNodeFilesOrEmpty, registerNodeFile, setNodeFiles } from "./nodeFiles";

const fake = (data: unknown = {}, error: unknown = null) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (n: string, a: unknown) => { calls.push([n, a]); return Promise.resolve({ data: error ? null : data, error }); } } as unknown as Db;
  return { calls, client };
};
const P0001 = (code: string) => ({ code: "P0001", message: code, details: "m", hint: "{}" });

describe("nodeFiles adapter (0030)", () => {
  it("registerNodeFile → node_file_register(p_node:number, …)", async () => {
    const f = fake();
    await registerNodeFile("21", { path: "n/1/21/x.pdf", name: "자료.pdf", mime: "application/pdf", size: 9 }, f.client);
    expect(f.calls).toEqual([["node_file_register", { p_node: 21, p_path: "n/1/21/x.pdf", p_name: "자료.pdf", p_mime: "application/pdf", p_size: 9 }]]);
  });
  it("setNodeFiles → node_files_set keeps order", async () => {
    const f = fake([]);
    await setNodeFiles("21", ["b", "a"], f.client);
    expect(f.calls).toEqual([["node_files_set", { p_node: 21, p_file_ids: ["b", "a"] }]]);
  });
  it("fetchNodeFiles → node_files", async () => {
    const f = fake([{ id: "a" }]);
    expect(await fetchNodeFiles("21", f.client)).toEqual([{ id: "a" }]);
    expect(f.calls).toEqual([["node_files", { p_node: 21 }]]);
  });
  it("discardNodeFile → node_file_discard", async () => {
    const f = fake({ id: "a", status: "deleted" });
    await discardNodeFile("a", f.client);
    expect(f.calls).toEqual([["node_file_discard", { p_file: "a" }]]);
  });
  it("discardNodeUnattached never throws", async () => {
    expect(await discardNodeUnattached("a", fake({ id: "a", status: "deleted" }).client)).toBe(true);
    expect(await discardNodeUnattached("a", fake(null, P0001("FILE_ATTACHED")).client)).toBe(false);
  });
  it("fetchNodeFilesOrEmpty: NODE_NOT_FOUND → [], other errors throw", async () => {
    expect(await fetchNodeFilesOrEmpty("21", fake(null, P0001("NODE_NOT_FOUND")).client)).toEqual([]);
    await expect(fetchNodeFilesOrEmpty("21", fake(null, P0001("UNKNOWN")).client)).rejects.toBeTruthy();
  });
});
```

(`toApiError` 가 P0001 의 `message` 를 code 로 읽는지 `src/lib/api/errors.ts` 의 `toApiErrorRaw` 로 확인하고, 다르면 같은 파일의 기존 테스트(`submission.test.ts` 의 `withRpc`) 모양을 따른다.)

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/lib/api/nodeFiles.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현**

```ts
import { ApiException, rpc, type Db } from "./errors";
import type { FileMeta } from "./types";

/* 진행목표 항목 첨부 어댑터 (0030_node_attachments.sql). 서명 URL 은 submission.fileUrl 을 그대로 쓴다 (files RLS · Storage 정책이 NODE_DOC 를 연다) */
const num = (id: string) => Number(id);

export const registerNodeFile = (nodeId: string, f: { path: string; name: string; mime: string; size: number }, client?: Db) =>
  rpc<FileMeta>("node_file_register", { p_node: num(nodeId), p_path: f.path, p_name: f.name, p_mime: f.mime, p_size: f.size }, client);
export const setNodeFiles = (nodeId: string, fileIds: string[], client?: Db) =>
  rpc<FileMeta[]>("node_files_set", { p_node: num(nodeId), p_file_ids: fileIds }, client);
export const fetchNodeFiles = (nodeId: string, client?: Db) => rpc<FileMeta[]>("node_files", { p_node: num(nodeId) }, client);
export const discardNodeFile = (fileId: string, client?: Db) => rpc<{ id: string; status: "deleted" }>("node_file_discard", { p_file: fileId }, client);

export async function discardNodeUnattached(fileId: string, client?: Db): Promise<boolean> {
  try {
    await discardNodeFile(fileId, client);
    return true;
  } catch {
    return false; // 미저장 파일은 서버가 24시간 뒤 정리(0030 job_cleanup)
  }
}

export async function fetchNodeFilesOrEmpty(nodeId: string, client?: Db): Promise<FileMeta[]> {
  try {
    return await fetchNodeFiles(nodeId, client);
  } catch (e) {
    if (e instanceof ApiException && e.code === "NODE_NOT_FOUND") return [];
    throw e;
  }
}
```
(`ApiException` 은 `code`·`details` 를 직접 가진다 — `errors.ts:10`.)

- [ ] **Step 4: 통과 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/lib/api/nodeFiles.test.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: 커밋** — `git commit -- src/lib/api/nodeFiles.ts src/lib/api/nodeFiles.test.ts -m "feat(api): 항목 첨부 어댑터 (0030 node_files_*)" …`(끝 두 줄 포함)

---

### Task 4: 순수 로직 — 키·제한·제어형 목록·Overrides.files (sonnet)

**Files:**
- Create: `src/components/my-study/nodeFiles.ts`, `src/components/my-study/nodeFiles.test.ts`
- Modify: `src/components/my-study/uploads.ts` (`slotsLeft` 에 한도 인자), `uploads.test.ts`
- Modify: `src/components/my-study/model.ts` (`Overrides.files`, `EMPTY_OVERRIDES`, `FIELD_KEYS`), `model.test.ts`

**Interfaces:**
```ts
// nodeFiles.ts
export const NODE_FILE_LIMITS = { files: 5 } as const;              // 0030 node_file_limit() 와 같은 값 (D1)
export const NODE_FILE_HINT = "PNG·JPG·GIF·WEBP·PDF·ZIP·TXT·MD · 파일당 10MB · 5개까지";
export const nodeObjectKey: (roomId: string, nodeId: string, uuid: string, name: string) => string; // n/{room}/{node}/{uuid}[.ext]
export const sameIds: (a: readonly string[], b: readonly string[]) => boolean;                       // 순서 포함
/** 보이는 줄 = 선택된 id(저장본 또는 ov) 의 메타 + 올리는 중/실패 줄 */
export function nodeRows(selected: readonly string[], metas: ReadonlyMap<string, FileMeta>, pending: readonly UploadRow[]): UploadRow[];
export function nodeRemovePlan(row: UploadRow, savedIds: ReadonlySet<string>): "abort" | "drop" | "discard";
export const fileBadge: (contentType: string) => "PDF" | "ZIP" | "IMG" | "TXT";
// model.ts
export type Overrides = { …; files: Record<string, string[]> };     // 노드 id → 선택된 첨부 id (저장본과 다를 때만)
```

- [ ] **Step 1: 실패하는 테스트** — `nodeFiles.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { FileMeta } from "@/lib/api/types";
import { fileBadge, nodeObjectKey, nodeRemovePlan, nodeRows, sameIds } from "./nodeFiles";
import type { UploadRow } from "./uploads";

const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 4, status: "ready" });
const up = (key: string, status: UploadRow["status"] = "uploading"): UploadRow => ({ key, fileId: key, name: `${key}.png`, size: 1, status, progress: 10 });

describe("nodeObjectKey — 0030 node_doc_key_ok 와 같은 모양", () => {
  const u = "0b9c2f6e-1d2a-4c3b-9e8f-112233445566";
  it("소문자 확장자", () => expect(nodeObjectKey("7", "21", u, "자료.PDF")).toBe(`n/7/21/${u}.pdf`));
  it("확장자 없음", () => expect(nodeObjectKey("7", "21", u, "README")).toBe(`n/7/21/${u}`));
  it("마지막 점 뒤만", () => expect(nodeObjectKey("7", "21", u, "a.tar.gz")).toBe(`n/7/21/${u}.gz`));
});

describe("nodeRows — 선택 id 가 진실 (Review Focus 6)", () => {
  const metas = new Map([["a", meta("a")], ["b", meta("b")], ["c", meta("c")]]);
  it("선택 순서대로 ready 줄 + 올리는 중 줄은 뒤에", () => {
    const rows = nodeRows(["b", "a"], metas, [up("k1")]);
    expect(rows.map((r) => [r.fileId, r.status])).toEqual([["b", "ready"], ["a", "ready"], ["k1", "uploading"]]);
  });
  it("ov 가 지워지면(저장본 선택) 새로 올린 c 는 사라진다", () => {
    expect(nodeRows(["a"], metas, []).map((r) => r.fileId)).toEqual(["a"]);
  });
  it("메타 없는 id 는 건너뛴다", () => expect(nodeRows(["zz"], metas, [])).toEqual([]));
});

describe("nodeRemovePlan", () => {
  const saved = new Set(["a"]);
  it("올리는 중 → abort", () => expect(nodeRemovePlan(up("k"), saved)).toBe("abort"));
  it("실패 줄 → drop", () => expect(nodeRemovePlan(up("k", "error"), saved)).toBe("drop"));
  it("저장된 파일 → drop(다음 저장이 DELETED)", () => expect(nodeRemovePlan({ ...up("a", "ready"), fileId: "a" }, saved)).toBe("drop"));
  it("미저장 ready → discard", () => expect(nodeRemovePlan({ ...up("c", "ready"), fileId: "c" }, saved)).toBe("discard"));
});

it("sameIds 는 순서까지 본다", () => {
  expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
  expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
});
it("fileBadge", () => {
  expect(["application/pdf", "application/zip", "application/x-zip-compressed", "image/png", "text/markdown"].map(fileBadge)).toEqual(["PDF", "ZIP", "ZIP", "IMG", "TXT"]);
});
```

`model.test.ts` 에 추가:

```ts
it("isDirty counts attachment overrides; dropFieldOv drops them", () => {
  const ov = { ...EMPTY_OVERRIDES, files: { "21": ["f1"] } };
  expect(isDirty(ov, "21")).toBe(true);
  expect(dropFieldOv(ov, "21").files).toEqual({});
});
```

`uploads.test.ts` 에 추가:

```ts
it("slotsLeft takes an optional limit", () => {
  expect(slotsLeft([], 3)).toBe(3);
  expect(slotsLeft(fromSaved([meta("a")]))).toBe(4);   // 기본 = SUB_LIMITS.files
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/components/my-study/nodeFiles.test.ts src/components/my-study/model.test.ts src/components/my-study/uploads.test.ts` → FAIL

- [ ] **Step 3: 구현**
  - `nodeFiles.ts`: `nodeObjectKey` 는 `./submission`(`src/components/my-study/submission.ts`)의 이미 export 된 `extOf` 를 재사용(`objectKey` 와 같은 규칙). `nodeRows` 는 `selected.flatMap(id => metas.get(id) ? [fromSaved([m])[0]] : [])` + `pending` (status `uploading`·`error` 만). `nodeRemovePlan` 은 `removePlanOf` 와 같은 표(스펙 §6.4).
  - `uploads.ts`: `export const slotsLeft = (rows: UploadRow[], limit: number = SUB_LIMITS.files) => limit - rows.length;`
  - `model.ts`: `Overrides` 에 `files: Record<string, string[]>;` · `EMPTY_OVERRIDES` 에 `files: {}` · `FIELD_KEYS` 에 `"files"` · **`stripFieldOv` 리터럴에도 `files: {}`**(키를 나열하는 함수라 빠뜨리면 `savedOv` 에 미저장 선택이 남는다 — `model.test.ts` 에 `stripFieldOv({...EMPTY_OVERRIDES, files:{"21":["f1"]}}).files` → `{}` 단언 추가). `Overrides` 리터럴을 만드는 다른 곳은 `grep -rn "assignOv: {}" src` 로 찾아 `files: {}` 를 더한다(작성 시점에는 `model.ts` 하나).

- [ ] **Step 4: 통과 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/components/my-study && npx tsc --noEmit` → PASS

- [ ] **Step 5: 커밋** — `git commit -- src/components/my-study/nodeFiles.ts src/components/my-study/nodeFiles.test.ts src/components/my-study/uploads.ts src/components/my-study/uploads.test.ts src/components/my-study/model.ts src/components/my-study/model.test.ts -m "feat(my-study): 항목 첨부 순수 로직(키·제어형 목록·Overrides.files)" …`

---

### Task 5: 업로드 훅 `useNodeFileUploads` + `FileUploadList` 문구 prop (opus)

**Files:**
- Create: `src/components/my-study/useNodeFileUploads.ts`
- Modify: `src/components/my-study/tabs/FileUploadList.tsx` (`label?`·`hint?` prop, 기본값 = 현재 문구)
- Create: `src/components/my-study/tabs/FileUploadList.dom.test.ts`

**Interfaces:**
```ts
type Args = {
  nodeId: string | null;              // null(임시 행) → 고르기 비활성
  saved: FileMeta[];                  // 서버의 붙은 목록
  selected: string[];                 // 제어형: 팀 = S.ov.files[id] ?? saved ids, 개인 = 폼 상태
  onSelect: (ids: string[]) => void;  // 팀 = patchOv("files"), 같으면 키 제거
  toast: (m: ToastMsg) => void;
};
export function useNodeFileUploads(a: Args): {
  rows: UploadRow[]; pick: (files: File[]) => void; remove: (row: UploadRow) => void;
  retry: (row: UploadRow) => void; canRetry: (row: UploadRow) => boolean; uploading: boolean;
  markError: (fileId: string, error: string) => void;   // 저장 응답 FILE_NOT_READY 표시용
};
```

동작(제출 `useSubmissionComposer` 의 업로드 큐 부분과 같은 규칙 — 그 파일은 고치지 않는다; 중복은 의도된 트레이드오프, 후속 정리 후보):
- `metas` = `useRef(Map)` — `saved` 와 새로 등록된 FileMeta 를 모은다. `pending` = 올리는 중·실패 줄(`uploadsReducer` 로).
- 보이는 줄 = `nodeRows(selected, metas, pending)`. 남은 자리 = `slotsLeft(rows, NODE_FILE_LIMITS.files)`. 넘치면 `checkFile` 오류 줄.
- 큐 동시성 2, 각 파일: `roomIdOfNode(nodeId)`(한 번 캐시) → `nodeObjectKey` → `uploadAttachment` → `registerNodeFile` → `metas.set` + `onSelect([...selectedRef.current, meta.id])` + pending 에서 제거. abort/언마운트 뒤 등록이 끝나면 `discardNodeUnattached`.
- `remove(row)`: `nodeRemovePlan` → abort / `onSelect(without)` / `onSelect(without)` + `discardNodeUnattached`.
- `selected` 는 `useRef` 로 최신값을 읽는다(비동기 완료 시점의 ov 와 경합 방지).

- [ ] **Step 1: 실패하는 DOM 테스트** — `FileUploadList.dom.test.ts`

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileUploadList } from "./FileUploadList";

const html = (p: Partial<Parameters<typeof FileUploadList>[0]>) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(FileUploadList, { rows: [], onPick: () => {}, onRemove: () => {}, onRetry: () => {}, canRetry: () => false, ...p }));
  return d;
};

describe("FileUploadList label/hint", () => {
  it("defaults keep the submission wording", () => {
    const d = html({});
    expect(d.textContent).toContain("파일 (선택)");
    expect(d.textContent).toContain("파일당 10MB · 5개까지");
  });
  it("node attachments override the label and disable picking for temp rows", () => {
    const d = html({ label: "첨부 파일 (선택)", hint: "저장한 뒤 파일을 붙일 수 있어요", disabled: true });
    expect(d.textContent).toContain("첨부 파일 (선택)");
    expect(d.textContent).toContain("저장한 뒤 파일을 붙일 수 있어요");
    expect(d.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  });
  it("row buttons are 44px and name the file", () => {
    const d = html({ rows: [{ key: "k", fileId: "f", name: "자료.pdf", size: 4, status: "ready", progress: 100 }] });
    const b = d.querySelector('button[aria-label="자료.pdf 빼기"]')!;
    expect(b.className).toMatch(/h-11/);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/components/my-study/tabs/FileUploadList.dom.test.ts` → 두 번째 case FAIL

- [ ] **Step 3: 구현** — `FileUploadList` Props 에 `label?: string; hint?: string;`, 기본 `"파일 (선택)"`·현재 안내 문구. 훅 작성(위 동작).

- [ ] **Step 4: 통과 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/components/my-study && npm run lint && npx tsc --noEmit` → PASS (기존 `SubmissionComposer.dom.test.ts` 포함)

- [ ] **Step 5: 커밋** — `git commit -- src/components/my-study/useNodeFileUploads.ts src/components/my-study/tabs/FileUploadList.tsx src/components/my-study/tabs/FileUploadList.dom.test.ts -m "feat(my-study): 항목 첨부 업로드 훅 + FileUploadList 문구 prop" …`

---

### Task 6: 팀 항목 편집 — `EditView` + `api.save` (opus)

**Files:**
- Modify: `src/components/my-study/tabs/EditView.tsx` (설명 편집기 아래 첨부 영역)
- Modify: `src/components/my-study/useCurriculumApi.ts` (`save` 가 `ov.files` 처리)
- Modify: `src/components/my-study/useCurriculumApi.ts` 타입 `save: (n, ov, opts?: { shift?: boolean; onFiles?: (f: FileMeta[]) => void }) => Promise<boolean>`

- [ ] **Step 1: 저장 순서 테스트(순수 함수로 분리)** — `src/components/my-study/nodeFiles.ts` 에 `saveSteps(patchEmpty: boolean, files: string[] | undefined): ("files" | "node")[]` 를 추가하고 `nodeFiles.test.ts` 에:

```ts
import { saveSteps } from "./nodeFiles";
it("saveSteps: files first, then node; empty both → []", () => {
  expect(saveSteps(false, ["a"])).toEqual(["files", "node"]);
  expect(saveSteps(true, ["a"])).toEqual(["files"]);
  expect(saveSteps(false, undefined)).toEqual(["node"]);
  expect(saveSteps(true, undefined)).toEqual([]);
});
```

Run: `npx vitest run src/components/my-study/nodeFiles.test.ts` → FAIL → 구현 → PASS.

- [ ] **Step 2: `api.save` 수정** — `patchOf` 뒤에:

```ts
const files = ov.files[n.id];
const steps = saveSteps(Object.keys(patch).length === 0, files);
if (steps.length === 0) { /* 기존 "바뀐 내용이 없어요" 분기 그대로 */ }
if (steps[0] === "files") {
  try {
    opts.onFiles?.(await setNodeFiles(n.id, files!));
    update((p) => ({ ov: { ...p.ov, files: dropKey(p.ov.files, n.id) } }));
  } catch (e) {
    fail(e);          // ov.files 는 남긴다 — 고쳐서 다시 저장(FILE_NOT_READY 는 EditView 가 줄 오류로)
    return false;
  }
  if (!steps.includes("node")) { toast(null); update({ saved: "저장했어요" }); return true; }
}
// 이하 기존 nodeUpdate 경로 (실패 시 dropFieldOv — 파일은 이미 저장됨)
```
`dropKey` 는 지금 `useCurriculumApi.ts` 안의 비공개 헬퍼다 — `export` 해서 EditView 가 import 하거나(`../useCurriculumApi`) EditView 에서 같은 한 줄을 쓴다. `setNodeFiles` 는 `@/lib/api/nodeFiles` 에서 import(컴포넌트 계층 규칙: `useCurriculumApi` 는 이미 `@/lib/api/my-study` 를 import 하는 어댑터 소비자).

- [ ] **Step 3: `EditView` 첨부 영역** — 설명 블록(`desc-label-${id}`) 바로 아래:

```tsx
const [savedFiles, setSavedFiles] = useState<FileMeta[] | null>(null);
useEffect(() => { if (!n.temp) void fetchNodeFiles(id).then(setSavedFiles).catch(() => setSavedFiles([])); }, [id, n.temp]);
const savedIds = (savedFiles ?? []).map((f) => f.id);
const selected = S.ov.files[id] ?? savedIds;
const up = useNodeFileUploads({
  nodeId: n.temp ? null : id, saved: savedFiles ?? [], selected, toast: api.toast,
  onSelect: (ids) => update((p) => ({ ...patchOv(p, "files", sameIds(ids, savedIds) ? dropKey(p.ov.files, id) : { ...p.ov.files, [id]: ids }), saved: "" })),
});
…
<FileUploadList label="첨부 파일 (선택)" hint={n.temp ? "저장한 뒤 파일을 붙일 수 있어요" : NODE_FILE_HINT}
  rows={up.rows} onPick={up.pick} onRemove={up.remove} onRetry={up.retry} canRetry={up.canRetry} disabled={n.temp || savedFiles === null} />
```
- `fetchNodeFiles` 는 어댑터 경유(컴포넌트가 Supabase 를 직접 import 하지 않는다 — 기존 `SubmissionSection` 이 `@/lib/api/submission` 을 부르는 것과 같은 수준). `api.toast` 가 없으면 EditView 가 이미 받는 toast 경로를 쓴다(`Props` 확인).
- 저장 버튼: `up.uploading` 이면 비활성 + 문구 "파일을 올리는 중이에요".
- `api.save(n, S.ov, { shift, onFiles: setSavedFiles })`.
- `patchOv(p, "files", …)` 가 `Overrides` 키 제네릭이면 그대로, 아니면 `state.ts` 의 `patchOv` 타입에 `files` 가 들어가는지 확인.
- 저장 응답 `FILE_NOT_READY`(details.fileId) → `up.markError(fileId, "이 파일을 다시 올려 주세요")`: `fail` 이 토스트를 띄우는 것과 별도로, `save` 가 false 를 돌려줄 때 EditView 가 마지막 오류를 알 수 없으면 이 표시는 생략(토스트만) — 과설계 금지.

- [ ] **Step 4: 게이트** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run` → PASS

- [ ] **Step 5: 커밋** — `git commit -- src/components/my-study/tabs/EditView.tsx src/components/my-study/useCurriculumApi.ts src/components/my-study/nodeFiles.ts src/components/my-study/nodeFiles.test.ts -m "feat(my-study): 진행목표 편집에 첨부 파일 (저장 시 node_files_set)" …`

---

### Task 7: 개인 목표 편집 — `PersonalForm` (sonnet)

**Files:**
- Modify: `src/components/my-study/tabs/PersonalForm.tsx`
- Modify: `src/components/my-study/tabs/DetailView.tsx` (`PersonalForm` 에 toast 전달이 없으면 추가)

- [ ] **Step 1: 구현**
  - 로컬 상태 `const [savedFiles, setSavedFiles] = useState<FileMeta[] | null>(null)`, `const [fileIds, setFileIds] = useState<string[] | null>(null)`; 마운트 시 `fetchNodeFiles(n.id)` → 둘 다 채움.
  - `useNodeFileUploads({ nodeId: n.id, saved: savedFiles ?? [], selected: fileIds ?? [], onSelect: setFileIds, toast })`.
  - `dirty = Object.keys(patch).length > 0 || (fileIds !== null && !sameIds(fileIds, savedIds))` — 기존 `onDirtyChange`·beforeunload 가 그대로 이어받는다.
  - 설명 편집기 아래 `<FileUploadList label="첨부 파일 (선택)" hint={NODE_FILE_HINT} … />`.
  - 제출(onSubmit): 올리는 중이면 막기("파일을 올리는 중이에요"). 순서 = `saveSteps(patchEmpty, filesChanged ? fileIds : undefined)` — `"files"` 면 `setNodeFiles(n.id, fileIds)`(실패 = 토스트 + 폼 유지, `return`), `"node"` 면 기존 `api.updatePersonal(...)`. 둘 다 끝나면 `onDone()`.
- [ ] **Step 2: 게이트** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run` → PASS (`PersonalSection.dom.test.ts`·`DetailView.dom.test.ts` 포함)
- [ ] **Step 3: 커밋** — `git commit -- src/components/my-study/tabs/PersonalForm.tsx src/components/my-study/tabs/DetailView.tsx -m "feat(my-study): 개인 목표 편집에 첨부 파일" …`

---

### Task 8: 보기 상세 첨부 목록 `NodeAttachments` (sonnet)

**Files:**
- Create: `src/components/my-study/tabs/NodeAttachments.tsx` (`NodeAttachmentsView` 순수 + `NodeAttachments` 컨테이너)
- Create: `src/components/my-study/tabs/NodeAttachments.dom.test.ts`
- Modify: `src/components/my-study/tabs/DetailView.tsx` (부모 블록 설명 아래, `ChildList` 위)
- Modify: `src/components/my-study/tabs/LeafBody.tsx` (설명 아래, `SubmissionSection` 위)

**Interfaces:**
```ts
export function NodeAttachmentsView(p: { files: FileMeta[]; onOpen: (f: FileMeta) => void; onRemove?: (f: FileMeta) => void; busy?: string | null }): JSX.Element | null;
export function NodeAttachments(p: { nodeId: string; canRemove: boolean; toast: (m: ToastMsg) => void }): JSX.Element | null;
```
- 컨테이너: `fetchNodeFilesOrEmpty(nodeId)` → 0개면 `null`. [받기] = `fileUrl(f)` → `window.location.assign(url)`(같은 탭 다운로드, `download` 이름은 서명 URL 이 담는다). 실패 토스트 "파일을 열 수 없어요".
- `canRemove` = 개인 목표 ∧ 내가 그룹장 ∧ 소유자 아님 ∧ 목표 보관 아님 ∧ 방 RECRUIT·ACTIVE(DetailView 가 이미 가진 `personalActions` 값에서 계산). [빼기] → `InlineConfirm` "이 파일을 목표에서 뺄까요? 팀원에게는 알리지 않아요" → `setNodeFiles(nodeId, 남은 id)` → 응답으로 목록 교체.

- [ ] **Step 1: 실패하는 DOM 테스트**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeAttachmentsView } from "./NodeAttachments";

const f = (id: string, name: string, contentType = "application/pdf", size = 2048) => ({ id, name, contentType, size, status: "ready" as const });
const html = (p: Parameters<typeof NodeAttachmentsView>[0]) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(NodeAttachmentsView, p));
  return d;
};

describe("NodeAttachmentsView", () => {
  it("renders nothing when empty", () => expect(html({ files: [], onOpen: () => {} }).innerHTML).toBe(""));
  it("title with count, badge, size, 44px 받기 named by file", () => {
    const d = html({ files: [f("a", "1주차 자료.pdf"), f("b", "구성도.png", "image/png")], onOpen: () => {} });
    expect(d.querySelector("h3")?.textContent).toBe("첨부 파일 2");
    expect(d.textContent).toContain("PDF");
    expect(d.textContent).toContain("IMG");
    const b = d.querySelector('button[aria-label="1주차 자료.pdf 받기"]')!;
    expect(b.className).toMatch(/h-11|min-h-11/);
  });
  it("빼기 only when onRemove is given (leader moderation)", () => {
    expect(html({ files: [f("a", "x.pdf")], onOpen: () => {} }).querySelector('button[aria-label="x.pdf 빼기"]')).toBeNull();
    expect(html({ files: [f("a", "x.pdf")], onOpen: () => {}, onRemove: () => {} }).querySelector('button[aria-label="x.pdf 빼기"]')).not.toBeNull();
  });
  it("long names wrap (no horizontal scroll at 390)", () => {
    const d = html({ files: [f("a", "아주긴파일이름".repeat(20) + ".pdf")], onOpen: () => {} });
    expect(d.innerHTML).toContain("overflow-wrap:anywhere");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/components/my-study/tabs/NodeAttachments.dom.test.ts` → FAIL
- [ ] **Step 3: 구현** — `<section aria-labelledby>` + `<h3>첨부 파일 {n}</h3>` + `<ul class="m-0 flex list-none flex-col gap-1 p-0">`, 줄은 `FileUploadList` 줄과 같은 클래스(`flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line px-3 py-1`), 이름 `flex-[1_1_180px] [overflow-wrap:anywhere]`, 크기 `sizeText`(`../submission`). DetailView·LeafBody 에 끼운다(`LeafBody` 는 `p.n.id`·`p.toast` 사용, 개인 목표 그룹장 빼기 판정은 `SubmissionSectionProps` 에 있는 값으로 — 없으면 `canRemove={false}` 로 두고 DetailView 부모 경로에서만 계산하지 말고 Props 에 `canRemoveFiles?: boolean` 하나 추가).
- [ ] **Step 4: 게이트** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run` → PASS (`DetailView.dom.test.ts`·`LeafBody.dom.test.ts` — 컨테이너가 테스트 환경에서 RPC 를 부르면 실패하므로, 두 테스트가 렌더하는 경로에서는 `NodeAttachments` 가 `useEffect` 안에서만 fetch 하게 해 `renderToStaticMarkup` 에서는 아무것도 부르지 않게 한다)
- [ ] **Step 5: 커밋** — `git commit -- src/components/my-study/tabs/NodeAttachments.tsx src/components/my-study/tabs/NodeAttachments.dom.test.ts src/components/my-study/tabs/DetailView.tsx src/components/my-study/tabs/LeafBody.tsx -m "feat(my-study): 보기 상세 첨부 목록·받기, 개인 목표 그룹장 빼기" …`

---

### Task 9: 로컬 DB 적용 · 브라우저 확인 (sonnet)

**Files:** Create `supabase/tests/node-files-db.test.ts`(Step 1b). 그 밖에는 확인만 — 고칠 것이 나오면 해당 Task 파일만

- [ ] **Step 1: 로컬 적용** — `vm_stat | grep -E 'free|compressor'` 확인 후 `cd /Users/picpal/Desktop/workspace/sgtudy && npx supabase db reset` (로컬 Supabase 가 떠 있을 때만 — 로컬 DB 데이터가 시드로 초기화된다. 없으면 이 단계·Step 1b 생략하고 보고 — 호스팅 배포는 컨트롤러 몫, D7: 0030 을 AI 연동 0031–0033 보다 먼저).
- [ ] **Step 1b: 실제 Storage 통합 테스트** — Create `supabase/tests/node-files-db.test.ts`(`files-db.test.ts` 와 같은 모양, env 없으면 ignore):

```ts
import { assertEquals } from "@std/assert";
import { dbTest, service, userClient } from "./_testenv.ts";

dbTest("node docs storage: editor uploads n/ key, cannot sign until attached; outsider never signs", async () => {
  const { u, c } = await userClient(1);
  const { c: outsider } = await userClient(2);
  const admin = service();
  const ec2 = (await admin.from("goal_nodes").select("id, room_id").eq("title", "EC2 인스턴스 유형 정리").single()).data!;
  const fid = crypto.randomUUID();
  const path = `n/${ec2.room_id}/${ec2.id}/${fid}.png`;
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  assertEquals(Boolean((await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" })).error), true);  // 편집자 아님
  await admin.from("room_members").upsert({ room_id: ec2.room_id, user_id: u.id, role: "MEMBER", status: "ACTIVE", joined_at: new Date().toISOString(), can_edit_curriculum: true });
  try {
    assertEquals((await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" })).error, null);
    assertEquals((await c.rpc("node_file_register", { p_node: ec2.id, p_path: path, p_name: "x.png", p_mime: "image/png", p_size: 4 })).error, null);
    assertEquals(Boolean((await c.storage.from("attachments").createSignedUrl(path, 60)).error), true);     // 미저장
    assertEquals((await c.rpc("node_files_set", { p_node: ec2.id, p_file_ids: [fid] })).error, null);
    assertEquals((await c.storage.from("attachments").createSignedUrl(path, 60)).error, null);
    assertEquals(Boolean((await outsider.storage.from("attachments").createSignedUrl(path, 60)).error), true);
  } finally {
    await admin.storage.from("attachments").remove([path]);
    await admin.from("files").delete().eq("id", fid);
    await admin.from("room_members").delete().eq("room_id", ec2.room_id).eq("user_id", u.id);
  }
});
```

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && eval "$(npx supabase status -o env)" && SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run test:db -- --filter "node docs storage"`
Expected: PASS. **업로드가 RLS 403 으로 실패하면**(storage-api 가 INSERT 뒤 행을 SELECT 로 다시 읽는 판이면 업로더에게 미저장 객체 SELECT 가 필요) 마이그레이션을 고치지 말고 멈추고 컨트롤러에 보고 — 후보: `node_doc_object_readable` 에 "업로더 본인(`owner_id = auth.uid()::text`) ∧ 미저장" 갈래(스펙 §6.3 "미저장 객체는 아무도 서명할 수 없다" 완화 결정 필요). 통과하면 이 파일을 커밋(`git commit -- supabase/tests/node-files-db.test.ts …`).

- [ ] **Step 2: dev 서버** — `lsof -iTCP:3700 -sTCP:LISTEN -P` 비어 있으면 `npx next dev -p 3700` (백그라운드).
- [ ] **Step 3: ego-browser(자기 창)로 시나리오** — 로그인 정보는 `.superpowers/sdd/2026-10-14-editor-ux/common.md`.
  1. 그룹장: 진행목표 편집 → 2주차 회차 → PDF·PNG 2개 올림 → 저장 → 보기 상세에 "첨부 파일 2" → [받기] 다운로드.
  2. 같은 화면에서 파일 하나 빼고 저장하지 않고 [← 진행목표] → "저장하지 않은 수정이 있어요" 확인 → 버리기 → 다시 열면 2개 그대로.
  3. 과제(리프) 편집 → 6번째 파일 → "첨부는 5개까지예요" 줄 오류.
  4. 팀원(편집 권한 없음): 과제 상세에서 목록·받기 가능, 편집 진입 불가.
  5. 팀원 개인 목표 편집 → 파일 붙여 저장 → 그룹장 계정으로 그 목표 상세 → [빼기] 확인 → 사라짐.
  6. 폭 390 / 820 / 1440 에서 편집·상세 스크린샷, 가로 스크롤 없음(`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 4: 정리** — dev 서버 종료. 결과(스크린샷 경로·이상 사항) 보고.

---

## 실행 순서 · 모델

| Task | 모델 | 의존 |
|---|---|---|
| 0 | sonnet | — |
| 1·2 | opus | 0 (같은 파일 — 순서대로, 커밋은 2 끝) |
| 3 | sonnet | 2 |
| 4 | sonnet | — (1~3 과 병렬 가능) |
| 5 | opus | 3·4 |
| 6 | opus | 5 |
| 7 | sonnet | 5 (6 과 병렬 가능 — 파일 겹침: `nodeFiles.ts` 의 `saveSteps` 는 6 이 만든다 → 7 은 6 뒤) |
| 8 | sonnet | 3·4 (5~7 과 병렬 가능, `DetailView.tsx` 는 7 과 겹치므로 7 뒤) |
| 9 | sonnet | 전부 |
