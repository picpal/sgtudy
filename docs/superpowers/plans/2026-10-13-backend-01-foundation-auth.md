# 슥터디 백엔드 Implementation Plan — 01 기반 · 인증 (Phase 0 · Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase 프로젝트 골격(CLI 레이아웃·config·테스트 하네스·SSR 클라이언트·보호 라우트)과 Phase 1 데이터베이스(전체 스키마 0001, 공통 헬퍼 0002, RLS 0003, `me_*`/`nickname_check`/`meta_get`, 시드 사용자)를 만들어 이후 Phase 2~7 이 그 위에 쌓이게 한다.

**Architecture:** 스키마·규칙은 `supabase/migrations/000N_*.sql` 이 유일한 출처이고, SQL 함수는 PGlite(Deno, 트랜잭션 롤백 격리)로 검증한다. RLS·Auth·Storage 처럼 PGlite 가 흉내 못 내는 것은 로컬 `supabase start` 에 테스트 사용자로 검증한다(`SUPABASE_URL` 없으면 자동 skip). 프론트는 `@supabase/ssr` 로 쿠키 세션을 공유하고, Next.js 16 의 `proxy.ts`(구 middleware)가 세션 갱신과 보호 라우트 리다이렉트를 맡는다.

**Tech Stack:** Supabase CLI 2.75(로컬 Postgres 15, Auth 이메일 OTP, Storage, Inbucket), `@supabase/ssr` + `@supabase/supabase-js` 2, Deno 2 + `@electric-sql/pglite` 0.3(+ `citext`·`pg_trgm` contrib), Vitest(프론트 순수 함수), Next.js 16.4.

**Spec:** `docs/superpowers/plans/2026-10-13-backend-00-overview.md`(공통 계약·전역 제약 — 이 문서의 모든 이름은 거기서 고정), `docs/backend/01-decisions.md`(D0·D1·D6·D7·D13), `docs/backend/02-domain-and-schema.md`(§2 DDL, §5 RLS, §8 시드), `docs/backend/03-api.md`(§0 에러, §1 인증·사용자). 관례 참고: `~/Desktop/workspace/assistant/supabase/tests/{_pglite-stubs,_testenv,mail-sql.test}.ts`, `~/Desktop/workspace/asklyy/lib/supabase/{server,client,admin}.ts`.

## Global Constraints

(00 개요의 Global Constraints 전부 + 이 Phase 고유 항목)

- 디렉터리: `supabase/{config.toml, migrations/, seed.sql, tests/}`, `src/lib/supabase/{server,client,admin,middleware,return-to}.ts`, `src/proxy.ts`.
- 마이그레이션 파일명 `0001_schema.sql`, `0002_functions_core.sql`, `0003_rls.sql`. 이 계획 안에서는 아직 배포 전이므로 같은 파일에 태스크가 이어 쓸 수 있다(Task 6 → Task 8 이 `0002` 에 추가). 배포 뒤에는 수정 금지.
- 모든 SECURITY DEFINER 함수: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, 테이블·함수는 `public.`/`auth.` 한정. 예외: `0001` 의 `handle_new_auth_user()` 는 스펙 §2 원문(`search_path = public`) 그대로 둔다.
- 에러: `public.fail('<CODE>', '<한국어>', '<json>'::jsonb)` 만 사용. `<CODE>` 는 `03-api.md` §0 목록. I9 위반은 `FIELD_LOCKED`.
- "오늘"은 `public.kst_today()`. 테스트는 `setToday(q, '2026-10-12')`.
- `current_user_id()` 는 `auth.uid()` 를 먼저 보고, 없을 때만 `app.uid` 설정을 읽는다(호스팅에서 실세션이 항상 이긴다. PGlite 스텁의 `auth.uid()` 자체가 `app.uid` 를 읽으므로 테스트에서는 둘이 같다).
- 테스트: PGlite `*-sql.test.ts`(Docker 불필요, 사례마다 `begin … rollback`), 로컬 supabase `*-db.test.ts`(`SUPABASE_URL` 없으면 `ignore`). 조건 없는 delete·truncate 금지. 로컬 DB 테스트 사용자는 `sgtudy-test-<n>@example.com`.
- 메모리: `supabase start` 와 `npm run build` 전 `vm_stat | grep -E 'free|compressor'` 확인, 둘을 동시에 돌리지 않는다. PGlite 테스트(`npm run test:db`)는 Docker 없이 돈다.
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만 Vercel. `SUPABASE_SERVICE_ROLE_KEY` 는 `.env.local` 전용. `NEXT_PUBLIC_API_URL` 폐기.
- Next.js 16: 파일 규약이 `middleware.ts` → `proxy.ts` 로 바뀌었다(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, "Middleware is deprecated and renamed to Proxy"). 개요의 "root `middleware.ts`" 는 **`src/proxy.ts`** 로 구현하고, 로직 파일 이름 `src/lib/supabase/middleware.ts`(`updateSession`) 은 개요대로 유지한다.
- 커밋 메시지 끝에 두 줄 트레일러:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```

## Review Focus

스펙이 암시하지만 자연히 테스트되지 않을 입력. 각 항목은 아래 소유 태스크에 테스트로 박혀 있다.

1. **닉네임 유니코드 정규화** — macOS 가 만드는 NFD 분해형 "철수" 와 NFC "철수" 는 같은 닉네임이어야 하고(`NICKNAME_TAKEN`), 대소문자(`Chulsoo`/`chulsoo`)도 같다. 전각 공백·탭·연속 공백은 `NICKNAME_INVALID`. → Task 8.
2. **returnTo 오픈 리다이렉트** — `//evil.com`, `/\evil.com`, `https://…`, `/rooms/../x`, `javascript:` 는 전부 `/` 로 떨어져야 한다. → Task 3.
3. **온보딩 전 사용자** — `profiles.nickname IS NULL` 인 사용자는 `require_user()` 를 쓰는 쓰기 RPC 에서 `ONBOARDING_REQUIRED` 지만, `me_get`/`me_update`/`nickname_check` 는 동작해야 온보딩을 끝낼 수 있다. → Task 6(require_user), Task 8(me_update).
4. **자정 경계 지각** — 마감 10/03 과제를 KST 10/04 00:00:30(UTC 10/03 15:00:30)에 내면 지각, 23:59:59 KST 는 정시. `kst_deadline` 과 `task_code` 가 이걸 떠받친다. → Task 6.
5. **이메일 변경 동기화** — `auth.users.email` 이 바뀌어도(Supabase Auth 이메일 변경) `profiles.email` 이 따라와야 한다. 스펙 §2 트리거는 INSERT 만 걸려 있다. → Task 6 (`0002` 에 UPDATE 트리거 추가).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/config.toml` | 로컬 Supabase 설정(OTP 6자리·600초·60초, 리다이렉트 URL, 버킷 `attachments`) |
| `supabase/migrations/0001_schema.sql` | 02 §2 DDL 원문 |
| `supabase/migrations/0002_functions_core.sql` | 공통 헬퍼(개요 "공통 계약" 블록), `updated_at`·I9·이메일 동기화 트리거, `nickname_*`, `me_get`, `me_update`, `nickname_check`, `meta_get` |
| `supabase/migrations/0003_rls.sql` | RLS 헬퍼, 전 테이블 SELECT 정책, `public_profiles` 뷰, Storage 버킷·정책 |
| `supabase/seed.sql` | 시드 §1 사용자(29명, 고정 UUID). §2 이후는 Phase 2~6 이 이어 쓴다 |
| `supabase/tests/deno.json` | Deno 설정(import map, lock 없음) |
| `supabase/tests/_pglite-stubs.ts` | `auth`·`cron`·`storage` 스키마 스텁, 역할 |
| `supabase/tests/_harness.ts` | `openDb()`, `applySeed()`, `withCase()`, `asUser()`, `asAnon()`, `setToday()`, `newUser()`, `expectFail()` |
| `supabase/tests/_testenv.ts` | 로컬 supabase 클라이언트·테스트 사용자, `dbTest()` |
| `supabase/tests/schema-sql.test.ts` | 0001 적용·profiles 트리거 |
| `supabase/tests/core-sql.test.ts` | 0002 헬퍼 전부 |
| `supabase/tests/rls-sql.test.ts` | 0003 헬퍼 함수 진릿값 |
| `supabase/tests/me-sql.test.ts` | `me_*`·`nickname_check`·`meta_get` |
| `supabase/tests/seed-sql.test.ts` | 시드 사용자 29명·tone |
| `supabase/tests/auth-db.test.ts` | 로컬 supabase: RLS(이메일 비노출)·`me_get` RPC |
| `src/lib/supabase/server.ts` · `client.ts` · `admin.ts` | asklyy 패턴 그대로 |
| `src/lib/supabase/middleware.ts` | `updateSession(request)` |
| `src/lib/supabase/return-to.ts` (+ `.test.ts`) | `isProtectedPath`, `safeReturnTo` 순수 함수 |
| `src/proxy.ts` | Next 16 Proxy 진입점 |
| `.env.example`, `README.md`, `.vercelignore`, `.gitignore`, `tsconfig.json`, `eslint.config.mjs`, `package.json`, `vitest.config.ts` | 설정 |

---

## Phase 0 — 기반

### Task 1: Supabase CLI 레이아웃 · config.toml · 의존성

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/.gitkeep`, `supabase/seed.sql`(헤더만), `.vercelignore`
- Modify: `package.json`(scripts, deps), `tsconfig.json`(exclude), `eslint.config.mjs`(ignores), `.gitignore`

**Interfaces:**
- Produces: npm 스크립트 `test:db`, `db:reset`, `db:types`, `test`(vitest). 로컬 API `http://127.0.0.1:54321`, DB 포트 54322, Studio 54323, Inbucket 54324.

- [ ] **Step 1: 메모리 확인 후 `supabase init`**

Run:
```bash
vm_stat | grep -E 'free|compressor'
cd /Users/picpal/Desktop/workspace/sgtudy && supabase init --with-vscode-settings=false --with-intellij-settings=false
ls supabase
```
Expected: `config.toml` 생성(`project_id = "sgtudy"`). `supabase/.temp` 는 생기지 않거나 비어 있음.

- [ ] **Step 2: `supabase/config.toml` 을 아래 내용으로 교체**

생성된 파일을 전부 지우고 다음으로 바꾼다(주석 제거본. 키 이름은 CLI 2.75 기준).

```toml
project_id = "sgtudy"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]

[realtime]
enabled = false

[studio]
enabled = true
port = 54323
api_url = "http://127.0.0.1"

[inbucket]
enabled = true
port = 54324

[storage]
enabled = true
file_size_limit = "10MiB"

# D10: private 버킷, 10MB, MIME 화이트리스트. 호스팅에는 0003_rls.sql 이 같은 설정으로 INSERT 한다.
[storage.buckets.attachments]
public = false
file_size_limit = "10MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/zip", "application/x-zip-compressed", "text/plain", "text/markdown"]

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**", "http://127.0.0.1:3000/**", "https://sgtudy.vercel.app/**"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = true
enable_anonymous_sign_ins = false
enable_manual_linking = false
minimum_password_length = 6

[auth.rate_limit]
email_sent = 30
token_refresh = 150
sign_in_sign_ups = 30
token_verifications = 30

# 디자인 §4.1 / 03-api §1: 6자리 OTP, 만료 600초, 재전송 60초. 호스팅 대시보드(Auth → Providers → Email)에도 같은 값을 넣는다.
[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
secure_password_change = false
max_frequency = "60s"
otp_length = 6
otp_expiry = 600

[auth.sms]
enable_signup = false

[edge_runtime]
enabled = false

[analytics]
enabled = false
```

