# 방 만들기 AI 인터뷰 2단계 — 회차 초안 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터뷰가 끝나면 "회차 초안도 자동으로 잡아 드릴까요?" 를 묻고, 예 를 고르면 `POST /api/rooms/rounds` 1회로 **방 기간을 서버가 나눈 회차 표**에 모델이 제목·목표·과제 글을 채운 `sgtudy.plan/v1` 계획서를 받는다. 미리보기(수동 폼) 아래 접힘 섹션에 보여 주고(회차 제외 체크·다시 생성), [방 만들기] 때 `room_create` → `curriculum_plan_preview` → `curriculum_plan_apply` 로 방과 회차를 만든다. 회차가 실패해도 방은 만들어진다.

**Spec:** `docs/superpowers/specs/2026-10-23-room-create-ai-rounds-design.md` (D21~D34 권장안 · 사용자 승인 대기 · **D35~D38 「바로 모집 시작」 추가 범위** — Task 4·5·6 에만 영향, Task 1~3 무관)

**Architecture:**
- **DB** = `0049_ai_rounds_usage.sql` 하나: `ai_usage.kind` check 에 `room_rounds` 추가, `ai_limits()`·`ai_turn_check()` 재정의(0047 판 복사 + rounds 분기). 계획서 경로(0034·0038)는 **무변경**.
- **서버** = `src/lib/ai/rounds/`(순수: `schedule.ts` 균등 분할 · `schema.ts` · `prompt.ts` · `sanitize.ts` · `toPlan.ts` · `rounds.ts` `runRounds` · `rounds-mock.ts`) + Route `src/app/api/rooms/rounds/route.ts`. `src/lib/ai/client.ts` 를 포맷·상한을 받는 공용 호출로 일반화(`openaiCallModel` 는 그대로 export).
- **웹** = `state.ts`(style 기억·회차 질문 단계) · `InterviewPanel`(done 뒤 로컬 질문 칩·busy·오류) · `api.ts`(`postRounds`) · `NewRoomScreen`(`roundsDraft` 상태·기간 수정 무효화) · 새 `RoundsDraftSection`(폼 아래 details·체크·다시 생성) · `NewRoomForm`(`afterCreate` 훅으로 preview→apply) · `src/lib/api/plan.ts`(`planPreview`·`planApply`) · `MyStudyScreen` 토스트 `note`.

**Tech Stack:** 1단계와 동일(Next 16.4.2 Route Handler · React 19 · Tailwind v4 · Supabase PG17 plpgsql · `openai` 7.30.1 `responses.parse` + `zodTextFormat` · zod 4.6.7 · vitest jsdom · deno+PGlite `npm run test:db`).

## 번호·동시 작업 (중요)

- 마이그레이션은 **`0049_ai_rounds_usage.sql`** 하나. Task 0 에서 `ls supabase/migrations | tail -3` 로 0049 가 비어 있는지 확인, 있으면 멈추고 오케스트레이터와 번호를 다시 정한다.
- **`InterviewPanel.tsx`·`follow.ts` 는 다른 작업자(interview-autoscroll)가 고치는 중** — Task 4 는 그 커밋이 main 에 들어온 뒤 시작한다(Task 0 Step 4 에서 `git log -1 -- src/components/room-new/interview/InterviewPanel.tsx` 와 작업 트리 확인). 그 전까지 Task 1~3 만 진행.
- 동시 작업 중 금지 파일: `docs/superpowers/*/2026-10-23-wrong-answer-note*`, `*md-images*`, `src/components/ui/markdown-editor/**`, `src/lib/markdown/**`, `supabase/migrations/0045_*`~`0048_*`.

## Global Constraints

