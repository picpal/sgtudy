# 「AI에게 물어보기」(선택 용어 해설) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 스터디 화면의 읽기 콘텐츠에서 글자를 선택하면(데스크톱 드래그·모바일 꾹 누름) 「AI에게 물어보기」 알약이 뜨고, 누르면 시트에 **이 방 주제 관점**의 해설(한 줄 요약·이 스터디에서는·시험/실무 포인트·관련 용어)이 뜬다. 방 단위 캐시와 kind `term_explain` 상한으로 비용을 막고, 시험 응시 중엔 UI·서버 모두 막는다.

**Architecture:** DB = `0052_ai_explain.sql`(추가형: `ai_explain_cache` 표 + `ai_usage.kind` 제약 확장 + `ai_limits`·`ai_turn_check` 재정의 + RPC `ai_explain_begin`·`ai_explain_done`). 서버 = `src/lib/ai/explain/*`(schema·normalize·sanitize·prompt·explain·mock, 순수) + `client.ts` 의 `openaiCallExplain` + 라우트 `src/app/api/rooms/explain/route.ts`(인터뷰 라우트와 같은 경계 순서). 클라이언트 = `src/components/ask-ai/*`(순수 `selection.ts` → 훅 `useAskAiSelection` → `AskAiPill`·`AskAiSheet` → `AskAiProvider`) 를 `MyStudyScreen` 이 감싸고, 허용 컨테이너 7곳에 `data-ask-ai` 속성만 붙인다.