- [ ] **Step 3: `supabase/seed.sql` 헤더와 `.gitkeep`**

```sql
-- 로컬·테스트 전용 시드 (02-domain-and-schema.md §8). `supabase db reset` 이 마이그레이션 뒤에 실행한다.
-- 기준일 2026-10-12. 섹션 순서: §1 사용자(이 파일 아래, plan 01) → §2 방·멤버(plan 02) → §3 커리큘럼(plan 03) → §4 제출·알림·태그(plan 04).
```

Run: `touch supabase/migrations/.gitkeep`

- [ ] **Step 4: 의존성 설치**

Run:
```bash
vm_stat | grep -E 'free|compressor'
npm install @supabase/ssr@latest @supabase/supabase-js@latest
npm install -D vitest@latest
```
Expected: `package.json` dependencies 에 `@supabase/ssr`(0.12 대 — 개요의 "0.5" 와 쿠키 API `getAll/setAll` 가 동일), `@supabase/supabase-js`(2.x), devDependencies 에 `vitest`.

- [ ] **Step 5: `package.json` scripts**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:db": "deno test -A --config supabase/tests/deno.json supabase/tests",
  "db:reset": "supabase db reset",
  "db:types": "supabase gen types typescript --local > src/lib/supabase/database.types.ts"
}
```

- [ ] **Step 6: Next/ESLint 가 Deno 파일을 건드리지 않게**

`tsconfig.json` 의 `"exclude": ["node_modules"]` → `"exclude": ["node_modules", "supabase"]`.

`eslint.config.mjs` 의 `globalIgnores([...])` 배열에 `"supabase/**"` 추가:
```js
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "supabase/**",
  ]),
```

`.gitignore` 끝에 추가:
```
# supabase local
supabase/.temp/
supabase/.branches/
```

`.vercelignore` 생성:
```
supabase
docs
```

- [ ] **Step 7: 빌드·린트가 여전히 통과하는지 확인**

Run: `npm run lint && npx tsc --noEmit`
Expected: 오류 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/config.toml supabase/seed.sql supabase/migrations/.gitkeep package.json package-lock.json tsconfig.json eslint.config.mjs .gitignore .vercelignore
git commit -m "feat(db): supabase 레이아웃·config·의존성

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 2: PGlite 테스트 하네스 · 로컬 supabase 테스트 환경

**Files:**
- Create: `supabase/tests/deno.json`, `supabase/tests/_pglite-stubs.ts`, `supabase/tests/_harness.ts`, `supabase/tests/_testenv.ts`, `supabase/tests/harness-sql.test.ts`

**Interfaces:**
- Produces (모든 `*-sql.test.ts` 가 쓴다):
  ```ts
  export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  export async function openDb(): Promise<PGlite>;                       // 스텁 + supabase/migrations/*.sql 전부 적용
  export async function applySeed(db: PGlite): Promise<void>;            // supabase/seed.sql 적용
  export function withCase(db: PGlite, fn: (q: Q) => Promise<void>): () => Promise<void>;  // begin … rollback
  export async function asUser(q: Q, uid: string): Promise<void>;        // set_config('app.uid', uid, true)
  export async function asAnon(q: Q): Promise<void>;                     // set_config('app.uid', '', true)
  export async function setToday(q: Q, ymd: string): Promise<void>;      // set_config('app.today', ymd, true)
  export async function newUser(q: Q, email?: string): Promise<string>;  // auth.users INSERT → uuid
  export async function expectFail(p: Promise<unknown>, code: string): Promise<void>;
  ```
  ```ts
  // _testenv.ts (로컬 supabase)
  export const hasEnv: boolean;
  export function service(): SupabaseClient;  export function anon(): SupabaseClient;
  export async function testUser(n?: number): Promise<{ id: string; email: string; password: string }>;
  export async function userClient(n?: number): Promise<{ u: TestUser; c: SupabaseClient }>;
  export function dbTest(name: string, fn: () => Promise<void>): void;   // hasEnv 아니면 ignore
  ```

- [ ] **Step 1: `supabase/tests/deno.json`**

```json
{
  "lock": false,
  "nodeModulesDir": "none",
  "imports": {
    "@std/assert": "jsr:@std/assert@1",
    "pglite": "npm:@electric-sql/pglite@0.3",
    "pglite/contrib/citext": "npm:@electric-sql/pglite@0.3/contrib/citext",
    "pglite/contrib/pg_trgm": "npm:@electric-sql/pglite@0.3/contrib/pg_trgm",
    "supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: `supabase/tests/_pglite-stubs.ts`**

PGlite 에는 Supabase 의 `auth`·`cron`·`storage` 스키마와 역할이 없다. 마이그레이션이 참조하는 것만 같은 이름·모양으로 흉내 낸다. `auth.users` 는 시드가 넣는 컬럼까지 갖춘다.

```ts
// PGlite 용 Supabase 스텁. 마이그레이션·시드가 닿는 auth / cron / storage 객체만 같은 모양으로.
// RLS 는 PGlite(수퍼유저)에서 강제되지 않는다 — 정책의 진릿값은 헬퍼 함수로, 실제 차단은 *-db.test.ts 가 본다.
export const PGLITE_STUBS = `
create role anon; create role authenticated; create role service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  instance_id uuid default '00000000-0000-0000-0000-000000000000',
  aud text default 'authenticated',
  role text default 'authenticated',
  email text,
  encrypted_password text default '',
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}',
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz,
  confirmation_token text default '', recovery_token text default '',
  email_change text default '', email_change_token_new text default '', email_change_token_current text default ''
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null, provider text not null,
  identity_data jsonb not null default '{}',
  last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (provider_id, provider)
);
-- 테스트는 set_config('app.uid', <uuid>, true) 로 로그인 사용자를 흉내 낸다
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('app.role', true), ''), case when auth.uid() is null then 'anon' else 'authenticated' end) $$;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner_id text, metadata jsonb default '{}', created_at timestamptz default now()
);
alter table storage.objects enable row level security;
-- 진짜 storage.foldername 은 마지막 조각(파일명)을 뺀 경로 배열을 돌려준다
create function storage.foldername(p_name text) returns text[] language sql immutable as
  $$ select (string_to_array(p_name, '/'))[1 : array_length(string_to_array(p_name, '/'), 1) - 1] $$;
`;
```

- [ ] **Step 3: `supabase/tests/_harness.ts`**

```ts
import { PGlite } from "pglite";
import { citext } from "pglite/contrib/citext";
import { pg_trgm } from "pglite/contrib/pg_trgm";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
const SEED_FILE = new URL("../seed.sql", import.meta.url);

// pg_cron 은 PGlite 에 없다. 0010 의 CREATE EXTENSION 줄만 걷어내고 cron.schedule 스텁이 받는다.
function stripUnsupported(sql: string): string {
  return sql.replace(/^\s*create extension if not exists pg_cron\s*;\s*$/gim, "");
}

export async function migrationFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) if (e.isFile && e.name.endsWith(".sql")) names.push(e.name);
  return names.sort();
}

/** 스텁 + supabase/migrations/*.sql 을 번호순으로 적용한 PGlite */
export async function openDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { citext, pg_trgm } });
  await db.exec(PGLITE_STUBS);
  for (const name of await migrationFiles()) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    try { await db.exec(stripUnsupported(sql)); }
    catch (e) { throw new Error(`migration ${name}: ${(e as Error).message}`); }
  }
  return db;
}

export async function applySeed(db: PGlite): Promise<void> {
  await db.exec(await Deno.readTextFile(SEED_FILE));
}

export function makeQ(db: PGlite): Q {
  return async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
}

/** 사례마다 begin … rollback. set_config(…, true) 도 함께 되돌아간다 */
export function withCase(db: PGlite, fn: (q: Q) => Promise<void>): () => Promise<void> {
  return async () => {
    await db.exec("begin");
    try { await fn(makeQ(db)); } finally { await db.exec("rollback"); }
  };
}

export const asUser = async (q: Q, uid: string) => { await q("select set_config('app.uid', $1, true)", [uid]); };
export const asAnon = async (q: Q) => { await q("select set_config('app.uid', '', true)"); };
export const setToday = async (q: Q, ymd: string) => { await q("select set_config('app.today', $1, true)", [ymd]); };

/** auth.users 에 한 명 넣고(→ profiles 트리거) id 를 돌려준다 */
export async function newUser(q: Q, email = `${crypto.randomUUID().slice(0, 8)}@example.com`): Promise<string> {
  const id = crypto.randomUUID();
  await q("insert into auth.users (id, email, email_confirmed_at) values ($1::uuid, $2, now())", [id, email]);
  return id;
}

/** public.fail() 이 던진 코드 확인 — 메시지(MESSAGE=<CODE>)에 코드가 들어 있어야 한다 */
export async function expectFail(p: Promise<unknown>, code: string): Promise<void> {
  try { await p; }
  catch (e) {
    const msg = (e as Error).message;
    if (msg.includes(code)) return;
    throw new Error(`expected ${code}, got: ${msg}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

export function sqlTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeResources: false, sanitizeOps: false });
}
```

- [ ] **Step 4: `supabase/tests/_testenv.ts`**

```ts
import { createClient, type SupabaseClient } from "supabase-js";

// 로컬 supabase(supabase start) 또는 호스팅 DB 를 향한 테스트. 환경변수가 없으면 dbTest 가 전부 ignore.
//   eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
// 테스트는 자기 테스트 사용자(sgtudy-test-<n>@example.com)와 실행 태그 RUN 으로 만든 행만 만지고, 시드 행은 읽기만 한다.
const URL = Deno.env.get("SUPABASE_URL");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const hasEnv = Boolean(URL && ANON && SERVICE);
export const RUN = "t" + crypto.randomUUID().slice(0, 6);

const OPTS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const service = (): SupabaseClient => createClient(URL!, SERVICE!, OPTS);
export const anon = (): SupabaseClient => createClient(URL!, ANON!, OPTS);

export type TestUser = { id: string; email: string; password: string };
const cache = new Map<string, Promise<TestUser>>();

export function testUser(n = 1): Promise<TestUser> {
  const email = `sgtudy-test-${n}@example.com`;
  let p = cache.get(email);
  if (!p) {
    p = (async () => {
      const password = crypto.randomUUID() + "Aa1!";
      const admin = service();
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error("listUsers " + error.message);
      const found = data.users.find((u) => u.email === email);
      if (found) {
        const up = await admin.auth.admin.updateUserById(found.id, { password });
        if (up.error) throw new Error("updateUser " + up.error.message);
        return { id: found.id, email, password };
      }
      const cr = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (cr.error || !cr.data.user) throw new Error("createUser " + cr.error?.message);
      return { id: cr.data.user.id, email, password };
    })();
    cache.set(email, p);
  }
  return p;
}

export async function userClient(n = 1): Promise<{ u: TestUser; c: SupabaseClient }> {
  const u = await testUser(n);
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("signin " + error.message);
  return { u, c };
}