- 1단계 플랜의 Global Constraints 전부 유지: plpgsql `security definer set search_path=''`·`public.fail` · `api_invoke` 비노출 · `src/lib/ai/**`·`src/app/api/rooms/**` 에서 `service_role`·`createAdminClient` 금지 · `src/components/**` 에서 `OPENAI_API_KEY`·`openai` import 금지(정적 테스트 `no-secrets.test.ts` 가 새 디렉터리도 훑는다) · 모델 출력은 zod → 정규화 뒤에만 밖으로 · 로그에 내용 없음 · 새 npm 의존성 **없음**.
- **계획서는 서버가 조립한다**(D31) — 모델 스키마에 날짜·라벨·kind·parent·op 를 넣지 않는다. 클라이언트는 받은 `plan` 에서 **제외 회차를 빼는 것 외에 바꾸지 않는다**.
- **방 생성 경로 무변경**: `room_create` 호출 인자·오류 처리는 그대로. 회차 적용은 `room_create` 성공 **뒤** 별도 try 로, 실패해도 `router.push` 는 반드시 한다(D22·D32).
- 라우트 `maxDuration = 60` 은 Task 0 에서 Vercel 플랜 상한을 확인한 뒤 쓴다. 안 되면 `30` + 회차 13개 초과 시 2회 분할 호출(Task 3 대체안).
- 메모리: dev 서버·빌드·`supabase start` 전 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나. dev 서버 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`). 브라우저는 `ego-browser`(자기 창).
- 호스티드 Supabase·Vercel·OpenAI 콘솔은 건드리지 않는다. **실제 모델 호출은 Task 7 에서만**, 그 전 테스트는 전부 목.
- 게이트(모든 Task): `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL Task 는 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만. 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`(sonnet 작업자는 `Claude Sonnet 5.5`).
- 서브에이전트 금지. 줄 번호는 작성 시점 — 인용 코드로 위치를 찾는다.

## Review Focus

1. **회차 때문에 방 생성이 막히지 않는다** — `room_create` 성공 뒤 어떤 예외도 `router.push(myStudyEdit)` 를 막지 못한다. → Task 4·5.
2. **계획서는 서버 조립·기존 검증 통과** — `toPlan` 결과가 `planDoc.parse` 와 `plan_validate` 를 항상 통과(날짜 연속·마지막=종료일·노드 ≤200·exam 은 회차 아래 리프). → Task 2.
3. **상한이 먼저** — `ai_turn_check("room_rounds")` 가 모델 호출 전, 거부되면 OpenAI 요청 없음. 다시 생성도 센다. → Task 1·3.
4. **인젝션 격리** — 발화·설명은 데이터 블록 escape, 모델 출력은 문자열 3종 → `sanitizeMd`·clamp. → Task 2·3.
5. **사용자 확인 뒤 확정** — 회차는 미리보기 섹션에 보인 뒤 [방 만들기] 를 눌러야 적용. 자동 적용 없음. → Task 4.
6. **1단계 회귀 없음** — `room_interview` 상한 동작·인터뷰 DOM 테스트·수동 폼 전부 통과. `client.ts` 일반화 뒤 `openaiCallModel` 동작 동일. → Task 1·3·4.
7. **기간 수정 시 무효화** — 폼에서 시작·종료일을 바꾸면 회차 초안이 사라지고 안내가 보인다. → Task 4.
8. **접근성·반응형** — details `<summary>` 44px, 체크박스 라벨, 390/820/1440 가로 스크롤 없음, 로컬 질문 칩 radiogroup. → Task 4·6.
9. **모집 시작은 기존 RPC·조건 그대로(D35)** — `openRecruit(slug)` 는 회차 적용 성공 **뒤**, 체크됐고 과제 ≥1 일 때만. 실패해도 push. f19936d 의 `DraftRecruitBanner`·`useOpenRecruit`·`LeaderPanel` 은 **수정하지 않는다**(문구 함수 `openRecruitNote` 만 import). → Task 4·5.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음(읽기만)

- [ ] **Step 1: 번호·트리** — `cd /Users/picpal/Desktop/workspace/sgtudy && git status --short && ls supabase/migrations | tail -3`. Expected: `0049_*` 없음. `src/lib/ai/**`·`src/app/api/rooms/**`·`src/components/room-new/**` 에 커밋 안 된 변경이 있으면 누구 것인지 보고(interview-autoscroll 가능).
- [ ] **Step 2: 0047 check 제약 이름·재정의 원본** — `grep -n "kind.*check\|create or replace function public.ai_" supabase/migrations/0047_ai_usage.sql`. 제약은 익명(`check (kind in …)`) → PG 자동 이름 `ai_usage_kind_check`. PGlite 로컬에서 `select conname from pg_constraint where conrelid='public.ai_usage'::regclass` 로 확인(`supabase/tests/_harness.ts` 방식).
- [ ] **Step 3: Vercel 함수 시간** — `vercel.json` 에 함수 설정 없음(regions 만). 프로젝트 플랜은 사용자에게 1줄 질문(Hobby 면 60s 상한 → `maxDuration 60` 가능, Pro 면 300). 답을 못 받으면 **60 으로 쓰고 보고에 적는다**.
- [ ] **Step 4: 동시 작업** — `git log -3 --format='%h %s' -- src/components/room-new/interview/InterviewPanel.tsx src/components/room-new/interview/follow.ts`. interview-autoscroll 커밋이 있는지 기록. Task 4 시작 조건.
- [ ] **Step 5: 웹에서 계획서 RPC** — `grep -n "curriculum_plan_preview\|curriculum_plan_apply" src/lib/supabase/database.types.ts`(타입 존재 여부 — 없으면 Task 4 에서 수동 추가, 1단계 관례대로) · `grep -n "export async function rpc" -A 12 src/lib/api/errors.ts`(브라우저 호출 모양) · `sed -n 1,40p src/components/my-study/editUrl.ts`(쿼리 처리 — `note` 추가 가능 위치).
- [ ] **Step 6: 마크다운 렌더** — `src/components/my-study/markdown.ts`·`MarkdownView.tsx` 가 링크·이미지·HTML 을 어떻게 다루는지 1줄 기록(서버 `sanitizeMd` 가 이중 방어인지 단독인지). **파일은 고치지 않는다**(md-images 작업 중).
- [ ] **Step 7: 게이트 기준선** — `npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run`. 실패 목록은 보고하고 뒤 Task 에서 같은 실패는 무시.

---

### Task 1: 0049 `room_rounds` kind · 자체 상한 (SQL · opus)

**Files:**
- Create: `supabase/migrations/0049_ai_rounds_usage.sql`
- Create: `supabase/tests/ai-rounds-usage-sql.test.ts`
- 참고: `supabase/tests/ai-usage-sql.test.ts`(0047 테스트 — 모양 복사, **수정 금지**)

- [ ] **Step 1: 테스트 먼저** — 케이스: (a) `ai_turn_check('room_rounds', false)` 첫 호출 `{id}`, 행 `kind='room_rounds'`; (b) 10회까지 성공, 11회째 `RATE_LIMITED` + `details.window = 'rounds'` + `retryAfterSec ≥ 1`; (c) `room_interview` 29턴 뒤 `room_rounds` 1회 → 10분 창 합산으로 다음 `room_interview` 가 `RATE_LIMITED window:'tenMin'`(공유 확인); (d) 전체 rounds 상한 — 케이스 안에서 `ai_limits()` 를 `roundsGlobalPerDay: 2` 로 재정의(롤백) → 다른 사용자 2명 뒤 3번째 `AI_BUDGET_EXCEEDED`; (e) `room_rounds` 는 `startsPerDay` 를 소모하지 않는다(`p_started` true 로 보내도 0047 의 시작 카운트에 안 잡힘 — rounds 분기에서 `started` 를 false 로 저장); (f) `room_interview` 0047 케이스 (a)(b)(d) 재실행 → 동일(회귀); (g) `ai_turn_check('unknown', false)` → `VALIDATION_FAILED`.
- [ ] **Step 2: 마이그레이션** — 머리 주석(날짜·왜·재정의 원본 `ai_limits ← 0047`·`ai_turn_check ← 0047`·시그니처 동일 → GRANT 유지). 본문: `alter table … drop constraint ai_usage_kind_check; add constraint ai_usage_kind_check check (kind in ('room_interview','room_rounds'));` → `ai_limits()` 재정의(0047 JSON + `"roundsPerDay":10,"roundsGlobalPerDay":300`) → `ai_turn_check` 재정의: 0047 본문 복사, kind 검사 목록에 `room_rounds`, 10분·하루 집계는 두 kind 합산(그대로), `if p_kind = 'room_interview' then <0047 시작·전체 분기> else <rounds: 내 하루 rounds ≥ roundsPerDay → RATE_LIMITED(window 'rounds', retryAfterSec = 가장 오래된 rounds 행 + 1 day − now) · 전체 하루 rounds ≥ roundsGlobalPerDay → AI_BUDGET_EXCEEDED('오늘은 회차 초안을 더 만들 수 없어요 · 방을 만든 뒤 진행목표에서 채울 수 있어요')> end if;` insert 의 `started` 는 `p_kind = 'room_interview' and coalesce(p_started,false)`. GRANT 재선언 불필요(시그니처 동일) — 주석으로 명시.
- [ ] **Step 3: 게이트** — `npm run test:db` 새 파일 + 전체. 커밋 `git commit -- supabase/migrations/0049_ai_rounds_usage.sql supabase/tests/ai-rounds-usage-sql.test.ts`.

---

### Task 2: 순수 로직 — 분할·스키마·프롬프트·정규화·계획서 조립·목 (opus)

**Files:**
- Create: `src/lib/ai/rounds/schedule.ts` — `splitRounds(start, end) → { cadenceDays: 7|14, rounds: {index, label, startDate, endDate}[] }`(D23: ⌈D/7⌉, >26 이면 14일, 꼬리 <3일은 앞 회차에 합침, 마지막 끝 = end, 최소 1), `labelFor(i, cadence)`("N주차"/"N회차").
- Create: `src/lib/ai/rounds/schema.ts` — `RoundsModel`(strict, §5.2), `RoundsModelIn`(키 생략 허용), `RoundsRequest`(zod: `draft` record · `userLines` ≤12·각 ≤500cp · `style` ⊂ `STYLE_VALUES`), 응답 타입 `RoundsResponse{plan, rounds, stats, padded}`, 상수 `MAX_ROUNDS=26`·`ROUND_TITLE_MAX=40`·`GOAL_MAX=300`·`TASK_TITLE_MAX=40`·`TASK_DESC_MAX=150`·`MAX_USER_LINES=12`.
- Create: `src/lib/ai/rounds/sanitize.ts` — `sanitizeMd(s, max)`: `stripControl` → 링크 `[t](u)`→`t`, 이미지 `![..](..)` 제거, `<…>` 태그 제거, 줄 머리 `#+ ` 제거, `http(s)://…` 제거, 불릿 `- ` 유지, 빈 줄 접기, `clampCp`.
- Create: `src/lib/ai/rounds/prompt.ts` — `ROUNDS_SYSTEM`(고정 문자열, §5.3) · `buildRoundsMessages({today, draft, style, schedule, tasksPerRound, userLines})` → `ChatInput[]`(데이터 블록, `escapeData` 재사용).
- Create: `src/lib/ai/rounds/toPlan.ts` — `toPlan(schedule, model, {tasksPerRound, examEachRound}) → { plan: PlanDoc, rounds: RoundView[], stats, padded }`: 회차 i 마다 `{op:"create", parent:null, label, title, startDate, endDate, descriptionMd, children:[...tasks.map(t => ({title, descriptionMd, taskType:"common"})), ...(exam ? [{title:`${label} 확인 시험`, kind:"exam"}] : [])]}`. 부족하면 `{title:`${label} 학습`, goalMd:"", tasks:[]}` 로 채우고 `padded++`, 넘치면 자름, 과제 `slice(0, tasksPerRound)`, 빈 제목은 라벨로 대체. `tasksPerRound = style ∋ weekly-task|proof ? 2 : 1`, `examEachRound = style ∋ exam`.
- Create: `src/lib/ai/rounds/rounds.ts` — `runRounds(req, deps:{callModel: CallStructured<RoundsModel>, today}) → {ok, body, usage, model} | {ok:false, error:"AI_UNAVAILABLE", status?}`(순수, I/O 없음). `normalizeDraft` 로 draft 재검증, 날짜 없으면 `{ok:false, error:"VALIDATION_FAILED"}`.
- Create: `src/lib/ai/rounds/rounds-mock.ts` — 결정적 대본(제목 `${draft.title 앞 12cp} ${label}`, 목표 2줄, 과제 "…핵심 정리", "…문제 풀기"; 발화에 "장애 테스트" 가 있으면 `{ok:false}`; "부족 테스트" 면 N−2 개만 내서 `padded` 경로).
- Tests: `schedule.test.ts`(7/14 전환 경계 — 182일=26주차·183일=14일 회차 14개·꼬리 합침·1일 방·마지막=종료일·연속성·라벨), `sanitize.test.ts`, `toPlan.test.ts`(**`planDoc.parse(plan)` 통과**(`src/lib/mcp/plan-schema.ts` import) · 노드 수 = N×(1+tasks+exam) ≤200 · exam 리프에 children 없음·depth 3 · children 에 날짜 키 없음 · 보정·`padded`), `prompt.test.ts`(인젝션 문자열 escape·12줄 초과 자름·system 바이트 고정), `rounds.test.ts`(목으로 정상·실패·`VALIDATION_FAILED`), `no-secrets.test.ts` 범위에 `src/lib/ai/rounds/**` 포함 확인(기존 glob 이 `src/lib/ai/**` 면 자동).

- [ ] **Step 1: 테스트 먼저**(스펙 §10 순수 행 전부). **Step 2: 구현.** **Step 3: 게이트 · 커밋.**

---

### Task 3: `client.ts` 일반화 + Route `POST /api/rooms/rounds` (opus)

**Files:**
- Modify: `src/lib/ai/client.ts` — 내부를 `callStructured<T>({format, cacheKey, maxOutputTokens, timeoutMs, effort}, {system, messages}) → {ok, parsed, usage, model} | {ok:false, status}` 로 뽑고, `openaiCallModel` 은 그 위에 `ModelTurn`·2048·20s·`"sgtudy-room-interview"` 로 유지(동작 동일). 새 `openaiCallRounds`: `RoundsModel`·`max_output_tokens 12_000`·`timeout 50_000`·`maxRetries 0`·`prompt_cache_key "sgtudy-room-rounds"`·`effort "low"`. 클라이언트 인스턴스는 timeout 이 달라 **요청 옵션(두 번째 인자 `{timeout}`)** 로 넘긴다(인스턴스 1개 유지).
- Modify: `src/lib/ai/http.ts` — `MSG.ROUNDS_UNAVAILABLE`, `MSG.ROUNDS_LIMIT` 추가.
- Create: `src/app/api/rooms/rounds/route.ts` — `runtime "nodejs"`, `maxDuration 60`(Task 0 결과), 순서 = 인터뷰 라우트와 동일(Origin → 크기 → 세션 → content-type → `readJsonCapped` 64KB → `RoundsRequest.parse` → 키 없음 503 → `ai_turn_check(p_kind:"room_rounds", p_started:false)` → `runRounds`(mock 이면 대본) → `ai_turn_done` → 로그 `{evt:"ai_rounds", n, ms, in, out, cached, model, status}`). GET/DELETE 405.
- Test: `src/app/api/rooms/rounds/route.test.ts`(인터뷰 `route.test.ts` 복사·수정: 403/413/401/400 · 날짜 없음 400 · `RATE_LIMITED window:"rounds"` 429 + `retry-after` + **callModel 미호출** · `AI_BUDGET_EXCEEDED` 429 · 정상 200 모양(plan·rounds·stats) · 모델 실패 503 · `ai_turn_done` 실패 무시 · 로그에 발화·제목 없음), `client.test.ts` 보강(`openaiCallModel` 기존 케이스 그대로 통과 + `openaiCallRounds` 옵션 확인 — SDK 는 `vi.mock`).

- [ ] **Step 1: 테스트 먼저.** **Step 2: 구현.** **Step 3: 게이트 · 커밋.**

---

### Task 4: 웹 — 질문 칩 · 회차 초안 섹션 · 생성 시 적용 (opus · **interview-autoscroll 머지 뒤**)

**Files:**
- Modify: `src/components/room-new/interview/state.ts` — `InterviewState` 에 `style: string[]`(multi 칩 `field:"style"` 답을 `send` 액션에서 기억), `rounds: "idle"|"asking"|"busy"|"error"`, `roundsError: TurnError|null`; 액션 `turn`(done 이면 `rounds:"asking"`), `roundsStart`, `roundsFail`, `roundsSkip`. `userLines(s)` 셀렉터(user 줄만, 뒤에서 12개).
- Modify: `src/components/room-new/interview/api.ts` — `postRounds(body) → {ok, data: RoundsResponse} | {ok:false, err}`(같은 모양, URL `/api/rooms/rounds`).
- Modify: `src/components/room-new/interview/InterviewPanel.tsx` — `done && rounds==="asking"` 이면 [미리보기로] 대신 **로컬 assistant 말풍선**(`lines` 에 넣지 않는다 — 서버로 다시 보내지 않게; `role=log` 바깥에 `aria-live` 단락) + `SingleChips` 2개([네, 잡아 주세요] [아니요, 미리보기로]); 예 → `roundsStart` → `postRounds({draft, userLines, style})` → 성공 `onRounds(data)` 후 `onFinish()`, 실패 `roundsFail` → `role=alert` 말풍선 + [다시 시도] [그냥 미리보기로]; `busy` 동안 "회차를 잡는 중… 10~40초 걸려요"(`aria-busy`). 새 props `onRounds`. **스크롤 추적(`useFollowBottom`) 키에 `rounds` 상태를 더한다**(autoscroll 작업자의 최종 시그니처를 따른다).
- Modify: `src/components/room-new/NewRoomScreen.tsx` — `roundsDraft: RoundsResponse|null`, `excluded: Set<number>`, `roundsStale: boolean`; `onFormChange` 에서 `startDate`/`endDate` 가 바뀌면 `roundsStale=true`(초안은 남기되 적용 안 함); `RoundsDraftSection` 을 폼 아래 렌더(인터뷰를 거쳐 `roundsDraft` 가 있을 때만); [다시 생성] → `postRounds` 재호출(현재 `draft`·`style`·`userLines`) → 교체·`excluded` 초기화·`roundsStale=false`; `NewRoomForm` 에 `afterCreate`·`submitLabel` 전달.
- Create: `src/components/room-new/RoundsDraftSection.tsx` — `<details open={desktop}>`(`matchMedia(min-width:1024px)` 초기값, SSR 은 닫힘) `<summary>` 「회차 초안 N개 · 과제 M개 · 시험 K개」(44px) + [다시 생성](disabled while busy) · `padded>0` 이면 "일부 회차는 기본 제목이에요" · `roundsStale` 이면 경고 단락 "기간이 바뀌어 회차 초안을 다시 잡아야 해요" 와 [다시 생성] 만; 회차 행 = `<label><input type=checkbox checked={!excluded}/> 1주차 · 10/26~11/1 · IAM 기초</label>` + 안쪽 `<details>` 로 목표·과제 목록(텍스트 노드, 마크다운 해석 없음 — 미리보기는 평문) · 제외 회차 "뺀 회차 자리는 비워 둬요" 1줄 · 전부 제외 시 "회차 없이 방만 만들어요".
- Modify: `src/components/room-new/NewRoomForm.tsx` — props `afterCreate?: (slug: string) => Promise<string | null>`(돌려준 문자열 = 이동 URL 에 붙일 `note`), `submitLabel?: string`. `submit`: `room_create` → `putRoomTags`(기존) → `const note = afterCreate ? await afterCreate(room.slug).catch(() => "rounds-skipped") : null` → `router.push(note ? `${routes.myStudyEdit(room.slug)}&note=${note}` : routes.myStudyEdit(room.slug))`. 그 외 무변경.
- Create: `src/lib/api/plan.ts` — `planPreview(slug, plan) → PreviewData`(`rpc("curriculum_plan_preview", {p_slug, p_plan, p_undo_of: null})`), `planApply(slug, previewId)`; `applyRoundsPlan(slug, plan): Promise<"applied"|"rounds-skipped">`(preview `ok:false` → skipped + `console.warn(code)`; apply 예외 → skipped). `database.types.ts` 에 RPC 타입이 없으면 1단계 관례대로 추가.
- Modify: `src/components/room-new/NewRoomScreen.tsx` — `afterCreate = roundsDraft && !roundsStale && includedOps.length ? (slug) => applyRoundsPlan(slug, withOnly(plan, excluded)) : undefined`. `withOnly` 는 `ops.filter((_, i) => !excluded.has(i))` 뿐(D31).

**추가 범위 — 바로 모집 시작(D35~D38), 같은 Task 안:**
- Modify: `src/components/room-new/interview/state.ts` — `rounds` 단계에 `"recruitAsking"` 추가(회차 성공 뒤), `openRecruit: boolean | null`(인터뷰 답, null = 안 물음). 액션 `roundsDone`(→ recruitAsking), `recruitAnswer(yes)`.
- Modify: `src/components/room-new/interview/InterviewPanel.tsx` — `rounds==="recruitAsking"` 이면 로컬 말풍선 "방을 만들면서 바로 모집도 시작할까요? {openRecruitNote(draft)}" + `SingleChips` [네, 바로 모집 시작] [아니요, 나중에 할게요] → `recruitAnswer` → `onRecruitPref(yes)` → `onFinish()`. 회차 실패·건너뛰기 경로에서는 묻지 않는다.
- Modify: `src/components/room-new/NewRoomScreen.tsx` — `openRecruit: boolean` 상태(기본 **true**, 인터뷰 답이 덮어씀 — D37) · `canRecruit = includedLeafCount(roundsDraft, excluded) > 0 && !roundsStale`(과제 + 시험 리프 수) · `afterCreate` 를 `(slug) => applyRoundsPlan(...).then(r => r === "applied" && openRecruit && canRecruit ? tryOpenRecruit(slug) : r)` 로 확장 · 버튼 라벨 3종 "방 만들기" / "… · 회차 N개 함께" / "… · 회차 N개 · 바로 모집".
- Create: `src/components/room-new/RecruitNowField.tsx` — 체크박스 「만들면서 바로 모집 시작」(44px 라벨) + 설명 `openRecruitNote({isPublic, joinMode})`(`src/lib/api/leader.ts` import, f19936d 문구 재사용) · `disabled={!canRecruit}` 이면 힌트 "회차에 과제가 1개 이상 있어야 모집을 시작할 수 있어요 · 만든 뒤 내 스터디 상단에서 시작할 수 있어요"(`aria-describedby`). 회차 섹션 아래·폼 submit 버튼 위에 `NewRoomForm` 의 `extra` 슬롯(새 prop `beforeSubmit?: ReactNode`)으로 렌더. 직접 입력만 쓴 사용자에게도 비활성 상태로 보인다(D36).
- Modify: `src/lib/api/plan.ts` — `tryOpenRecruit(slug): Promise<"applied" | "recruit-skipped">`(`openRecruit(slug)` from `@/lib/api/leader`; 예외 → skipped + `console.warn(code)`). **`useOpenRecruit` 훅은 쓰지 않는다**(토스트·refresh 가 생성 화면에 없음) — RPC 래퍼 `openRecruit` 와 문구만 공유.
- Tests 추가: `state.test.ts`(roundsDone → recruitAsking · recruitAnswer), `InterviewPanel.dom.test.ts`(회차 성공 뒤에만 모집 칩 · 답 → `onRecruitPref` → `onFinish` · 회차 실패 경로엔 칩 없음), `RecruitNowField.dom.test.ts`(공개 direct/approval·비공개 문구 · disabled 힌트 · 44px), `NewRoomScreen.dom.test.ts`(기본 체크 true · 인터뷰 "아니요" → false · 전부 제외/stale → disabled · 라벨 3종), `NewRoomForm.dom.test.ts`(`afterCreate` 결과 `recruit-skipped` → note 쿼리), `plan.test.ts`(`tryOpenRecruit` 분기 · apply 실패면 openRecruit 미호출).
- Tests: `state.test.ts`(style 기억·rounds 단계 전이·userLines 12개), `InterviewPanel.dom.test.ts` 보강(done → 질문 칩 2개 · 아니오 → `onFinish` · 예 → `postRounds` 본문(`style`·`userLines`) → `onRounds`+`onFinish` · 실패 말풍선 버튼 · 429 rounds 는 다시 시도 없음), `RoundsDraftSection.dom.test.ts`(요약 문구·체크 해제 → stats·전부 제외 문구·stale 안내·padded 문구·summary 44px 클래스), `NewRoomScreen.dom.test.ts` 보강(기간 수정 → stale · 버튼 라벨 "방 만들기 · 회차 N개 함께"/"방 만들기"), `NewRoomForm.dom.test.ts` 보강(`afterCreate` 가 `room_create` **뒤** 호출·거부돼도 push 됨·note 쿼리), `plan.test.ts`(`applyRoundsPlan` 분기 — `rpc` 를 `vi.mock`).

- [ ] **Step 1: 시작 조건** — Task 0 Step 4 의 autoscroll 커밋이 main 에 있고 `InterviewPanel.tsx` 작업 트리가 깨끗한지 확인. 아니면 멈추고 보고.
- [ ] **Step 2: 테스트 먼저.** **Step 3: 구현**(Review Focus 1·5·7). **Step 4: 게이트 · 커밋.**

---

### Task 5: 내 스터디 편집 화면 `note` 토스트 (sonnet)

**Files:**
- Modify: `src/components/my-study/editUrl.ts`(또는 Task 0 Step 5 에서 확인한 쿼리 처리 위치) — `note=rounds-skipped` 읽기 + URL 에서 제거(`router.replace`, 새로고침 때 재표시 방지).
- Modify: `src/components/my-study/MyStudyScreen.tsx` — 마운트 시 note 가 있으면 토스트: `rounds-skipped` → "회차 초안은 적용하지 못했어요 · 진행목표에서 직접 추가해 주세요", `recruit-skipped` → "모집은 시작하지 못했어요 · 위의 [모집 시작] 으로 할 수 있어요"(`tone` 은 기존 `Toast` 톤 이름 확인). **`DraftRecruitBanner` 는 건드리지 않는다**(준비중이면 그대로 보여 재시도 경로가 된다).
- Tests: `editUrl.test.ts` 보강, `MyStudyScreen.dom.test.ts` 에 케이스 2개(note 두 값 → 각 문구, 없으면 없음, 알 수 없는 값 무시).

- [ ] **Step 1:** 테스트 먼저. **Step 2:** 구현(다른 note 값은 무시). **Step 3:** 게이트 · 커밋.

---

### Task 6: 반응형·접근성·E2E(목) 확인 (sonnet)

**Files:** Create(선택): `e2e/room-new-ai-rounds.spec.ts`(1단계 E2E 가 있으면 그 관례대로, `authoring-e2e-suites` 참고)

- [ ] **Step 1:** `vm_stat` → `.env.local` `AI_INTERVIEW_MOCK=1` → `npx next dev -p 3700` → `ego-browser` 로 `/rooms/new?mode=ai` 를 390/820/1440 에서: 인터뷰 완주 → 질문 칩 → 예 → "잡는 중" → 미리보기에 회차 섹션(모바일 접힘·데스크톱 펼침) → 회차 1개 제외 → 버튼 라벨 → [방 만들기] → `/my-study/{slug}?tab=curriculum&mode=edit` 에 회차 N−1 개·과제·시험 리프([시험] 표시) 확인. 키보드만으로 질문 칩·체크·details 조작. 스크린샷 3장은 `$CLAUDE_JOB_DIR/tmp`.
- [ ] **Step 2:** 발화에 "장애 테스트" 로 실패 말풍선 → [그냥 미리보기로] → 방만 생성. 발화 "부족 테스트" 로 `padded` 문구.
- [ ] **Step 3:** 폼에서 종료일 수정 → stale 안내 + 모집 체크 비활성 → [다시 생성] → 회차 수 변화·체크 복귀.
- [ ] **Step 3b(모집):** (가) 인터뷰 → 회차 예 → 모집 "네" → 미리보기 체크 켜짐·라벨 "… · 바로 모집" → 생성 → 편집 화면 상태 배지 **모집중**·준비중 막대 없음 → 둘러보기에 방 보임. (나) 모집 "아니요" → 체크 꺼짐 → 생성 → 준비중 막대 보임. (다) 직접 입력만 → 체크 비활성+힌트 확인. (라) 비공개방으로 (가) 반복 → 문구 "초대 링크를 받은 사람만 …".
- [ ] **Step 4:** dev 서버 종료. 문제는 해당 Task 파일만 고치고 게이트 · 커밋.

---

### Task 7: 실제 모델 수동 확인 · 배포 체크리스트 (opus · **사용자 키 필요**)

**Files:** 없음(스펙 §11 표에 결과 메모만)

- [ ] **Step 1:** 사용자가 `.env.local` 에 `OPENAI_API_KEY` 를 둔 상태(작업자는 키를 보지 않는다)에서 MOCK 끄고 3회: 자격증 12주(exam 포함) · 코딩테스트 8주(weekly-task) · 영어 1년(26회차·14일). 확인: 제목 ≤40cp 명사형 · 과제 제출물 분명 · 추가 요청 반영 · 로그 `n·ms·out` (26회차 `ms` 와 `status`, `incomplete` 여부) · `cached > 0`(2회째부터).
- [ ] **Step 2:** 26회차에서 잘림·40초 초과가 보이면 스펙 §9 "분할 호출" 을 2단계 1순위로 메모. 품질 미달이면 상위 모델 1회 비교(비용·`roundsGlobalPerDay` 조정은 사용자 결정).
- [ ] **Step 3:** 배포 체크리스트를 보고에 포함: (1) 호스티드 DB 에 **0049** 적용(사용자, `supabase db push`) (2) Vercel env 변경 없음(키 재사용) · 함수 시간 60s 가 플랜 안인지 (3) 배포 후 마스터 계정으로 `/rooms/new?mode=ai` 인터뷰 → 예 → 방 생성 1회, 만든 방은 보관 (4) OpenAI 프로젝트 Usage limits 는 1단계 값 유지(월 최악 +$54 를 감안해 필요하면 상향).

---

## 결정에 따른 변경

| 스펙 결정이 바뀌면 | 고치는 Task |
|---|---|
| D21 (b) 방 먼저 → 편집 화면에서 미리보기 | Task 4 의 질문·섹션을 `MyStudyScreen` 쪽으로 옮긴다(큰 변경 — 이 플랜 재작성) |
| D22 원자 RPC | Task 1 에 `room_create_with_plan`(0013 `room_create` 호출 + `plan_*`) 추가, Task 4 `afterCreate` 제거 |
| D23 회차 길이·상한 | Task 2 `schedule.ts` 상수·테스트 숫자 |
| D25 과제 수·길이 | Task 2 `toPlan`·`schema` 상수 |
| D26 시험 회차 규칙 | Task 2 `toPlan` 의 `examEachRound` 조건 |
| D28 `maxDuration`·분할 호출 | Task 3 라우트 상수 · `runRounds` 를 2회 호출로(회차 표를 반으로) |
| D29 상한 숫자 / 턴에 합산 | Task 1 `ai_limits()` 상수 · 합산이면 0049 를 check 제약 1줄로 축소 |
| D30 인라인 편집 추가 | Task 4 `RoundsDraftSection` 에 입력 칸 + `withOnly` 를 제목 반영까지 확장(서버 검증은 그대로) |
| D33 질문 위치(`done` 전에 묻기 등) | Task 4 `state.ts` 전이·`InterviewPanel` |
| D37 기본값 꺼짐 | Task 4 `NewRoomScreen` 초기값 상수 1개 + 테스트 |
| D36 인터뷰 질문 제거(체크박스만) | Task 4 `recruitAsking` 단계·칩 삭제, `RecruitNowField` 는 유지 |
| D35 회차 없는 방도 모집(서버 `ROOM_NO_LEAF_TASK` 완화) | DB 변경(0050) — 이 플랜 밖, 사용자 결정 |