**Tech Stack:** Next.js 16.4.2(App Router, Route Handler — 코드 전에 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`·`02-route-segment-config` 를 읽는다) · React 19 · Tailwind v4 · `openai@7.30.1` Responses API + `zodTextFormat`(strict) · `zod@4` · Supabase PG17(plpgsql `security definer set search_path=''`, `public.fail`) · vitest(`src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-27-ask-ai-term-explain-design.md` (D1~D21 권장안). 결정이 바뀌면 스펙 맨 끝에 "결정에 따른 변경" 표를 더한다.

## 번호 (중요)

- 마이그레이션 번호는 **0052** 고정. **0051 은 「오답노트 다시 볼 문제(★)」가 쓴다**(파일이 아직 없어도 0052 를 쓴다). `0052_*` 가 이미 있으면 멈추고 컨트롤러와 번호를 다시 정한다.
- 호출만 하는 기존 함수(복사·재정의 금지): `require_user()` · `app_now()` · `kst_today()` · `room_readable(room_id, uid)` · `room_current_round_id(room_id, date)` · `ai_turn_check(text, boolean)`(내부 호출 — 0052 가 재정의한 뒤) · `ai_turn_done(bigint,int,int,int,text)` · `fail(code, text, jsonb)`.
- 재정의하는 함수(0049 의 본문에서 출발): `ai_limits()` · `ai_turn_check(text, boolean)`. 시그니처 동일 → 0047 의 GRANT 가 유지된다(재선언 없음).

## Global Constraints

- 마이그레이션은 **`supabase/migrations/0052_ai_explain.sql` 하나**. 0001~0051 수정 금지. 머리 주석에 날짜·스펙 경로·"배포 후 수정 금지".
- 새 plpgsql 함수: `security definer set search_path = ''`, 객체는 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. 공개 RPC 2개(`ai_explain_begin`·`ai_explain_done`)만 `grant execute … to authenticated`. 표는 `enable row level security` + `revoke all … from anon, authenticated`. `api_invoke` 허용 목록(MCP)에 넣지 않는다.
- 상수(스펙 D2·D7·D10·D13·D14, 서버·클라이언트 같은 값): `TERM_MAX=40`(cp) · `CONTEXT_MAX=300`(cp) · `REQ_TERM_MAX=200` · `REQ_CONTEXT_MAX=1200` · `MAX_EXPLAIN_BODY=16*1024` · `ONE_LINER_MAX=120` · `IN_CONTEXT_MAX=600` · `POINTS_MAX=4`·`POINT_MAX=120` · `RELATED_MAX=4`·`RELATED_ITEM_MAX=30` · `max_output_tokens 1500` · `timeout 25_000`·`maxRetries 0` · `maxDuration 30` · 캐시 TTL `interval '30 days'` · 한도 `explainPerTenMin 10 · explainPerDay 60 · explainGlobalPerDay 2000` · 디바운스 `250`ms · 모바일 MQ `"(width < 40rem)"`.
- **모델 입력에 시험 데이터(문항·보기·정답·해설)를 서버가 넣지 않는다.** 방 메타는 RPC 가 돌려준 값만, 그 외는 클라이언트 `term`·`context`(상한 적용) 뿐. 전부 `escapeData`.
- system 프롬프트는 상수 문자열 하나(요청 사이 바이트 동일), `prompt_cache_key: "sgtudy-term-explain"`.
- 로그에 선택 텍스트·문맥·사용자 id 를 남기지 않는다(`{evt:"ai_explain", hit, ms, in, out, cached, model, status}` 만). 캐시 행에 문맥 없음.
- 스크롤 리스너로 위치를 다시 계산하지 않는다(ed3a2a5). `scroll` 은 `{capture:true, passive:true, once:true}` 로 **숨기기만**. 선택 감지는 `selectionchange` 250ms 디바운스 + `keyup`.
- 입력 요소·`[contenteditable]`·`pre`·`code`·`button`·`[data-ask-ai="off"]` 안의 선택은 무시한다. `ExamQuestionView` `take` 모드는 반드시 `data-ask-ai="off"`.
- 문구는 스펙 §6 그대로(해요체). 버튼 ≥ 44px. 입력 요소 없음(16px 규칙 해당 없음). 색은 토큰만(`text-ink`·`text-ink-2`·`text-ink-3`·`text-muted`·`bg-surface`·`bg-surface-2`·`border-line-2`·`bg-line-3`·`text-mint`·`bg-mint-soft`·`text-warn`·`bg-bg`).
- Supabase 는 `src/lib/api/*` 에서만 import(이 기능은 라우트가 서버 `createClient()` 를 쓰고, 클라이언트는 `fetch("/api/rooms/explain")` 만). 새 npm 의존성 금지. 해시는 Node `crypto.createHash("sha256")`(서버 전용 파일).
- 건드리지 않는 파일: `MarkdownView.tsx`·`markdown.ts`·`ExamSection.tsx`·`ExamNav.tsx`·`client.ts` 의 기존 export(추가만). `MyStudyScreen.tsx` 는 Provider 로 감싸는 줄과 prop 하나만.
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나. dev 서버는 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`). 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지. 서브에이전트 금지(각 작업자 스스로).
- 호스티드 Supabase·Vercel 은 건드리지 않는다(`supabase db push` 는 사용자 승인 후 사용자가). 로컬 확인은 `AI_INTERVIEW_MOCK=1`(모델 없이 대본).
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL 작업은 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만(`.context/`·`.superpowers/`·`AGENTS.md`·`docs/00-initial-planning.md` 금지, amend 금지). 메시지 끝:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UjLaGDGYVB1bEty3hcNf6n
  ```
- 줄 번호는 작성 시점 기준 — 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. **응시 중 거부** — 이 방에 내 `exam_attempts.status='IN_PROGRESS'` 행(시험 `published`, `kst_today() <= end_date`)이 있으면 `ai_explain_begin` 이 `EXAM_IN_PROGRESS`; 제출(`SUBMITTED`)하거나 마감이 지나면 통과. 캐시 적중이어도 거부가 먼저다. → Task 1.
2. **캐시 적중은 상한을 안 쓴다** — 적중 시 `ai_usage` 행이 늘지 않고 `hits` 만 +1; 31일 지난 행은 미스(새 `ai_usage` 행). → Task 1.
3. **인터뷰 창 불변** — `term_explain` 행 29개가 있어도 `ai_turn_check('room_interview')` 의 10분·하루 카운트는 0. 반대로 인터뷰 행은 `explainPerDay` 에 안 센다. → Task 1.
4. **40cp 경계** — 선택 41cp 는 알약 없음, 40cp 는 있음(이모지·한글 조합은 코드 포인트로). 서버도 `normTerm` 뒤 41cp → 400. 선택이 두 컨테이너에 걸치면 없음. → Task 2·5.
5. **take 모드 off** — `ExamQuestionView mode="take"` 의 `<li>` 가 `data-ask-ai="off"`, `result` 는 `"exam"`; off 안 선택은 알약 없음. → Task 5·8.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 번호·트리** — `ls supabase/migrations | tail -3` 에 `0052_*` 가 없음을 확인(0051 이 있어도 무관). `git status --short` 가 `.context/`·`docs/00-initial-planning.md` 외 비어 있음.
- [ ] **Step 2: Next 문서** — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` 와 `02-route-segment-config/` 의 `maxDuration`·`runtime` 항목을 읽고, 기존 `src/app/api/rooms/rounds/route.ts` 가 같은 모양인지 확인(차이가 있으면 문서를 따른다).
- [ ] **Step 3: 기준 테스트** — `npx vitest run` PASS, `npm run test:db` PASS 를 기록(이후 회귀 비교).

---

### Task 1: 0052 마이그레이션 — kind `term_explain` · 캐시 · `ai_explain_begin/done` (opus)

**Files:**
- Create: `supabase/migrations/0052_ai_explain.sql`
- Test: `supabase/tests/ai-explain-sql.test.ts`

**Interfaces:**
- Consumes: 0047/0049 의 `ai_usage`·`ai_limits`·`ai_turn_check`·`ai_turn_done`; 0004 `room_readable`·`room_current_round_id`; 0037 `exam_attempts`·`exams(status, reveal)`·`goal_nodes(end_date)`; `room_get`(0004:799~) 의 태그 조인 select.
- Produces:
  - `public.ai_explain_begin(p_slug text, p_term_key text) returns jsonb` — 적중 `{"hit":true,"body":<jsonb>}` / 미스 `{"hit":false,"id":<bigint>,"room":{"title","intro","description","tags":[text],"round":{"label","title","goal"}|null}}`. `description` = `left(description_md, 600)`, `round.goal` = 현재 회차 루트 노드 설명 `left(…, 300)`(컬럼명은 `goal_nodes` 정의에서 확인), `tags` = 라벨 배열.
  - `public.ai_explain_done(p_id bigint, p_slug text, p_term_key text, p_norm_term text, p_body jsonb, p_in int, p_out int, p_cached int, p_model text) returns void`.
  - `ai_limits()` 에 `explainPerTenMin:10, explainPerDay:60, explainGlobalPerDay:2000` 추가(기존 키 유지).
  - 실패 코드: `ROOM_NOT_FOUND`(읽을 수 없는 방) · `NOT_MEMBER`(읽을 순 있으나 그룹장·ACTIVE·INACTIVE 아님, PENDING 포함) · `EXAM_IN_PROGRESS` · `VALIDATION_FAILED`(`p_term_key !~ '^[0-9a-f]{64}$'`) · `RATE_LIMITED`(details `{retryAfterSec, window: 'explainTenMin'|'explain'}`) · `AI_BUDGET_EXCEEDED`.

- [ ] **Step 1: 실패 테스트 작성** — `supabase/tests/ai-explain-sql.test.ts`(`ai-rounds-usage-sql.test.ts` 와 같은 틀: `openDb/applySeed/cases/one/setNow/uidOf/expectFail`). 그룹: 
  - "schema & grants": `ai_explain_cache` 에 anon/authenticated `select/insert/update/delete` 전부 false, `relrowsecurity` true, `ai_explain_begin(text,text)`·`ai_explain_done(bigint,text,text,text,jsonb,integer,integer,integer,text)` authenticated true / anon false, `ai_usage_kind_check` 가 `'term_explain'` insert 를 허용.
  - "begin: 권한": anon → `AUTH_REQUIRED`; 비멤버가 비공개 방 → `ROOM_NOT_FOUND`; PENDING → `NOT_MEMBER`; INACTIVE 멤버 → 통과(`hit=false`, `room.title` = 방 제목, `room.tags` 배열, `room.round` 가 오늘(`app.today`) 회차와 일치).
  - "begin: 미스→done→적중": 미스 응답 `id` 로 `ai_explain_done(id, slug, key, 'cidr 블록', '{"kind":"term","term":"CIDR 블록","oneLiner":"…","inContext":"…","points":[],"related":[]}', 500,450,700,'gpt-6-luna')` → 다시 `begin` → `hit=true`·`body.term='CIDR 블록'`, `ai_usage` 행 수 그대로(=1), `hits=1`; `setNow` +31일 → `hit=false`·`ai_usage` 2행; `kind:"not_term"` body 는 `done` 뒤에도 적중 없음.
  - "begin: 상한": `fill`(kind `term_explain`) 10건/10분 → `RATE_LIMITED window=explainTenMin`; 60건/하루 → `window=explain`; 전체 2000 → `AI_BUDGET_EXCEEDED`; **term_explain 행 59건이 있어도 `ai_turn_check('room_interview', false)` 통과**, 인터뷰 행 119건이 있어도 `begin` 통과.
  - "begin: 응시 중": `round-exam-sql.test.ts` 의 `newExamLeaf`·`put`·publish 방식으로 시험을 만들고 `exam_answer_save` 로 IN_PROGRESS 행 → `EXAM_IN_PROGRESS`(캐시 행을 미리 넣어도 같다); `exam_submit` 뒤 통과; 다른 케이스로 `setToday` 를 end_date 다음 날로 → 통과.
  - "done: 남의 id" — 다른 사용자가 `done` 호출 → 조용히 0행(캐시 없음, usage 토큰 null).
- [ ] **Step 2: 실패 확인** — `npm run test:db -- --filter ai-explain` → 함수 없음으로 FAIL.
- [ ] **Step 3: 마이그레이션 작성** — 절 순서 `1 스키마(제약 교체·표·인덱스 `(room_id, created_at)`) · 2 ai_limits · 3 ai_turn_check(0049 본문 복사 + `term_explain` 분기: 공통 v_m/v_d 집계에 `and u.kind <> 'term_explain'`, 분기에서 내 10분·하루·전체 explain 카운트) · 4 ai_explain_begin · 5 ai_explain_done · 6 GRANT`. `begin` 순서: require_user → 방 조회(`slug`) → `room_readable` 거짓이면 ROOM_NOT_FOUND → 멤버 판정 → 응시 중 판정 → 캐시 조회(TTL) → 적중이면 `update hits` 후 반환 → `public.ai_turn_check('term_explain', false)` → 방 메타 jsonb. `done`: `ai_turn_done` 호출 → 멤버 재확인 → `p_body->>'kind' = 'term'` 일 때만 `insert … on conflict (room_id, term_key) do update set body, model, created_at = app_now(), hits = 0`.
- [ ] **Step 4: 통과 확인** — `npm run test:db` 전체 PASS(기존 `ai-usage`·`ai-rounds-usage` 포함 — 재정의가 옛 동작을 깨지 않았는지).
- [ ] **Step 5: Commit** — `git commit -- supabase/migrations/0052_ai_explain.sql supabase/tests/ai-explain-sql.test.ts -m "feat(db): 0052 AI 용어 해설 — term_explain 상한·방별 캐시·ai_explain_begin/done"`

---

### Task 2: 순수 모듈 — 스키마·정규화·정제 (sonnet)

**Files:**
- Create: `src/lib/ai/explain/schema.ts`, `src/lib/ai/explain/normalize.ts`, `src/lib/ai/explain/sanitize.ts`
- Test: `src/lib/ai/explain/normalize.test.ts`, `src/lib/ai/explain/sanitize.test.ts`, `src/lib/ai/explain/schema.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `SOURCES = ["node","room","notice","submission","exam","wrong"] as const`, `Source`, `ExplainRequest = z.object({ slug: z.string().min(1).max(60), term: z.string().min(1).max(200), source: z.enum(SOURCES), context: z.string().max(1200) })`, `ExplainOut = z.object({ kind: z.enum(["term","not_term"]), term: z.string(), oneLiner: z.string(), inContext: z.string(), points: z.array(z.string()), related: z.array(z.string()) })`(strict, Structured Outputs 용 — optional 없음), `type ExplainOut`, `ExplainResponse = { hit: boolean; body: ExplainOut }`, `RoomMeta = { title: string; intro: string; description: string; tags: string[]; round: { label: string; title: string; goal: string } | null }`, 상수 `TERM_MAX=40 · CONTEXT_MAX=300 · ONE_LINER_MAX=120 · IN_CONTEXT_MAX=600 · POINTS_MAX=4 · POINT_MAX=120 · RELATED_MAX=4 · RELATED_ITEM_MAX=30 · MAX_EXPLAIN_BODY=16*1024`.
- Produces (`normalize.ts`, **클라이언트에서도 import 가능 — `server-only`·crypto 금지**): `normTerm(s: string): string`(stripControl → NFKC → 공백류 하나로 → trim → 앞뒤 `"'“”‘’«»()[]{}<>「」『』.,:;!?…·` 제거 → 소문자 → `clampCp(TERM_MAX)`), `clipContext(s: string, term: string): string`(공백 정리 뒤 term 첫 위치 기준 앞뒤 150cp, 없으면 앞 300cp), `isTermLength(s: string): boolean`(normTerm 뒤 1~40cp 이고 줄바꿈 ≤ 1).
- Produces (`sanitize.ts`): `sanitizeExplain(raw: ExplainOut, term: string): ExplainOut` — `sanitizeMd`/`sanitizeLine`(`../rounds/sanitize`) 로 각 필드 정제, 상한 적용, `points`·`related` 의 빈 값·중복·`normTerm(x) === normTerm(term)` 제거, `kind==="not_term"` 이면 `inContext=""`·`points=[]`·`related=[]`, `term` 은 비면 입력 term.

- [ ] **Step 1: 테스트 작성** — `normalize.test.ts`: `normTerm("  “CIDR  블록”, ") === "cidr 블록"`, NFKC(`"ＡＷＳ"→"aws"`), 41cp 입력 → 40cp, `isTermLength("a\nb\nc") === false`, `clipContext` 가 term 을 포함하고 길이 ≤ 300cp. `sanitize.test.ts`: 링크·`<b>`·헤딩 제거, `points` 5개 → 4개, `related` 중복·term 자신 제거, `not_term` 이면 빈 필드. `schema.test.ts`: `ExplainRequest` 가 `source:"comment"` 거절·`context` 1201 거절, `ExplainOut.strict()` 가 추가 키 거절.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/ai/explain` → 모듈 없음 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. `clampCp`·`cpLength` 는 `@/components/room-new/validate`, `stripControl` 은 `../normalize`.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/ai/explain` PASS.
- [ ] **Step 5: Commit** — `git commit -- src/lib/ai/explain -m "feat(ai): 용어 해설 스키마·정규화·정제 (순수 모듈)"`

---

### Task 3: 프롬프트 · `runExplain` · 모델 어댑터 · 목 (opus)

**Files:**
- Create: `src/lib/ai/explain/prompt.ts`, `src/lib/ai/explain/explain.ts`, `src/lib/ai/explain/explain-mock.ts`
- Modify: `src/lib/ai/client.ts`(끝에 `openaiCallExplain` 추가), `src/lib/ai/env.ts`(`aiExplainEnabled`), `src/lib/ai/http.ts`(`MSG` 키 추가)
- Test: `src/lib/ai/explain/prompt.test.ts`, `src/lib/ai/explain/explain.test.ts`, `src/lib/ai/no-secrets.test.ts`(기존 — 새 파일도 검사 대상인지 확인)

**Interfaces:**
- Consumes: Task 2 전부; `escapeData`·`ChatInput`(`../prompt`); `callStructured`(client.ts 내부).
- Produces:
  - `EXPLAIN_SYSTEM: string`(스펙 D9 내용 그대로 — 데이터 선언·관점 규칙·"문제를 풀지 않는다"·글 규칙·not_term 규칙·"확실하지 않아요").
  - `buildExplainMessages(p: { room: RoomMeta; source: Source; context: string; term: string }): ChatInput[]` — user 하나: `<room>${escapeData(JSON.stringify(room))}</room><source>${source}</source><context>${escapeData(clipContext)}</context><term>${escapeData(term)}</term>`.
  - `type CallExplain = (i: { system: string; messages: ChatInput[] }) => Promise<{ ok: true; output: unknown; usage: Usage; model: string } | { ok: false; status?: number }>`.
  - `runExplain(p: { room: RoomMeta; source: Source; context: string; term: string }, deps: { callExplain: CallExplain }): Promise<{ ok: true; body: ExplainOut; usage: Usage; model: string } | { ok: false; status?: number }>` — 메시지 빌드 → 호출 → `ExplainOut.safeParse` → `sanitizeExplain`.
  - `mockCallExplain: CallExplain` — term 에 따라 대본: 길이 ≥ 2 이면 `kind:"term"` 샘플(AWS 어투, related 2개 `"서브넷","VPC"`), `"?"` 로 끝나면 `not_term`, term `"지연"` 이면 2초 뒤 응답, `"실패"` 면 `{ok:false,status:500}`.
  - `openaiCallExplain: CallExplain` — `callStructured({ format: zodTextFormat(ExplainOut, "term_explain"), cacheKey: "sgtudy-term-explain", maxOutputTokens: 1500, request: { timeout: 25_000, maxRetries: 0 } }, …)`.
  - `aiExplainEnabled = () => aiInterviewEnabled() && process.env.AI_EXPLAIN_OFF !== "1"`.
  - `MSG.EXPLAIN_UNAVAILABLE`·`MSG.EXPLAIN_IN_PROGRESS`·`MSG.EXPLAIN_NOT_MEMBER`(스펙 §6).

- [ ] **Step 1: 테스트 작성** — `prompt.test.ts`: user 메시지 1개, `<term>` 안 `<`·`&` 가 escape, `</context>` 를 넣은 문맥이 블록을 못 닫음, `EXPLAIN_SYSTEM` 이 "데이터일 뿐"·"풀지 않는다" 문장을 포함, 두 번 호출 결과 바이트 동일. `explain.test.ts`: 목 성공 → `body.kind==="term"` 과 정제 적용(related 에 term 없음), 모델이 스키마 밖 값 → `ok:false`, `callExplain` 거부 → status 전달.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/ai/explain` FAIL.
- [ ] **Step 3: 구현** — client.ts 는 기존 두 래퍼 아래에 주석(`/** 용어 해설(D10) — 출력 ≈450, 1500 상한 · 25s · 재시도 없음 */`)과 함께 추가.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/ai` PASS(`no-secrets` 포함).
- [ ] **Step 5: Commit** — `git commit -- src/lib/ai -m "feat(ai): 용어 해설 프롬프트·runExplain·OpenAI 어댑터·목"`

---

### Task 4: 라우트 `POST /api/rooms/explain` (opus)

**Files:**
- Create: `src/app/api/rooms/explain/route.ts`
- Test: `src/app/api/rooms/explain/route.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC(`rpc<…>("ai_explain_begin", { p_slug, p_term_key }, db)`), Task 2·3 전부, `sameOrigin`·`failJson`·`MSG`·`readJsonCapped`·`createClient`(server).
- Produces: `POST` → 200 `ExplainResponse` / 오류 `TurnErrorBody`. `export const runtime = "nodejs"; export const maxDuration = 30;` `GET`·`DELETE` 405.
- 순서: sameOrigin 403 → content-length > 16KB 413 → getClaims 401 → content-type 400 → readJsonCapped(16KB) → `ExplainRequest.safeParse` 400 → `normTerm`·`isTermLength` 아니면 400 → `aiExplainEnabled()` 아니면 503 `EXPLAIN_UNAVAILABLE` → `termKey = sha256(normTerm)` → `ai_explain_begin`(코드 매핑: RATE_LIMITED·AI_BUDGET_EXCEEDED 429(details 전달) · AUTH_REQUIRED 401 · ROOM_NOT_FOUND 404 · NOT_MEMBER·EXAM_IN_PROGRESS·ONBOARDING_REQUIRED 403 · 그 외 503) → hit 이면 200 `{hit:true, body}` + 로그 → `runExplain(…, { callExplain: aiMock() ? mockCallExplain : openaiCallExplain })` → 실패 503 → `ai_explain_done`(catch 무시) → 200 `{hit:false, body}` + 로그. 응답 헤더 `cache-control: no-store`.

- [ ] **Step 1: 테스트 작성** — `interview/route.test.ts` 의 틀(모킹: `server-only`, `@/lib/supabase/server`, `@/lib/ai/client` 의 `openaiCallExplain`). 케이스: 403/413/401/400(모양·41cp term·source 밖)·503(키 없음, RPC 호출 없음)·begin 적중 → 200 `hit:true` 이고 `callExplain` 미호출·`ai_explain_done` 미호출 · 미스 → `callExplain` 의 system 에 시험 단어가 없고 messages[0].content 에 `<term>` 포함 → 200 `hit:false`, `ai_explain_done` 인자에 `p_norm_term`·토큰 · RPC `EXAM_IN_PROGRESS` → 403 · `RATE_LIMITED` → 429 + `retry-after` 헤더 · 모델 실패 → 503 · 로그 한 줄에 term 문자열 없음.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/api/rooms/explain` FAIL.
- [ ] **Step 3: 구현** — `rounds/route.ts` 를 본보기로.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/api` PASS.
- [ ] **Step 5: Commit** — `git commit -- src/app/api/rooms/explain -m "feat(api): POST /api/rooms/explain — 방 관점 용어 해설(캐시·상한·응시 중 거부)"`

---

### Task 5: 선택 읽기(순수) `selection.ts` (sonnet)

**Files:**
- Create: `src/components/ask-ai/selection.ts`
- Test: `src/components/ask-ai/selection.dom.test.ts`

**Interfaces:**
- Consumes: `normTerm`·`isTermLength`·`clipContext`(Task 2 `normalize.ts`), `SOURCES`.
- Produces: `type SelectionPick = { term: string; source: Source; context: string; rect: DOMRect; container: HTMLElement }`, `readSelection(doc: Document): SelectionPick | null`, `BLOCK_SEL = "p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote"`, `DENY_SEL = '[data-ask-ai="off"],input,textarea,[contenteditable=""],[contenteditable="true"],pre,code,button'`, `ALLOW_SEL = "[data-ask-ai]:not([data-ask-ai=\"off\"])"`.
- 규칙(D1·D2·D8): `sel.rangeCount===1 && !isCollapsed`; anchor·focus 의 요소 조상(`nodeType===3 ? parentElement : node`) 각각 `closest(ALLOW_SEL)` 가 **같은 요소**이고 `data-ask-ai` 값이 `SOURCES` 안; 둘 중 하나라도 `closest(DENY_SEL)` 가 그 컨테이너 안쪽이면 null; `term = sel.toString()`, `isTermLength` 아니면 null; `context = clipContext(closest(BLOCK_SEL)?.textContent ?? container.textContent, term)`; `rect = range.getBoundingClientRect()`.

- [ ] **Step 1: 테스트 작성** — jsdom 에서 `<div data-ask-ai="node"><p>…CIDR 블록…</p><pre>code</pre></div>` 등 만들고 `document.getSelection()` + `Range` 로 선택을 만든 뒤: 정상 → term/source/context; 41cp → null; `pre` 안 → null; `data-ask-ai="off"` 안 → null; 두 컨테이너에 걸침 → null; 속성 없는 곳 → null; `source="comment"` → null. (jsdom 의 `getBoundingClientRect` 는 0 — rect 존재만 확인.)
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: PASS** — `npx vitest run src/components/ask-ai`.
- [ ] **Step 5: Commit** — `git commit -- src/components/ask-ai -m "feat(ask-ai): 선택 읽기 — 허용 컨테이너·제외 영역·40자"`

---

### Task 6: 훅 `useAskAiSelection` + 알약 `AskAiPill` (opus)

**Files:**
- Create: `src/components/ask-ai/useAskAiSelection.ts`, `src/components/ask-ai/AskAiPill.tsx`
- Test: `src/components/ask-ai/useAskAiSelection.dom.test.ts`, `src/components/ask-ai/AskAiPill.dom.test.ts`

**Interfaces:**
- Consumes: Task 5 `readSelection`·`SelectionPick`.
- Produces:
  - `useAskAiSelection(enabled: boolean): { pick: SelectionPick | null; clear: () => void }` — `enabled` 일 때만 `document` 에 `selectionchange`(setTimeout 250ms 디바운스, 새 이벤트가 오면 이전 타이머 취소)·`keyup`(즉시, `Shift`/화살표 뒤) 등록. pick 이 생기면 `window.addEventListener("scroll", clear, { capture: true, passive: true, once: true })`·`resize` once 등록(언마운트·clear 시 해제). `clear` 는 state 만 비운다(선택은 안 건드림).
  - `AskAiPill({ pick, onAsk }: { pick: SelectionPick; onAsk: () => void })` — `window.matchMedia("(width < 40rem)").matches` 면 하단 고정 막대(문구 `“{term}” AI에게 물어보기`, term 18cp 초과 시 `…`), 아니면 `position: fixed` 플로팅(`top = rect.top - 44 - 8`, 0 미만이면 `rect.bottom + 8`; `left = clamp(rect.left + rect.width/2 - w/2, 8, innerWidth - w - 8)`, 폭은 측정 없이 고정 `w=168`). `<button type="button" aria-label="선택한 용어 AI에게 물어보기" onPointerDown={e=>e.preventDefault()} onClick={onAsk}>`, 44px, `bg-ink text-surface rounded-full shadow`, body 포털, `z-30`.
  - 단축키(D18)는 이 훅이 아니라 **Task 8 의 Provider** 가 `document` `keydown` 으로 처리한다(훅은 `pick` 만 돌려준다).

- [ ] **Step 1: 테스트 작성** — 훅: `vi.useFakeTimers()`; 선택 만들고 `document.dispatchEvent(new Event("selectionchange"))` → 250ms 전 `pick===null`, 후 pick; 연속 2회 디스패치는 타이머 1회; `window.dispatchEvent(new Event("scroll"))` → null; `enabled=false` 면 리스너 없음(`addEventListener` 스파이). 알약: 데스크톱(matchMedia false 모킹) 버튼 1개·`style.top`·`left` 가 clamp 범위; 모바일(true) 하단 막대에 term 포함·말줄임; `onPointerDown` 이 `defaultPrevented`.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS**.
- [ ] **Step 5: Commit** — `git commit -- src/components/ask-ai -m "feat(ask-ai): 선택 감지 훅(디바운스·스크롤 시 숨김)·알약 버튼"`

---

### Task 7: 시트 `AskAiSheet` + `api.ts` (opus)

**Files:**
- Create: `src/components/ask-ai/AskAiSheet.tsx`, `src/components/ask-ai/api.ts`, `src/components/ask-ai/copy.ts`(§6 문구 상수)
- Test: `src/components/ask-ai/AskAiSheet.dom.test.ts`, `src/components/ask-ai/api.test.ts`

**Interfaces:**
- Consumes: `ExplainOut`·`ExplainResponse`·`Source`(Task 2), `useFocusTrap`(`@/components/ui/useFocusTrap`), `MarkdownView`, `TurnErrorBody`(`@/lib/ai/schema`), 시트 결은 `QuestionNavSheet`(`tabs/ExamNav.tsx:87~`) 의 마크업·클래스.
- Produces:
  - `postExplain(body: { slug: string; term: string; source: Source; context: string }, opts?: { fetcher?: typeof fetch; signal?: AbortSignal }): Promise<{ ok: true; data: ExplainResponse } | { ok: false; err: TurnErrorBody & { status: number } }>` — `interview/api.ts` 와 같은 모양, 네트워크 실패 기본 `{error:"AI_UNAVAILABLE", message: COPY.unavailable}`.
  - `type SheetState = { phase: "loading" } | { phase: "ok"; body: ExplainOut } | { phase: "error"; code: string; message: string }`.
  - `AskAiSheet({ term, state, onClose, onAskRelated, returnFocus }: { term: string; state: SheetState; onClose: () => void; onAskRelated: (t: string) => void; returnFocus: HTMLElement | null })` — `role="dialog" aria-modal aria-labelledby`, `useFocusTrap`, Esc, 바탕 클릭·닫기 버튼 44px, `body.overflow=hidden`, `max-h-[calc(100dvh-48px)]`, 모바일 `items-end rounded-t-[18px]` / `sm:items-center sm:rounded-[18px] sm:max-w-[560px]`. 본문: 로딩 = `role="status" aria-busy` 문구(3초 뒤 두 번째 문구, setTimeout) + 스켈레톤 3줄; ok = 제목 `term`·부제·절 4개(`inContext`·`points` 는 `MarkdownView`, `related` 는 `<button>` 칩 → `onAskRelated`), `kind==="not_term"` 이면 안내 한 줄; error = `message` + (429 면 `retryAfterSec` 가 있으면 「n초 뒤」). 바닥 각주. 닫으면 `returnFocus?.focus()`.
  - `COPY` 상수(스펙 §6 전부).

- [ ] **Step 1: 테스트 작성** — api: fetch 모킹으로 200/429(details 유지)/네트워크 throw, `signal` 전달. 시트: 로딩 `role=status`, 3초 뒤 문구 교체(fake timers); ok 렌더에 절 제목 4개·related 칩 클릭 → `onAskRelated("VPC")`; not_term 은 절 없음; Esc → `onClose`; 닫기 뒤 `returnFocus` 에 포커스; `body.style.overflow` 복원.
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**.
- [ ] **Step 5: Commit** — `git commit -- src/components/ask-ai -m "feat(ask-ai): 해설 시트(바텀시트/카드)·API 래퍼·문구"`

---

### Task 8: `AskAiProvider` + 화면 연결 + 허용 영역 속성 (opus)

**Files:**
- Create: `src/components/ask-ai/AskAiProvider.tsx`
- Modify: `src/components/my-study/MyStudyScreen.tsx`(Props `askAi?: boolean`, 최상위를 `<AskAiProvider slug={detail.slug} enabled={!!askAi}>` 로 감쌈), `src/app/my-study/[id]/page.tsx`(`askAi={aiExplainEnabled()}` — `@/lib/ai/env` 는 server-only 라 page 에서만), `src/components/my-study/tabs/NodeDescription.tsx`(`MarkdownView` 를 `<div data-ask-ai="node">` 로), `tabs/OverviewTab.tsx:172`(`room`), `tabs/NoticeTab.tsx:461`·`NoticePopup.tsx:158`(`notice`), `tabs/SubmissionView.tsx:14`(`submission`), `tabs/ExamQuestionView.tsx:40`(`<li … data-ask-ai={p.mode === "take" ? "off" : "exam"}>`), `WrongNoteItem.tsx`(문항 `<li>` 에 `wrong`), `.env.example`(`AI_EXPLAIN_OFF=` 한 줄 + 주석)
- Test: `src/components/ask-ai/AskAiProvider.dom.test.ts`, `src/components/my-study/tabs/ExamQuestionView.askAi.dom.test.ts`(새 파일 — 기존 테스트 파일 수정 최소화)

**Interfaces:**
- Consumes: Task 5·6·7 전부, `normTerm`.
- Produces: `AskAiProvider({ slug, enabled, children })` — `enabled` 거짓이면 children 만. 상태: `pick`(훅), `open: { term; source; context; returnFocus } | null`, `state: SheetState`, 세션 메모리 `useRef(new Map<string, ExplainOut>())`(키 `normTerm`), `AbortController` ref. `ask(term, source, context)`: 메모리 적중이면 즉시 ok; 아니면 loading → `postExplain` → ok(메모리 저장, `kind==="term"` 만) / error. 알약 클릭·단축키(`keydown` Alt+Shift+KeyA, pick 있을 때, `document` 리스너) → `ask(pick.term, …)` + `returnFocus = pick.container.closest<HTMLElement>('[tabindex],a,button,section,article') ?? document.body` + `clear()`. 시트 열린 동안 `pick` 은 무시(알약 안 그림). `onAskRelated(t)` → 같은 source·context 로 `ask(t)`. 닫기 → abort + `open=null`. **입력 요소에 포커스가 있으면 단축키 무시**.

- [ ] **Step 1: 테스트 작성** — Provider(jsdom, `postExplain` 모킹): 허용 컨테이너에서 선택 → 알약 → 클릭 → 시트 loading → ok 본문; 같은 term 재선택·클릭 → fetch 1회(메모리); `enabled=false` → 알약 없음; Alt+Shift+A → 시트; 시트 열린 채 새 선택 → 알약 없음; 닫기 → `abort` 호출됨(요청 중일 때). ExamQuestionView: `mode:"take"` `<li>` 가 `data-ask-ai="off"`, `mode:"result"` 는 `"exam"`; 기존 `ExamQuestionView`·`ExamSection`·`WrongNoteList` DOM 테스트 그대로 PASS.
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: 전체 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` PASS.
- [ ] **Step 5: Commit** — `git commit -- src/components/ask-ai src/components/my-study/MyStudyScreen.tsx "src/app/my-study/[id]/page.tsx" src/components/my-study/tabs/NodeDescription.tsx src/components/my-study/tabs/OverviewTab.tsx src/components/my-study/tabs/NoticeTab.tsx src/components/my-study/NoticePopup.tsx src/components/my-study/tabs/SubmissionView.tsx src/components/my-study/tabs/ExamQuestionView.tsx src/components/my-study/WrongNoteItem.tsx .env.example -m "feat(ask-ai): 내 스터디에 「AI에게 물어보기」 — 선택 → 알약 → 방 관점 해설 시트"`

---

### Task 9: 수동 확인 (mock) · 마무리 (sonnet)

**Files:** 없음(발견한 버그는 해당 Task 파일에서 고치고 별도 커밋)

- [ ] **Step 1: 로컬 DB** — `supabase db reset`(로컬만) 로 0052 적용, `npm run test:db` PASS.
- [ ] **Step 2: dev 서버** — `vm_stat | grep -E 'free|compressor'` → `AI_INTERVIEW_MOCK=1 npx next dev -p 3700`. ego-browser 로 시드 계정(민수) 로그인 → `/my-study/<aws 방>`.
- [ ] **Step 3: 확인 목록(1440·390 폭)** — 과제 설명에서 `CIDR 블록` 드래그 → 알약(데스크톱 선택 위 / 390 은 하단 막대) → 시트 4절 → 관련 용어 칩 → 새 해설 → 같은 용어 재선택은 네트워크 탭에 요청 없음 → Esc 닫힘·포커스 복귀 → 41자 선택 시 알약 없음 → 코드 블록 선택 없음 → 시험 응시 화면(take) 선택 없음, 제출 뒤 결과 화면 선택 가능 → 응시 중 다른 탭 설명에서 물어보면 `시험을 제출한 뒤에 쓸 수 있어요` → `"지연"` 선택으로 3초 뒤 문구 교체 → `"실패"` 로 오류 문구 → Alt+Shift+A. 스크롤 중 알약이 따라오지 않고 사라지는지. 콘솔에 term 이 없는지.
- [ ] **Step 4: 스펙 갱신** — 결정이 바뀐 것이 있으면 스펙 맨 끝 "결정에 따른 변경" 표. 없으면 생략.
- [ ] **Step 5: 보고** — 커밋 해시 목록, 호스티드 적용 대기(0052 `db push`, Vercel env `AI_EXPLAIN_OFF` 없음=켜짐)를 컨트롤러에 전달. 배포 뒤 마스터 계정으로 실제 모델 3개 방 × 5용어 품질 확인(스펙 §9).