export function dbTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name: "db: " + name, fn, ignore: !hasEnv, sanitizeResources: false, sanitizeOps: false });
}
```

- [ ] **Step 5: 하네스 자체 테스트 `supabase/tests/harness-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { asAnon, asUser, openDb, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("harness: stubs expose auth.uid() driven by app.uid", withCase(db, async (q) => {
  await asAnon(q);
  assertEquals((await q("select auth.uid() as uid"))[0].uid, null);
  const uid = crypto.randomUUID();
  await asUser(q, uid);
  assertEquals((await q("select auth.uid()::text as uid"))[0].uid, uid);
  assertEquals((await q("select auth.role() as r"))[0].r, "authenticated");
}));

sqlTest("harness: rollback isolates cases", withCase(db, async (q) => {
  await q("create table _tmp_probe (x int)");
  await q("insert into _tmp_probe values (1)");
}));

sqlTest("harness: previous case left nothing behind", withCase(db, async (q) => {
  const r = await q("select to_regclass('public._tmp_probe') as t");
  assertEquals(r[0].t, null);
}));

sqlTest("harness: storage.foldername drops the file name", withCase(db, async (q) => {
  const r = await q("select storage.foldername('12/34/abc/x.png') as f");
  assertEquals(r[0].f, ["12", "34", "abc"]);
}));
```

- [ ] **Step 6: 실행**

Run: `npm run test:db`
Expected: 4 passed (마이그레이션 디렉터리는 아직 `.gitkeep` 뿐이라 적용 0건).

- [ ] **Step 7: Commit**

```bash
git add supabase/tests
git commit -m "test(db): PGlite 하네스·로컬 supabase 테스트 환경

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 3: SSR 클라이언트 · Proxy(보호 라우트) · 환경변수 · README

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/return-to.ts`, `src/lib/supabase/return-to.test.ts`, `src/proxy.ts`, `vitest.config.ts`
- Modify: `.env.example`, `README.md:34-38`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/supabase/server.ts
  export async function createClient(): Promise<SupabaseClient>;     // 서버 컴포넌트·Route Handler·Server Action
  // src/lib/supabase/client.ts
  export function createClient(): SupabaseClient;                    // 브라우저
  // src/lib/supabase/admin.ts
  export function createAdminClient(): SupabaseClient;               // service_role, 서버 스크립트 전용
  // src/lib/supabase/middleware.ts
  export async function updateSession(request: NextRequest): Promise<NextResponse>;
  // src/lib/supabase/return-to.ts
  export const PROTECTED_PREFIXES: readonly string[];               // "/my-study", "/schedule", "/me", "/rooms/new"
  export function isProtectedPath(pathname: string): boolean;
  export function safeReturnTo(raw: string | null | undefined): string;   // 허용 접두사 아니면 "/"
  export function loginUrl(returnTo: string): string;                // "/login?returnTo=<encoded>"
  ```
  Phase 7 의 `/login` 페이지는 `safeReturnTo(searchParams.returnTo)` 로 복귀 경로를 정한다.

- [ ] **Step 1: 실패하는 테스트 `src/lib/supabase/return-to.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isProtectedPath, loginUrl, safeReturnTo } from "./return-to";

describe("isProtectedPath", () => {
  it("protects my-study, schedule, me, rooms/new", () => {
    for (const p of ["/my-study", "/my-study/aws", "/schedule", "/me", "/rooms/new"]) expect(isProtectedPath(p)).toBe(true);
  });
  it("leaves public pages alone", () => {
    for (const p of ["/", "/rooms", "/rooms/aws", "/login", "/invite/abc", "/onboarding"]) expect(isProtectedPath(p)).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("accepts allow-listed prefixes", () => {
    expect(safeReturnTo("/rooms/aws")).toBe("/rooms/aws");
    expect(safeReturnTo("/my-study/aws?task=3")).toBe("/my-study/aws?task=3");
    expect(safeReturnTo("/schedule")).toBe("/schedule");
    expect(safeReturnTo("/invite/abc123")).toBe("/invite/abc123");
  });
  it("falls back to / for anything else (Review Focus 2)", () => {
    for (const bad of [null, undefined, "", "/", "/me", "//evil.com", "/\\evil.com", "https://evil.com", "/rooms/../me",
                       "javascript:alert(1)", "/roomsx", " /rooms/aws", "/rooms/aws\n"]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
  });
});

describe("loginUrl", () => {
  it("encodes returnTo", () => {
    expect(loginUrl("/my-study/aws?task=3")).toBe("/login?returnTo=%2Fmy-study%2Faws%3Ftask%3D3");
  });
});
```

- [ ] **Step 2: `vitest.config.ts` 를 만들고 실패 확인**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

Run: `npm test`
Expected: FAIL — `Cannot find module './return-to'`.

- [ ] **Step 3: `src/lib/supabase/return-to.ts`**

```ts
/** 로그인 필요 라우트(D6). `/rooms/[slug]` 는 공개라 `/rooms/new` 만 정확히 잡는다. */
export const PROTECTED_PREFIXES = ["/my-study", "/schedule", "/me", "/rooms/new"] as const;

/** returnTo 로 허용하는 접두사(03-api §1). 그 외는 전부 "/". */
const RETURN_TO_PREFIXES = ["/rooms/", "/my-study", "/schedule", "/invite/"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  // 절대 URL·프로토콜 상대·백슬래시·상위 경로·공백/제어문자 전부 거부 (오픈 리다이렉트 차단)
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw) || raw.includes("..")) return "/";
  if (!RETURN_TO_PREFIXES.some((p) => raw === p || raw.startsWith(p))) return "/";
  return raw;
}

export function loginUrl(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
```

주의: `/my-study` 접두사는 `/my-studyx` 도 통과시킨다. 그런 경로는 앱에 없고 404 가 날 뿐이라 허용한다(테스트의 `/roomsx` 는 `/rooms/` 접두사라 걸러진다).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 5 passed.

- [ ] **Step 5: 클라이언트 3종 (asklyy 패턴)**

`src/lib/supabase/server.ts`:
```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** 서버 컴포넌트·Route Handler·Server Action 용. 세션 쿠키는 proxy(updateSession)가 갱신한다. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // 서버 컴포넌트에서 호출되면 쿠키를 못 쓴다. proxy 가 세션을 갱신하므로 무시해도 된다.
          }
        },
      },
    },
  );
}
```

`src/lib/supabase/client.ts`:
```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
```

`src/lib/supabase/admin.ts`:
```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

/** service_role 클라이언트. RLS 를 우회한다 — 시드·관리 스크립트·서버 전용. 브라우저 번들에 들어가면 안 된다(server-only). */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

`server-only` 패키지는 Next 가 내장 제공한다(별도 설치 불필요).

- [ ] **Step 6: `src/lib/supabase/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrl } from "./return-to";

/**
 * 세션 쿠키 갱신 + 보호 라우트 가드(D6). @supabase/ssr 공식 패턴: 요청 쿠키와 응답 쿠키를 함께 갱신한다.
 * getUser() 는 Auth 서버에 토큰을 검증시키므로 getSession() 대신 쓴다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    return NextResponse.redirect(new URL(loginUrl(returnTo), request.url));
  }
  return response;
}
```

- [ ] **Step 7: `src/proxy.ts`**

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16: middleware.ts 는 deprecated, proxy.ts 가 같은 역할(node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md)
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 정적 자원·이미지·파비콘 제외, 나머지 전부(세션 갱신은 모든 페이지에서 필요)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
```

- [ ] **Step 8: `.env.example` 교체**

```
# Supabase (D6). 브라우저에서도 읽으므로 NEXT_PUBLIC_ 접두사. Vercel 에는 이 두 키만 등록한다.
#   로컬: supabase start 후 `supabase status` 의 API URL / anon key
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# 서버 전용. .env.local 과 시드/관리 스크립트에만 두고 Vercel 에는 넣지 않는다.
SUPABASE_SERVICE_ROLE_KEY=
```

`.env.local` 에는 Vercel CLI 가 넣은 `VERCEL_OIDC_TOKEN` 이 있다. 그 아래에 위 세 키를 `supabase status` 값으로 채운다(커밋 대상 아님).

- [ ] **Step 9: README "백엔드 연결 준비" 절 교체**

`README.md` 34~38행(`## 백엔드 연결 준비` 절)을 다음으로 바꾼다:

```markdown
## 백엔드 (Supabase)

설계: `docs/backend/{01-decisions,02-domain-and-schema,03-api}.md`, 계획: `docs/superpowers/plans/2026-10-13-backend-*.md`.

```bash
vm_stat | grep -E 'free|compressor'   # 메모리 확인 — 빌드와 동시에 띄우지 않는다
supabase start                          # Docker. API 54321 · DB 54322 · Studio 54323 · Inbucket(메일) 54324
supabase status                         # URL·anon key → .env.local
npm run db:reset                        # migrations + seed.sql 재적용
npm run db:types                        # src/lib/supabase/database.types.ts 생성
npm run test:db                         # PGlite(Deno) SQL 테스트 — Docker 불필요. SUPABASE_URL 등이 있으면 *-db.test.ts 도 실행
npm test                                # Vitest(프론트 순수 함수·어댑터)
```

- 환경변수: `.env.example` 참조. Vercel 에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만.
- 호스팅 프로젝트 Auth 설정: Email OTP 켜기, 템플릿에 `{{ .Token }}`, OTP 길이 6, 만료 600초, 재전송 60초, Redirect URLs 에 `https://sgtudy.vercel.app/**`.
- 로컬 로그인: OTP 메일은 Inbucket(http://127.0.0.1:54324)에서 본다. 시드 사용자 이메일은 `supabase/seed.sql` §1.
- 로컬 DB 테스트(`*-db.test.ts`)를 돌리려면:
  `eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY`
- 목업 데이터는 `src/data/*.ts` 에 화면별로 분리돼 있어, Phase 7 에서 `src/lib/api/*.ts` 어댑터가 같은 export 시그니처로 교체한다.
- "오늘" 기준일은 DB 의 `kst_today()` 가 공급한다(시드·테스트는 2026-10-12 고정).
```

- [ ] **Step 10: 타입·린트·테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 오류 0, vitest 5 passed. (`npm run dev` 로 `/my-study` 에 접근하면 `/login?returnTo=%2Fmy-study` 로 307 — `/login` 은 Phase 7 에서 만들므로 지금은 404 가 정상.)

- [ ] **Step 11: Commit**

```bash
git add src/lib/supabase src/proxy.ts vitest.config.ts .env.example README.md
git commit -m "feat(web): supabase SSR 클라이언트·proxy 보호 라우트·env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 1 — 스키마 · 공통 헬퍼 · RLS · 사용자

### Task 4: `0001_schema.sql` (스펙 §2 원문) · profiles 트리거 검증

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `supabase/tests/schema-sql.test.ts`
- Delete: `supabase/migrations/.gitkeep`

**Interfaces:**
- Produces: `02-domain-and-schema.md` §2 의 모든 테이블·인덱스·`handle_new_auth_user()`·`on_auth_user_created` 트리거. 이후 모든 태스크가 이 컬럼명을 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/schema-sql.test.ts`**

```ts
import { assert, assertEquals } from "@std/assert";
import { migrationFiles, newUser, openDb, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("0001: is the first migration", async () => {
  assertEquals((await migrationFiles())[0], "0001_schema.sql");
});

sqlTest("0001: all tables exist", withCase(db, async (q) => {
  const want = ["profiles", "rooms", "room_members", "room_invites", "goal_nodes", "task_assignments", "submissions",
    "submission_links", "files", "tags", "room_tags", "room_tag_suppressions", "notifications",
    "room_notification_settings", "mail_outbox"];
  const rows = await q("select table_name from information_schema.tables where table_schema = 'public' order by 1");
  const have = rows.map((r) => r.table_name);
  for (const t of want) assert(have.includes(t), `missing table ${t}`);
}));

sqlTest("0001: auth.users insert creates a profile with email and a palette tone", withCase(db, async (q) => {
  const uid = await newUser(q, "Hello@Example.com");
  const p = await q("select email::text as email, nickname, avatar_tone from public.profiles where id = $1::uuid", [uid]);
  assertEquals(p.length, 1);
  assertEquals(p[0].email, "Hello@Example.com");
  assertEquals(p[0].nickname, null);
  assert(["mint", "blue", "peach", "lav", "amber", "slate"].includes(p[0].avatar_tone as string));
  // citext: 대소문자 무시 비교
  const c = await q("select count(*)::int as n from public.profiles where email = 'hello@example.com'");
  assertEquals(c[0].n, 1);
}));

sqlTest("0001: rooms checks reject bad period and capacity", withCase(db, async (q) => {
  const uid = await newUser(q);
  let failed = false;
  try {
    await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
             values ('x', 't', 'i', '2026-10-10', '2026-10-01', 6, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]);
  } catch { failed = true; }
  assert(failed, "ck_rooms_period should reject");
  failed = false;
  try {
    await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
             values ('y', 't', 'i', '2026-10-01', '2026-10-10', 1, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]);
  } catch { failed = true; }
  assert(failed, "ck_rooms_members should reject max_members=1");
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:db -- --filter 0001`
Expected: FAIL — "is the first migration" 에서 `undefined !== "0001_schema.sql"`, 테이블 없음.

- [ ] **Step 3: `supabase/migrations/0001_schema.sql` — 02 §2 코드 블록을 한 글자도 바꾸지 않고 복사**

파일 첫 줄에 주석 한 줄만 추가한다:
```sql
-- 02-domain-and-schema.md §2 원문. 배포 후 수정 금지(변경은 다음 번호 마이그레이션).
```
그 뒤 `docs/backend/02-domain-and-schema.md` 의 `## 2. 0001_schema.sql` 아래 ```sql 블록 전체(`CREATE EXTENSION IF NOT EXISTS citext;` 부터 `mail_outbox` 테이블 끝까지)를 그대로 붙인다. 확인 명령:

```bash
awk '/^## 2\. 0001_schema.sql/{f=1} f&&/^```sql/{s=1;next} s&&/^```/{exit} s' docs/backend/02-domain-and-schema.md > /tmp/ddl.sql
diff <(tail -n +2 supabase/migrations/0001_schema.sql) /tmp/ddl.sql && echo VERBATIM
rm supabase/migrations/.gitkeep
```
Expected: `VERBATIM`.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:db`
Expected: harness 4 + schema 4 = 8 passed. (PGlite 에서 `CREATE EXTENSION citext/pg_trgm` 은 하네스가 contrib 를 로드했으므로 통과.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_schema.sql supabase/tests/schema-sql.test.ts
git rm -q supabase/migrations/.gitkeep
git commit -m "feat(db): 0001 스키마 (02 §2 원문)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 5: `0002_functions_core.sql` — 공통 헬퍼 · 트리거

**Files:**
- Create: `supabase/migrations/0002_functions_core.sql`, `supabase/tests/core-sql.test.ts`

**Interfaces:**
- Consumes: 0001 의 `profiles`, `rooms`, `room_members`, `goal_nodes`, `submissions`.
- Produces (개요 "공통 계약" 블록과 동일):
  ```sql
  public.current_user_id() returns uuid                       -- STABLE
  public.require_user() returns uuid                          -- AUTH_REQUIRED / ONBOARDING_REQUIRED
  public.kst_today() returns date                             -- STABLE, app.today 우선
  public.kst_deadline(p_end date) returns timestamptz         -- STABLE
  public.fail(p_code text, p_detail text, p_hint jsonb default null) returns void
  public.iso(p_ts timestamptz) returns text                   -- IMMUTABLE
  public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date) returns text  -- IMMUTABLE
  public.leaf_state(p_asg int, p_sub int, p_s date, p_e date, p_today date) returns text               -- IMMUTABLE
  public.pct(p_asg int, p_sub int) returns int                -- IMMUTABLE
  public.person_json(p_user uuid) returns jsonb               -- STABLE
  public.slugify(p_title text, p_id bigint) returns text      -- IMMUTABLE
  public.set_updated_at() returns trigger                     -- rooms·room_members·goal_nodes·submissions
  public.submissions_guard_immutable() returns trigger        -- I9 → FIELD_LOCKED
  trigger on_auth_user_email_updated on auth.users            -- Review Focus 5
  ```

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/core-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { asAnon, asUser, expectFail, newUser, openDb, setToday, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("kst_today: honors app.today, else Seoul date", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  assertEquals((await q("select public.kst_today()::text as d"))[0].d, "2026-10-12");
  await q("select set_config('app.today', '', true)");
  const r = await q("select (public.kst_today() = (now() at time zone 'Asia/Seoul')::date) as same");
  assertEquals(r[0].same, true);
}));

sqlTest("kst_deadline: next day 00:00 KST = 15:00Z of end_date (Review Focus 4)", withCase(db, async (q) => {
  const r = await q("select public.iso(public.kst_deadline('2026-10-03')) as d");
  assertEquals(r[0].d, "2026-10-03T15:00:00.000Z");
  const late = await q("select ('2026-10-03 15:00:30+00'::timestamptz >= public.kst_deadline('2026-10-03')) as l");
  assertEquals(late[0].l, true);
  const onTime = await q("select ('2026-10-03 14:59:59+00'::timestamptz >= public.kst_deadline('2026-10-03')) as l");
  assertEquals(onTime[0].l, false);
}));

sqlTest("task_code: full matrix", withCase(db, async (q) => {
  const code = async (first: string | null, late: boolean, today: string) =>
    (await q("select public.task_code('2026-10-01', '2026-10-03', $1::timestamptz, $2, $3::date) as c", [first, late, today]))[0].c;
  assertEquals(await code(null, false, "2026-09-30"), "planned");
  assertEquals(await code(null, false, "2026-10-01"), "open");
  assertEquals(await code(null, false, "2026-10-03"), "open");
  assertEquals(await code(null, false, "2026-10-04"), "missed");
  assertEquals(await code("2026-10-02 09:00+09", false, "2026-10-12"), "done");
  assertEquals(await code("2026-10-04 00:00:30+09", true, "2026-10-12"), "late");   // 자정 30초 뒤 제출
  assertEquals(await code("2026-10-02 09:00+09", false, "2026-09-01"), "done");    // 제출이 있으면 날짜 무관
}));

sqlTest("leaf_state: unassigned/complete/planned/delayed/progress", withCase(db, async (q) => {
  const st = async (asg: number, sub: number, today: string) =>
    (await q("select public.leaf_state($1, $2, '2026-10-01', '2026-10-03', $3::date) as s", [asg, sub, today]))[0].s;
  assertEquals(await st(0, 0, "2026-10-02"), "unassigned");
  assertEquals(await st(4, 4, "2026-10-02"), "complete");
  assertEquals(await st(4, 1, "2026-09-30"), "planned");
  assertEquals(await st(4, 1, "2026-10-04"), "delayed");
  assertEquals(await st(4, 1, "2026-10-02"), "progress");
}));

sqlTest("pct: null when nothing assigned, half-up rounding (5/8 → 63)", withCase(db, async (q) => {
  assertEquals((await q("select public.pct(0, 0) as p"))[0].p, null);
  assertEquals((await q("select public.pct(8, 5) as p"))[0].p, 63);
  assertEquals((await q("select public.pct(25, 6) as p"))[0].p, 24);
  assertEquals((await q("select public.pct(78, 68) as p"))[0].p, 87);
  assertEquals((await q("select public.pct(35, 12) as p"))[0].p, 34);
  assertEquals((await q("select public.pct(3, 3) as p"))[0].p, 100);
}));

sqlTest("iso: UTC with milliseconds and Z", withCase(db, async (q) => {
  assertEquals((await q("select public.iso('2026-10-12 09:30:15.25+09'::timestamptz) as t"))[0].t, "2026-10-12T00:30:15.250Z");
}));

sqlTest("slugify: ascii words, hangul-only falls back to r-<base36 id>", withCase(db, async (q) => {
  assertEquals((await q("select public.slugify('AWS SAA 자격증 3개월 완주', 7) as s"))[0].s, "aws-saa-3");
  assertEquals((await q("select public.slugify('토익 900 8주 챌린지', 2) as s"))[0].s, "900-8");
  assertEquals((await q("select public.slugify('스프링 핵심 원리', 36) as s"))[0].s, "r-10");
  assertEquals((await q("select public.slugify('  Docker---Compose!! ', 1) as s"))[0].s, "docker-compose");
  const long = (await q("select public.slugify(repeat('abcde ', 20), 1) as s"))[0].s as string;
  assertEquals(long.length <= 50, true);
}));

sqlTest("fail: raises P0001 with code as message, detail and json hint", withCase(db, async (q) => {
  try {
    await q("select public.fail('ROOM_FULL', '정원이 찼어요', '{\"field\":\"maxMembers\"}'::jsonb)");
    throw new Error("should have raised");
  } catch (e) {
    const err = e as Error & { detail?: string; hint?: string; code?: string };
    assertEquals(err.message.includes("ROOM_FULL"), true);
    assertEquals(err.detail, "정원이 찼어요");
    assertEquals(err.hint, '{"field": "maxMembers"}');
    assertEquals(err.code, "P0001");
  }
  await expectFail(q("select public.fail('AUTH_REQUIRED', '로그인이 필요해요')"), "AUTH_REQUIRED");
}));

sqlTest("current_user_id / require_user: anon, onboarding, onboarded (Review Focus 3)", withCase(db, async (q) => {
  await asAnon(q);
  assertEquals((await q("select public.current_user_id() as u"))[0].u, null);
  await expectFail(q("select public.require_user()"), "AUTH_REQUIRED");
  const uid = await newUser(q);
  await asUser(q, uid);
  assertEquals((await q("select public.current_user_id()::text as u"))[0].u, uid);
  await expectFail(q("select public.require_user()"), "ONBOARDING_REQUIRED");
  await q("update public.profiles set nickname = '철수', nickname_normalized = '철수' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.require_user()::text as u"))[0].u, uid);
}));

sqlTest("person_json: userId/nickname/tone, empty nickname before onboarding", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q("update public.profiles set avatar_tone = 'blue' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.person_json($1::uuid) as p", [uid]))[0].p, { userId: uid, nickname: "", tone: "blue" });
  await q("update public.profiles set nickname = '철수' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.person_json($1::uuid) as p", [uid]))[0].p, { userId: uid, nickname: "철수", tone: "blue" });
}));

sqlTest("auth.users email update syncs profiles.email (Review Focus 5)", withCase(db, async (q) => {
  const uid = await newUser(q, "old@example.com");
  await q("update auth.users set email = 'new@example.com' where id = $1::uuid", [uid]);
  assertEquals((await q("select email::text as e from public.profiles where id = $1::uuid", [uid]))[0].e, "new@example.com");
}));

sqlTest("updated_at trigger bumps on rooms update", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id, updated_at)
           values ('r1', 't', 'i', '2026-10-01', '2026-10-10', 6, 'PUBLIC', 'DIRECT', $1::uuid, '2020-01-01')`, [uid]);
  await q("update public.rooms set title = 't2' where slug = 'r1'");
  const r = await q("select (updated_at > '2025-01-01'::timestamptz) as bumped from public.rooms where slug = 'r1'");
  assertEquals(r[0].bumped, true);
}));

sqlTest("submissions: first_submitted_at and is_late are immutable (I9 → FIELD_LOCKED)", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
           values ('r1', 't', 'i', '2026-10-01', '2026-10-10', 6, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]);
  await q(`insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type)
           values ((select id from public.rooms where slug = 'r1'), null, 2, 0, '1주차', 'w1', '2026-10-01', '2026-10-07', 'COMMON')`);
  await q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
           values ((select id from public.goal_nodes where title = 'w1'), $1::uuid, 'hi', '2026-10-02 09:00+09', false)`, [uid]);
  await q("update public.submissions set body_md = 'edited' where user_id = $1::uuid", [uid]);   // 본문 수정은 허용
  await expectFail(q("update public.submissions set is_late = true where user_id = $1::uuid", [uid]), "FIELD_LOCKED");
  await expectFail(q("update public.submissions set first_submitted_at = now() where user_id = $1::uuid", [uid]), "FIELD_LOCKED");
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:db -- --filter "kst_today"`
Expected: FAIL — `function public.kst_today() does not exist`.

- [ ] **Step 3: `supabase/migrations/0002_functions_core.sql`**

```sql
-- 공통 헬퍼 (00-overview "공통 계약", 01-decisions D5·D13). 순수 함수는 IMMUTABLE, 설정·테이블을 읽는 함수는 STABLE.
-- 규칙: SECURITY DEFINER 는 search_path = '' + 스키마 한정. 에러는 fail() 만.

-- ───────── 에러 ─────────
create or replace function public.fail(p_code text, p_detail text, p_hint jsonb default null)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail, hint = coalesce(p_hint, '{}'::jsonb)::text;
end $$;

-- ───────── 사용자 ─────────
-- 호스팅: auth.uid(). PGlite: auth.uid() 스텁이 app.uid 를 읽는다. 실세션이 없을 때만 app.uid 를 본다(테스트 전용 뒷문이 세션을 이길 수 없게).
create or replace function public.current_user_id()
returns uuid language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.uid', true), '')::uuid)
$$;

create or replace function public.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_nick text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select nickname into v_nick from public.profiles where id = v_uid;
  if not found or v_nick is null then perform public.fail('ONBOARDING_REQUIRED', '닉네임을 먼저 정해 주세요'); end if;
  return v_uid;
end $$;

create or replace function public.person_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.id::text, 'nickname', coalesce(p.nickname, ''), 'tone', p.avatar_tone)
  from public.profiles p where p.id = p_user
$$;

-- ───────── 날짜 ─────────
create or replace function public.kst_today()
returns date language sql stable as $$
  select coalesce(nullif(current_setting('app.today', true), '')::date, (now() at time zone 'Asia/Seoul')::date)
$$;

-- 마감 = end_date 다음날 00:00 KST (exclusive). 제출 시각 >= 마감 이면 지각.
create or replace function public.kst_deadline(p_end date)
returns timestamptz language sql stable as $$
  select ((p_end + 1)::timestamp at time zone 'Asia/Seoul')
$$;

create or replace function public.iso(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ───────── 상태 (D5) ─────────
create or replace function public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date)
returns text language sql immutable as $$
  select case
    when p_first is not null then case when p_late then 'late' else 'done' end
    when p_today < p_s then 'planned'
    when p_today > p_e then 'missed'
    else 'open' end
$$;

create or replace function public.leaf_state(p_asg int, p_sub int, p_s date, p_e date, p_today date)
returns text language sql immutable as $$
  select case
    when p_asg = 0 then 'unassigned'
    when p_sub = p_asg then 'complete'
    when p_today < p_s then 'planned'
    when p_today > p_e then 'delayed'
    else 'progress' end
$$;

-- round(numeric) 은 .5 를 0 에서 먼 쪽으로 → 양수에서 half-up. 5/8 → 62.5 → 63
create or replace function public.pct(p_asg int, p_sub int)
returns int language sql immutable as $$
  select case when p_asg = 0 then null else round(p_sub * 100.0 / p_asg)::int end
$$;

-- ───────── slug (D1) ─────────
-- 영문·숫자만 남겨 '-' 로 잇는다. 아무것도 안 남으면 r-<base36(id)>. 최대 50자(충돌 접미 '-2' 자리를 남긴다).
create or replace function public.slugify(p_title text, p_id bigint)
returns text language plpgsql immutable as $$
declare
  v text;
  v_n bigint := p_id;
  v_b36 text := '';
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
begin
  v := lower(p_title);
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  if v = '' then
    if v_n = 0 then v_b36 := '0'; end if;
    while v_n > 0 loop
      v_b36 := substr(v_digits, (v_n % 36)::int + 1, 1) || v_b36;
      v_n := v_n / 36;
    end loop;
    return 'r-' || v_b36;
  end if;
  return trim(both '-' from left(v, 50));
end $$;

-- ───────── 트리거 ─────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_rooms_updated_at        before update on public.rooms        for each row execute function public.set_updated_at();
create trigger trg_room_members_updated_at before update on public.room_members for each row execute function public.set_updated_at();
create trigger trg_goal_nodes_updated_at   before update on public.goal_nodes   for each row execute function public.set_updated_at();
create trigger trg_submissions_updated_at  before update on public.submissions  for each row execute function public.set_updated_at();

-- I9: first_submitted_at / is_late 는 최초 제출 시 고정
create or replace function public.submissions_guard_immutable()
returns trigger language plpgsql as $$
begin
  if new.first_submitted_at is distinct from old.first_submitted_at or new.is_late is distinct from old.is_late then
    perform public.fail('FIELD_LOCKED', '최초 제출 시각과 지각 여부는 바꿀 수 없어요',
                        jsonb_build_object('field', case when new.is_late is distinct from old.is_late then 'isLate' else 'firstSubmittedAt' end));
  end if;
  return new;
end $$;

create trigger trg_submissions_immutable before update on public.submissions
  for each row execute function public.submissions_guard_immutable();

-- 이메일 변경 동기화 (0001 의 트리거는 INSERT 만). handle_new_auth_user 의 ON CONFLICT … SET email 이 UPDATE 도 처리한다.
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.handle_new_auth_user();
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:db`
Expected: 8 + 13 = 21 passed. `fail` 사례에서 PGlite 가 던지는 오류 객체의 `detail`/`hint`/`code` 필드가 없으면(라이브러리 버전 차) 그 세 줄의 assert 를 `err.message.includes("ROOM_FULL")` 하나로 줄이고 주석으로 이유를 남긴다.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_functions_core.sql supabase/tests/core-sql.test.ts
git commit -m "feat(db): 0002 공통 헬퍼(current_user_id·kst_today·task_code·pct·slugify)·트리거

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 6: `0003_rls.sql` — RLS 헬퍼 · SELECT 정책 · `public_profiles` · Storage

**Files:**
- Create: `supabase/migrations/0003_rls.sql`, `supabase/tests/rls-sql.test.ts`

**Interfaces:**
- Consumes: `public.current_user_id()`.
- Produces (전부 `STABLE SECURITY DEFINER SET search_path = ''`, 개요 공통 계약):
  ```sql
  public.is_room_member(p_room bigint) returns boolean        -- ACTIVE|INACTIVE|PENDING
  public.is_room_leader(p_room bigint) returns boolean
  public.can_read_room(p_room bigint) returns boolean
  public.can_read_submissions(p_room bigint) returns boolean  -- leader or ACTIVE|INACTIVE
  public.is_task_assignee(p_node bigint, p_user uuid) returns boolean
  public.can_read_submission(p_node bigint, p_author uuid) returns boolean  -- 보관 노드는 그룹장·작성자만
  view public.public_profiles (id, nickname, avatar_tone)
  storage bucket 'attachments'
  ```

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/rls-sql.test.ts`**

PGlite 는 수퍼유저라 정책이 **강제되지 않는다**. 여기서는 헬퍼 함수의 진릿값과 정책·뷰·버킷의 존재만 본다. 실제 차단은 Task 9 의 `auth-db.test.ts`.

```ts
import { assert, assertEquals } from "@std/assert";
import { asAnon, asUser, newUser, openDb, sqlTest, withCase, type Q } from "./_harness.ts";

const db = await openDb();

async function mkRoom(q: Q, leader: string, slug: string, visibility = "PUBLIC", status = "RECRUIT", archived = false): Promise<number> {
  const r = await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id, status, archived_at)
                     values ($1, 't', 'i', '2026-10-01', '2026-12-31', 6, $2, 'DIRECT', $3::uuid, $4, case when $5 then now() end) returning id`,
                    [slug, visibility, leader, status, archived]);
  return Number(r[0].id);
}
async function addMember(q: Q, room: number, user: string, status: string) {
  await q("insert into public.room_members (room_id, user_id, role, status) values ($1, $2::uuid, 'MEMBER', $3)", [room, user, status]);
}
const b = async (q: Q, sql: string, params: unknown[]) => (await q(sql, params))[0].v as boolean;

sqlTest("rls: every public table has RLS enabled", withCase(db, async (q) => {
  const off = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assertEquals(off.map((r) => r.relname), []);
}));

sqlTest("rls: no insert/update/delete policies anywhere (writes go through RPC only)", withCase(db, async (q) => {
  const w = await q("select polname from pg_policy where polcmd <> 'r'");
  assertEquals(w.map((r) => r.polname), []);
}));

sqlTest("rls: can_read_room — anon sees public non-draft only", withCase(db, async (q) => {
  const leader = await newUser(q);
  const pubRecruit = await mkRoom(q, leader, "a");
  const pubDraft = await mkRoom(q, leader, "b", "PUBLIC", "DRAFT");
  const priv = await mkRoom(q, leader, "c", "PRIVATE");
  const archived = await mkRoom(q, leader, "d", "PUBLIC", "ACTIVE", true);
  await asAnon(q);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubRecruit]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubDraft]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [priv]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [archived]), false);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubDraft]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [priv]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [archived]), true);
  assertEquals(await b(q, "select public.is_room_leader($1) as v", [priv]), true);
}));

sqlTest("rls: membership states — PENDING reads room but not submissions, INACTIVE reads both", withCase(db, async (q) => {
  const leader = await newUser(q);
  const pending = await newUser(q);
  const inactive = await newUser(q);
  const rejected = await newUser(q);
  const room = await mkRoom(q, leader, "p", "PRIVATE");
  await addMember(q, room, pending, "PENDING");
  await addMember(q, room, inactive, "INACTIVE");
  await addMember(q, room, rejected, "REJECTED");
  await asUser(q, pending);
  assertEquals(await b(q, "select public.is_room_member($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), false);
  await asUser(q, inactive);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), true);
  await asUser(q, rejected);
  assertEquals(await b(q, "select public.is_room_member($1) as v", [room]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), false);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), true);
}));

sqlTest("rls: is_task_assignee ignores released rows; archived node submissions only for leader/author", withCase(db, async (q) => {
  const leader = await newUser(q);
  const a = await newUser(q);
  const other = await newUser(q);
  const room = await mkRoom(q, leader, "t", "PUBLIC", "ACTIVE");
  await addMember(q, room, a, "ACTIVE");
  await addMember(q, room, other, "ACTIVE");
  const node = Number((await q(`insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type)
                                 values ($1, null, 2, 0, '1주차', 'w1', '2026-10-01', '2026-10-07', 'COMMON') returning id`, [room]))[0].id);
  await q("insert into public.task_assignments (node_id, user_id, source) values ($1, $2::uuid, 'COMMON')", [node, a]);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, a]), true);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, other]), false);
  await q("update public.task_assignments set released_at = now() where node_id = $1", [node]);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, a]), false);

  await asUser(q, other);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
  await q("update public.goal_nodes set archived_at = now() where id = $1", [node]);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), false);
  await asUser(q, a);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
}));

sqlTest("rls: public_profiles exposes only id/nickname/avatar_tone", withCase(db, async (q) => {
  const cols = await q("select column_name from information_schema.columns where table_name = 'public_profiles' order by ordinal_position");
  assertEquals(cols.map((c) => c.column_name), ["id", "nickname", "avatar_tone"]);
}));

sqlTest("rls: attachments bucket and storage policies exist", withCase(db, async (q) => {
  const bk = await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'");
  assertEquals(bk.length, 1);
  assertEquals(bk[0].public, false);
  assertEquals(Number(bk[0].file_size_limit), 10485760);
  assert((bk[0].allowed_mime_types as string[]).includes("application/pdf"));
  const pols = await q("select polname from pg_policy where polrelid = 'storage.objects'::regclass order by 1");
  assertEquals(pols.map((p) => p.polname), ["attachments_delete_own", "attachments_insert_assignee", "attachments_select_member"]);
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:db -- --filter "rls:"`
Expected: FAIL — "every public table has RLS enabled" 가 15개 테이블 이름을 돌려주고, `can_read_room` 없음.

- [ ] **Step 3: `supabase/migrations/0003_rls.sql`**

```sql
-- RLS (02-domain-and-schema.md §5, 01-decisions D7). 쓰기는 전부 RPC(SECURITY DEFINER) → INSERT/UPDATE/DELETE 정책 없음 = 거부.
-- 헬퍼는 STABLE SECURITY DEFINER: 정책 안에서 다른 테이블을 보되 그 테이블의 RLS 에 다시 걸리지 않는다.

-- ───────── 헬퍼 ─────────
create or replace function public.is_room_member(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = public.current_user_id() and m.status in ('ACTIVE', 'INACTIVE', 'PENDING'))
$$;

create or replace function public.is_room_leader(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = public.current_user_id())
$$;

-- 공개·비DRAFT·미보관 방은 누구나. 그 외(비공개·DRAFT·보관)는 멤버·그룹장만.
create or replace function public.can_read_room(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room
      and ((r.archived_at is null and r.visibility = 'PUBLIC' and r.status <> 'DRAFT')
           or public.is_room_member(p_room) or public.is_room_leader(p_room)))
$$;

create or replace function public.can_read_submissions(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_room_leader(p_room) or exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = public.current_user_id() and m.status in ('ACTIVE', 'INACTIVE'))
$$;

create or replace function public.is_task_assignee(p_node bigint, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_assignments a where a.node_id = p_node and a.user_id = p_user and a.released_at is null)
$$;

-- 제출물 한 건: 같은 방 ACTIVE·INACTIVE·그룹장이 읽되, 보관 노드는 그룹장·작성자만 (D10)
create or replace function public.can_read_submission(p_node bigint, p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.goal_nodes n
    where n.id = p_node
      and public.can_read_submissions(n.room_id)
      and (n.archived_at is null or public.is_room_leader(n.room_id) or p_author = public.current_user_id()))
$$;

-- ───────── RLS 켜기 ─────────
alter table public.profiles                   enable row level security;
alter table public.rooms                      enable row level security;
alter table public.room_members               enable row level security;
alter table public.room_invites               enable row level security;
alter table public.goal_nodes                 enable row level security;
alter table public.task_assignments           enable row level security;
alter table public.submissions                enable row level security;
alter table public.submission_links           enable row level security;
alter table public.files                      enable row level security;
alter table public.tags                       enable row level security;
alter table public.room_tags                  enable row level security;
alter table public.room_tag_suppressions      enable row level security;
alter table public.notifications              enable row level security;
alter table public.room_notification_settings enable row level security;
alter table public.mail_outbox                enable row level security;   -- 정책 없음 = service_role 만

-- ───────── SELECT 정책 (§5 표) ─────────
create policy profiles_select_self on public.profiles for select
  using (id = (select public.current_user_id()));

create policy rooms_select on public.rooms for select
  using (public.can_read_room(id));

create policy room_members_select on public.room_members for select
  using (public.can_read_room(room_id)
         and (status in ('ACTIVE', 'INACTIVE') or user_id = (select public.current_user_id()) or public.is_room_leader(room_id)));

create policy room_invites_select_leader on public.room_invites for select
  using (public.is_room_leader(room_id));

create policy goal_nodes_select on public.goal_nodes for select
  using (public.can_read_room(room_id));

create policy task_assignments_select on public.task_assignments for select
  using (exists (select 1 from public.goal_nodes n where n.id = node_id and public.can_read_room(n.room_id)));

create policy submissions_select on public.submissions for select
  using (public.can_read_submission(node_id, user_id));

create policy submission_links_select on public.submission_links for select
  using (exists (select 1 from public.submissions s where s.id = submission_id and public.can_read_submission(s.node_id, s.user_id)));

-- 파일: 내 것 / 방 커버(방을 읽을 수 있으면) / 제출 첨부(제출물을 읽을 수 있으면)
create policy files_select on public.files for select
  using (owner_user_id = (select public.current_user_id())
         or (purpose = 'COVER' and room_id is not null and public.can_read_room(room_id))
         or (node_id is not null and public.can_read_submission(node_id, owner_user_id)));

create policy tags_select_all on public.tags for select using (true);

create policy room_tags_select on public.room_tags for select
  using (public.can_read_room(room_id));

create policy room_tag_suppressions_select_leader on public.room_tag_suppressions for select
  using (public.is_room_leader(room_id));

create policy room_notification_settings_select_leader on public.room_notification_settings for select
  using (public.is_room_leader(room_id));

create policy notifications_select_own on public.notifications for select
  using (user_id = (select public.current_user_id()));

-- ───────── 타인 프로필: 이메일 비노출 뷰 ─────────
-- 소유자(postgres) 권한으로 실행되는 뷰 → profiles 의 self 정책을 거치지 않고 세 컬럼만 보여 준다(의도된 security definer 뷰).
create view public.public_profiles as
  select id, nickname, avatar_tone from public.profiles;
grant select on public.public_profiles to anon, authenticated;

-- ───────── Storage 버킷 attachments (D10) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
              'application/zip', 'application/x-zip-compressed', 'text/plain', 'text/markdown'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 경로 {room_id}/{node_id}/{user_id}/{uuid}-{name} — foldername = [room_id, node_id, user_id]
create policy attachments_insert_assignee on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and public.is_task_assignee(((storage.foldername(name))[2])::bigint, (select auth.uid())));

create policy attachments_select_member on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_submissions(((storage.foldername(name))[1])::bigint));

create policy attachments_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[3] = (select auth.uid())::text);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:db`
Expected: 21 + 7 = 28 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_rls.sql supabase/tests/rls-sql.test.ts
git commit -m "feat(db): 0003 RLS 헬퍼·SELECT 정책·public_profiles·attachments 버킷

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 7: `me_get` · `me_update` · `nickname_check` · `meta_get`

**Files:**
- Modify: `supabase/migrations/0002_functions_core.sql`(끝에 추가 — 아직 배포 전)
- Create: `supabase/tests/me-sql.test.ts`

**Interfaces:**
- Consumes: `current_user_id`, `fail`, `kst_today`, `iso`.
- Produces (03-api §1):
  ```sql
  public.nickname_normalize(p_value text) returns text              -- trim → NFC → lower
  public.nickname_problem(p_value text) returns text                -- null | 'invalid' | 'reserved'
  public.meta_get() returns jsonb                                   -- {today, serverTime}
  public.me_get() returns jsonb                                     -- Me + today
  public.me_update(p_nickname text default null, p_optional_mail_enabled boolean default null) returns jsonb  -- Me
  public.nickname_check(p_value text) returns jsonb                 -- {available, reason?}
  ```
  `Me = { id, email, nickname, initial, tone, onboarded, optionalMailEnabled, unreadCount, today }`.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/me-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { asAnon, asUser, expectFail, newUser, openDb, setToday, sqlTest, withCase, type Q } from "./_harness.ts";

const db = await openDb();
const j = async (q: Q, sql: string, params: unknown[] = []) => (await q(sql, params))[0].j as Record<string, unknown>;

sqlTest("meta_get: today from kst_today, serverTime ISO", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  const m = await j(q, "select public.meta_get() as j");
  assertEquals(m.today, "2026-10-12");
  assertEquals(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.serverTime as string), true);
}));

sqlTest("me_get: AUTH_REQUIRED for anon; before onboarding returns nickname null, initial from email", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  await asAnon(q);
  await expectFail(q("select public.me_get()"), "AUTH_REQUIRED");
  const uid = await newUser(q, "chulsoo@example.com");
  await q("update public.profiles set avatar_tone = 'blue' where id = $1::uuid", [uid]);
  await asUser(q, uid);
  const me = await j(q, "select public.me_get() as j");
  assertEquals(me, { id: uid, email: "chulsoo@example.com", nickname: null, initial: "c", tone: "blue",
                     onboarded: false, optionalMailEnabled: true, unreadCount: 0, today: "2026-10-12" });
}));

sqlTest("me_update: sets nickname (onboarding) and mail flag; returns Me (Review Focus 3)", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  const me = await j(q, "select public.me_update(p_nickname => '철수') as j");
  assertEquals(me.nickname, "철수");
  assertEquals(me.initial, "철");
  assertEquals(me.onboarded, true);
  const me2 = await j(q, "select public.me_update(p_optional_mail_enabled => false) as j");
  assertEquals(me2.nickname, "철수");            // 생략한 인자는 그대로
  assertEquals(me2.optionalMailEnabled, false);
  const row = await q("select nickname_normalized as n from public.profiles where id = $1::uuid", [uid]);
  assertEquals(row[0].n, "철수");
}));

sqlTest("me_update: nickname rules — length, charset, spaces", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  for (const bad of ["철", "a", "12345678901234567", "철수!", "chul soo  kim", " 철수", "철수 ", "철\t수", "철수　김", "ㅊㅅ"]) {
    await expectFail(q("select public.me_update(p_nickname => $1)", [bad]), "NICKNAME_INVALID");
  }
  for (const ok of ["철수", "chul_soo.kim", "철수 김", "Ab", "a1"]) {
    const me = await j(q, "select public.me_update(p_nickname => $1) as j", [ok]);
    assertEquals(me.nickname, ok);
  }
}));

sqlTest("me_update: reserved words", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  for (const bad of ["관리자", "admin", "Admin01", "sgtudy", "슥터디 운영"]) {
    await expectFail(q("select public.me_update(p_nickname => $1)", [bad]), "NICKNAME_RESERVED");
  }
}));

sqlTest("me_update: NICKNAME_TAKEN is case- and NFC-insensitive (Review Focus 1)", withCase(db, async (q) => {
  const a = await newUser(q);
  const b = await newUser(q);
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => 'Chulsoo') as j");
  await j(q, "select public.me_update(p_nickname => 'Chulsoo') as j");   // 내 닉네임 재설정은 허용
  await asUser(q, b);
  await expectFail(q("select public.me_update(p_nickname => 'chulsoo')"), "NICKNAME_TAKEN");
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => '철수') as j");         // NFC
  await asUser(q, b);
  const nfd = "철수".normalize("NFD");
  assertEquals(nfd === "철수", false);
  await expectFail(q("select public.me_update(p_nickname => $1)", [nfd]), "NICKNAME_TAKEN");
}));

sqlTest("nickname_check: available / taken / invalid / reserved; own nickname counts as available", withCase(db, async (q) => {
  const a = await newUser(q);
  const b = await newUser(q);
  await asAnon(q);
  await expectFail(q("select public.nickname_check('x')"), "AUTH_REQUIRED");
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => '민수') as j");
  assertEquals(await j(q, "select public.nickname_check('민수') as j"), { available: true });
  await asUser(q, b);
  assertEquals(await j(q, "select public.nickname_check('민수') as j"), { available: false, reason: "taken" });
  assertEquals(await j(q, "select public.nickname_check('지은') as j"), { available: true });
  assertEquals(await j(q, "select public.nickname_check('지') as j"), { available: false, reason: "invalid" });
  assertEquals(await j(q, "select public.nickname_check('admin') as j"), { available: false, reason: "reserved" });
}));

sqlTest("me_get: unreadCount counts unread notifications only", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.notifications (user_id, kind, title, link, read_at)
           values ($1::uuid, 'ROOM_STARTED', 't', '/rooms/a', null), ($1::uuid, 'ROOM_ENDED', 't', '/rooms/a', now())`, [uid]);
  await asUser(q, uid);
  assertEquals((await j(q, "select public.me_get() as j")).unreadCount, 1);
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:db -- --filter "me_get"`
Expected: FAIL — `function public.me_get() does not exist`.

- [ ] **Step 3: `0002_functions_core.sql` 끝에 추가**

```sql
-- ───────── 닉네임 (03-api §1) ─────────
-- 2~16자, 한글 음절·영문·숫자·'_'·'.'·단일 공백(앞뒤 불가). 정규화 = trim → NFC → lower, UNIQUE 는 정규화값.
create or replace function public.nickname_normalize(p_value text)
returns text language sql immutable as $$
  select lower(normalize(btrim(p_value), NFC))
$$;

create or replace function public.nickname_problem(p_value text)
returns text language plpgsql immutable as $$
declare
  v text := normalize(coalesce(p_value, ''), NFC);
  v_norm text;
  v_reserved constant text[] := array['관리자', 'admin', 'sgtudy', '슥터디'];
  w text;
begin
  -- 앞뒤 공백·탭·전각 공백·제어문자는 그대로 거부(사용자가 보낸 문자열 그대로 검사)
  if v <> btrim(v) or char_length(v) < 2 or char_length(v) > 16 then return 'invalid'; end if;
  if v !~ '^[가-힣A-Za-z0-9._]+( [가-힣A-Za-z0-9._]+)*$' then return 'invalid'; end if;
  v_norm := public.nickname_normalize(v);
  foreach w in array v_reserved loop
    if position(w in v_norm) > 0 then return 'reserved'; end if;
  end loop;
  return null;
end $$;

-- ───────── 메타 ─────────
create or replace function public.meta_get()
returns jsonb language sql stable as $$
  select jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'serverTime', public.iso(now()))
$$;

-- ───────── 나 ─────────
-- 온보딩 전에도 호출 가능(require_user 아님). initial = 닉네임 첫 글자, 없으면 이메일 첫 글자.
create or replace function public.me_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v jsonb;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select jsonb_build_object(
           'id', p.id::text,
           'email', p.email::text,
           'nickname', p.nickname,
           'initial', left(coalesce(p.nickname, p.email::text), 1),
           'tone', p.avatar_tone,
           'onboarded', p.nickname is not null,
           'optionalMailEnabled', p.optional_mail_enabled,
           'unreadCount', (select count(*)::int from public.notifications n where n.user_id = p.id and n.read_at is null),
           'today', to_char(public.kst_today(), 'YYYY-MM-DD'))
    into v
  from public.profiles p where p.id = v_uid;
  if v is null then perform public.fail('NOT_FOUND', '프로필이 없어요'); end if;
  return v;
end $$;

create or replace function public.me_update(p_nickname text default null, p_optional_mail_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_problem text;
  v_nick text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  if p_nickname is not null then
    v_problem := public.nickname_problem(p_nickname);
    if v_problem = 'invalid' then
      perform public.fail('NICKNAME_INVALID', '닉네임은 2~16자, 한글·영문·숫자·_·.·공백만 쓸 수 있어요', '{"field":"nickname"}'::jsonb);
    elsif v_problem = 'reserved' then
      perform public.fail('NICKNAME_RESERVED', '사용할 수 없는 닉네임이에요', '{"field":"nickname"}'::jsonb);
    end if;
    v_nick := normalize(btrim(p_nickname), NFC);
    begin
      update public.profiles
         set nickname = v_nick, nickname_normalized = public.nickname_normalize(v_nick)
       where id = v_uid;
    exception when unique_violation then
      perform public.fail('NICKNAME_TAKEN', '이미 쓰고 있는 닉네임이에요', '{"field":"nickname"}'::jsonb);
    end;
  end if;
  if p_optional_mail_enabled is not null then
    update public.profiles set optional_mail_enabled = p_optional_mail_enabled where id = v_uid;
  end if;
  return public.me_get();
end $$;

create or replace function public.nickname_check(p_value text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_problem text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  v_problem := public.nickname_problem(p_value);
  if v_problem is not null then return jsonb_build_object('available', false, 'reason', v_problem); end if;
  if exists (select 1 from public.profiles p
             where p.nickname_normalized = public.nickname_normalize(p_value) and p.id <> v_uid) then
    return jsonb_build_object('available', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('available', true);
end $$;
```

주의: `me_get` 의 `NOT_FOUND` 는 §0 목록에 있는 코드다(404). `profiles` 행은 `auth.users` 트리거가 항상 만들므로 실제로는 닿지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:db`
Expected: 28 + 8 = 36 passed. `normalize()` 가 PGlite 에서 "database encoding is not UTF8" 류 오류를 내면 `openDb()` 의 PGlite 생성 옵션을 확인한다(기본 UTF8 이라 정상이면 안 난다).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_functions_core.sql supabase/tests/me-sql.test.ts
git commit -m "feat(db): me_get·me_update·nickname_check·meta_get

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 8: `seed.sql` §1 사용자 (29명, 고정 UUID, NAME_TONE)

**Files:**
- Modify: `supabase/seed.sql`
- Create: `supabase/tests/seed-sql.test.ts`

**Interfaces:**
- Produces: `auth.users`/`auth.identities`/`profiles` 29행. UUID 규칙 `00000000-0000-4000-8000-0000000000NN`(NN = 2자리 번호). 이메일 `<romanized>@sgtudy.local`. Phase 2~ 시드는 `(select id from public.profiles where nickname = '민수')` 로 사람을 찾는다. 임시 테이블 `seed_users(n, email_local, nickname, tone)` 은 같은 세션(= 같은 `db reset`) 안에서 뒤 섹션이 재사용할 수 있다.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/seed-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();
await applySeed(db);

// src/lib/palette.ts NAME_TONE 과 동일해야 한다
const NAME_TONE: Record<string, string> = {
  철수: "blue", 민수: "mint", 서연: "blue", 지훈: "lav", 현우: "slate", 수민: "peach", 예린: "amber", 태호: "blue", 가은: "amber",
  민재: "mint", 보람: "mint", 도현: "mint", 하은: "mint", 시우: "mint",
  지은: "peach", 소율: "peach", 지성: "peach", 은지: "peach",
  하나: "lav", 다은: "lav", 태윤: "lav", 나연: "lav", 다인: "lav",
  도윤: "slate",
  아린: "amber", 유진: "amber", 준서: "amber", 현준: "amber",
  승호: "blue",
};

sqlTest("seed: 29 users with palette tones and fixed uuids", withCase(db, async (q) => {
  const rows = await q("select id::text as id, nickname, avatar_tone, email::text as email, nickname_normalized from public.profiles where email like '%@sgtudy.local' order by id");
  assertEquals(rows.length, 29);
  for (const r of rows) {
    assertEquals(r.avatar_tone, NAME_TONE[r.nickname as string], `tone of ${r.nickname}`);
    assertEquals(/^00000000-0000-4000-8000-0000000000\d{2}$/.test(r.id as string), true, r.id as string);
    assertEquals(r.nickname_normalized, r.nickname);
  }
  assertEquals(Object.keys(NAME_TONE).length, 29);
}));

sqlTest("seed: 철수 is user 01, 민수 is user 02, identities exist", withCase(db, async (q) => {
  const c = await q("select nickname from public.profiles where id = '00000000-0000-4000-8000-000000000001'");
  assertEquals(c[0].nickname, "철수");
  const m = await q("select nickname from public.profiles where id = '00000000-0000-4000-8000-000000000002'");
  assertEquals(m[0].nickname, "민수");
  const idn = await q("select count(*)::int as n from auth.identities i join public.profiles p on p.id = i.user_id where p.email like '%@sgtudy.local'");
  assertEquals(idn[0].n, 29);
}));

sqlTest("seed: is idempotent", withCase(db, async (q) => {
  await applySeed(db);
  const n = await q("select count(*)::int as n from public.profiles where email like '%@sgtudy.local'");
  assertEquals(n[0].n, 29);
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:db -- --filter "seed:"`
Expected: FAIL — `rows.length` 0.

- [ ] **Step 3: `supabase/seed.sql` 에 §1 추가**

헤더 주석 아래에 붙인다.

```sql
-- ═══════════ §1 사용자 (plan 01) ═══════════
-- 목업 등장 인물 전원. avatar_tone = src/lib/palette.ts NAME_TONE. uuid = 00000000-0000-4000-8000-0000000000NN.
-- 로컬 전용: auth.users 직접 INSERT(비밀번호 없음 — 로컬 로그인은 OTP/Inbucket). 호스팅에는 절대 돌리지 않는다.
create temp table if not exists seed_users (n int primary key, email_local text, nickname text, tone text);
insert into seed_users (n, email_local, nickname, tone) values
  ( 1, 'cheolsu',  '철수', 'blue'),
  ( 2, 'minsu',    '민수', 'mint'),
  ( 3, 'seoyeon',  '서연', 'blue'),
  ( 4, 'jihun',    '지훈', 'lav'),
  ( 5, 'hyeonu',   '현우', 'slate'),
  ( 6, 'sumin',    '수민', 'peach'),
  ( 7, 'yerin',    '예린', 'amber'),
  ( 8, 'taeho',    '태호', 'blue'),
  ( 9, 'gaeun',    '가은', 'amber'),
  (10, 'minjae',   '민재', 'mint'),
  (11, 'boram',    '보람', 'mint'),
  (12, 'dohyeon',  '도현', 'mint'),
  (13, 'haeun',    '하은', 'mint'),
  (14, 'siu',      '시우', 'mint'),
  (15, 'jieun',    '지은', 'peach'),
  (16, 'soyul',    '소율', 'peach'),
  (17, 'jiseong',  '지성', 'peach'),
  (18, 'eunji',    '은지', 'peach'),
  (19, 'hana',     '하나', 'lav'),
  (20, 'daeun',    '다은', 'lav'),
  (21, 'taeyun',   '태윤', 'lav'),
  (22, 'nayeon',   '나연', 'lav'),
  (23, 'dain',     '다인', 'lav'),
  (24, 'doyun',    '도윤', 'slate'),
  (25, 'arin',     '아린', 'amber'),
  (26, 'yujin',    '유진', 'amber'),
  (27, 'junseo',   '준서', 'amber'),
  (28, 'hyeonjun', '현준', 'amber'),
  (29, 'seungho',  '승호', 'blue')
on conflict (n) do nothing;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email_local || '@sgtudy.local', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', '', '', '', ''
from seed_users
on conflict (id) do nothing;

-- GoTrue 가 이메일 로그인에 요구하는 identity 행
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%@sgtudy.local'
on conflict (provider_id, provider) do nothing;

-- 트리거가 만든 profiles 에 닉네임·tone 지정
update public.profiles p
   set nickname = s.nickname,
       nickname_normalized = public.nickname_normalize(s.nickname),
       avatar_tone = s.tone
  from seed_users s
 where p.id = ('00000000-0000-4000-8000-' || lpad(s.n::text, 12, '0'))::uuid;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:db`
Expected: 36 + 3 = 39 passed.

- [ ] **Step 5: 로컬 Supabase 에서 `db reset` 실측**

Run:
```bash
vm_stat | grep -E 'free|compressor'
supabase start
npm run db:reset
psql "$(supabase status -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["DB_URL"])')" -c "select count(*) from public.profiles where email like '%@sgtudy.local';"
```
Expected: `supabase start` 성공(Postgres 15), reset 로그에 `0001_schema.sql`, `0002_functions_core.sql`, `0003_rls.sql` 적용 + `Seeding data from supabase/seed.sql`, count = 29. `psql` 이 없으면 Studio(http://127.0.0.1:54323) Table Editor 로 확인. `status -o json` 키 이름이 다르면 `supabase status` 출력의 DB URL 을 그대로 쓴다.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed.sql supabase/tests/seed-sql.test.ts
git commit -m "feat(db): 시드 §1 사용자 29명

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 9: 로컬 Supabase RLS·RPC 스모크 (`auth-db.test.ts`) · 타입 생성

**Files:**
- Create: `supabase/tests/auth-db.test.ts`, `src/lib/supabase/database.types.ts`(generated)

**Interfaces:**
- Consumes: `_testenv.ts`(`dbTest`, `anon`, `userClient`, `RUN`), 0003 정책, `me_*`.
- Produces: `database.types.ts`(Phase 7 어댑터가 `createServerClient<Database>` 로 쓴다).

- [ ] **Step 1: 테스트 `supabase/tests/auth-db.test.ts`**

```ts
import { assert, assertEquals } from "@std/assert";
import { anon, dbTest, RUN, userClient } from "./_testenv.ts";

// 실제 Postgres + GoTrue + PostgREST 에서만 보이는 것: RLS 차단, anon/authenticated 역할, RPC 에러 전달 형식.
// 시드 행은 읽기만. 쓰기는 테스트 사용자 자신의 profiles 행뿐.

dbTest("anon cannot read profiles (emails hidden), but sees public_profiles without email", async () => {
  const a = anon();
  const { data: p, error: e1 } = await a.from("profiles").select("id, email");
  assertEquals(e1, null);
  assertEquals(p, []);
  const { data: pub, error: e2 } = await a.from("public_profiles").select("*").limit(5);
  assertEquals(e2, null);
  assert(pub!.length > 0, "seeded public profiles visible");
  assertEquals("email" in pub![0], false);
});

dbTest("anon rpc me_get fails with AUTH_REQUIRED carried in error.message", async () => {
  const { error } = await anon().rpc("me_get");
  assertEquals(error?.message, "AUTH_REQUIRED");
  assertEquals(error?.details, "로그인이 필요해요");
});

dbTest("authenticated user reads only own profile row with email", async () => {
  const { u, c } = await userClient(1);
  const { data, error } = await c.from("profiles").select("id, email");
  assertEquals(error, null);
  assertEquals(data!.map((r) => r.id), [u.id]);
  assertEquals(data![0].email, u.email);
});

dbTest("direct insert into rooms is rejected by RLS even when authenticated", async () => {
  const { u, c } = await userClient(1);
  const { error } = await c.from("rooms").insert({
    slug: "rls-" + RUN, title: "t", intro: "i", start_date: "2026-10-01", end_date: "2026-12-31",
    max_members: 6, visibility: "PUBLIC", join_mode: "DIRECT", leader_id: u.id,
  });
  assert(error !== null, "insert must fail");
  assertEquals(error!.code, "42501");   // insufficient_privilege (RLS)
});

dbTest("me_update sets a nickname; nickname_check reports taken for another user; PostgREST hint carries json", async () => {
  const nick = "tester " + RUN;
  const { c: c1 } = await userClient(1);
  const { data: me, error } = await c1.rpc("me_update", { p_nickname: nick });
  assertEquals(error, null);
  assertEquals(me.nickname, nick);
  assertEquals(me.onboarded, true);

  const { c: c2 } = await userClient(2);
  const { data: chk } = await c2.rpc("nickname_check", { p_value: nick.toUpperCase() });
  assertEquals(chk, { available: false, reason: "taken" });
  const { error: taken } = await c2.rpc("me_update", { p_nickname: nick });
  assertEquals(taken?.message, "NICKNAME_TAKEN");
  assertEquals(JSON.parse(taken!.hint!), { field: "nickname" });
});

dbTest("meta_get is callable by anon and returns KST today", async () => {
  const { data, error } = await anon().rpc("meta_get");
  assertEquals(error, null);
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(data.today), true);
});
```

- [ ] **Step 2: 환경변수 없이 실행 — skip 확인**

Run: `npm run test:db`
Expected: 39 passed, 6 ignored(`db:` 접두 테스트).

- [ ] **Step 3: 로컬 supabase 로 실행**

Run:
```bash
vm_stat | grep -E 'free|compressor'
supabase status >/dev/null || supabase start
eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
npm run test:db
```
Expected: 45 passed, 0 ignored. `status -o env` 가 `ANON_KEY`/`SERVICE_ROLE_KEY` 대신 `PUBLISHABLE_KEY`/`SECRET_KEY` 를 내면 그 값을 같은 변수에 넣는다(supabase-js 는 둘 다 받는다).

문제가 나면:
- `42501` 대신 다른 코드 → 0003 의 `enable row level security` 누락 테이블 확인.
- `anon` 의 `profiles` select 가 권한 오류(`42501`) → Supabase 기본 권한(테이블 GRANT)이 빠진 환경. `grant select on all tables in schema public to anon, authenticated;` 를 0003 끝에 추가하고 다시 reset.

- [ ] **Step 4: 타입 생성**

Run: `npm run db:types && head -5 src/lib/supabase/database.types.ts && npx tsc --noEmit`
Expected: `export type Json = …` 로 시작하는 파일, tsc 오류 0. 이 파일은 커밋한다(Vercel 빌드는 로컬 supabase 가 없다).

- [ ] **Step 5: 전체 게이트**

Run: `npm run test:db && npm test && npm run lint && npx tsc --noEmit`
Expected: 전부 통과.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/auth-db.test.ts src/lib/supabase/database.types.ts
git commit -m "test(db): 로컬 supabase RLS·me_* 스모크, database.types 생성

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 종료 게이트

- [ ] `npm run test:db`(PGlite 39 + db 6) · `npm test` · `npm run lint` · `npx tsc --noEmit` 전부 통과.
- [ ] `supabase db reset` 이 0001→0002→0003→seed 순으로 깨끗이 적용.
- [ ] 호스팅 프로젝트가 있으면 `supabase link` 후 `supabase db push` — `0001` 의 `auth.users` 트리거와 `0003` 의 `storage.objects` 정책이 `postgres` 역할로 생성되는지 확인(둘 다 Supabase 가 허용하는 표준 패턴). 대시보드 Auth 설정(OTP 6자리·600초·60초, Redirect URL `https://sgtudy.vercel.app/**`) 은 수동.
- [ ] 다음 계획(`…-02-rooms-membership.md`)에 넘기는 것: `rooms` 쓰기 RPC 는 `require_user()` 로 시작하고 `slugify()` 충돌 시 `-2` 접미를 붙인다. 내부 전용 함수(`assignment_resync`, `notify_publish`, `room_transition_*`)는 만들 때 `revoke execute on function … from anon, authenticated;` 를 같이 건다(PostgREST 는 public 함수 전부를 RPC 로 노출한다. 이 계획의 0002·0003 함수는 순수·읽기 전용이라 노출돼도 무해).

## Self-Review 메모

- 스펙 커버리지: 02 §2(Task 4 원문), §5 전 행(Task 6: profiles/rooms/room_members/room_invites/goal_nodes/task_assignments/submissions/submission_links/files/tags/room_tags/suppressions/settings/notifications/mail_outbox + Storage 3정책 + 버킷), §6 공통 행과 상태 함수(Task 5), 트리거 4종(0001 profiles, I9, updated_at, 0002 이메일 동기화 추가), §8 사용자 행(Task 8), 03 §0 에러 형식(`fail`, Task 9 가 PostgREST 전달 확인), §1 전 RPC(Task 7), D6 세션·보호 라우트·returnTo(Task 3). 미포함(의도): `last_login_at` 갱신 — 스펙에 쓰기 경로가 없어 Phase 7 로그인 콜백에서 결정.
- 이름 일치: `current_user_id`, `require_user`, `kst_today`, `kst_deadline`, `fail`, `iso`, `task_code`, `leaf_state`, `pct`, `person_json`, `slugify`, `is_room_member`, `is_room_leader`, `can_read_room`, `can_read_submissions`, `is_task_assignee` — 개요 공통 계약과 동일. 추가 헬퍼 `can_read_submission`, `nickname_normalize`, `nickname_problem`, `set_updated_at`, `submissions_guard_immutable` 은 이 문서가 정의.
- Review Focus 5건 전부 소유 태스크 테스트에 박음(1→Task 7, 2→Task 3, 3→Task 5·7, 4→Task 5, 5→Task 5).
