// 0033 — 개인 액세스 토큰(PAT) · current_user_id 보조 신원 · 레이트리밋
import { assert, assertEquals, assertMatch } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, one, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const clearApi = (q: Q) => q("select set_config('sgtudy.api_uid', '', true)");
const mk = async (q: Q, scopes = ["read", "curriculum:write", "personal:write"], days = 90) =>
  (await one(q, "select public.pat_create('Claude Code', $1::text[], $2) as t", [`{${scopes.join(",")}}`, days])).t as Row;

cases("api tokens 0033", db, [
  { name: "pat_create: 원문 1회 · 표에는 sha256 만 · 접두 16자 · 만료 = 지금 + 일수", run: async (q) => {
    await as(q, "민수");
    const t = await mk(q);
    assertMatch(t.token, /^sgt_pat_[0-9a-f]{64}$/);
    assertEquals(t.prefix, t.token.slice(0, 16));
    assertEquals(t.scopes, ["curriculum:write", "personal:write", "read"]);
    const row = await one(q, "select token_hash, token_prefix from public.api_tokens where id = $1::uuid", [t.id]);
    assertEquals(row.token_hash, (await one(q, "select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [t.token])).h);
    const list = (await one(q, "select public.pat_list() as l")).l as Row;
    assertEquals(list.items.length, 1);
    assertEquals("token" in list.items[0], false);
  } },
  { name: "pat_create 검증: 이름 1~40 · 스코프 허용 목록 · 일수 30/90/365 · 사용자당 10개", run: async (q) => {
    await as(q, "민수");
    await expectFail(q("select public.pat_create('', '{read}', 90)"), "VALIDATION_FAILED");
    await expectFail(q("select public.pat_create('x', '{admin}', 90)"), "VALIDATION_FAILED");
    await expectFail(q("select public.pat_create('x', '{}', 90)"), "VALIDATION_FAILED");
    await expectFail(q("select public.pat_create('x', '{read}', 7)"), "VALIDATION_FAILED");
    for (let i = 0; i < 10; i++) await mk(q, ["read"]);
    await expectFail(q("select public.pat_create('x', '{read}', 90)"), "API_TOKEN_LIMIT");
  } },
  { name: "비로그인은 pat_create 불가 · 남의 토큰은 폐기 불가", run: async (q) => {
    await asAnon(q);
    await expectFail(q("select public.pat_create('x', '{read}', 90)"), "AUTH_REQUIRED");
    await as(q, "민수");
    const t = await mk(q);
    await as(q, "지은");
    await expectFail(q("select public.pat_revoke($1::uuid)", [t.id]), "NOT_FOUND");
    await as(q, "민수");
    const l = (await one(q, "select public.pat_revoke($1::uuid) as l", [t.id])).l as Row;
    assertEquals(l.items.length, 0);
  } },
  { name: "api_authenticate: 유효 토큰 → current_user_id 가 그 사용자(anon 세션에서) · last_used_at 갱신", run: async (q) => {
    await as(q, "민수");
    const minsu = await uidOf(q, "민수");
    const t = await mk(q);
    await asAnon(q);
    assertEquals((await one(q, "select public.current_user_id() as u")).u, null);
    await q("select public.api_authenticate($1, 'me_studies')", [t.token]);
    assertEquals((await one(q, "select public.current_user_id()::text as u")).u, minsu);
    assert((await one(q, "select last_used_at from public.api_tokens where id = $1::uuid", [t.id])).last_used_at);
    await clearApi(q);
  } },
  { name: "auth.uid() 가 있으면 GUC 는 무시된다(coalesce 순서)", run: async (q) => {
    const jieun = await uidOf(q, "지은");
    await as(q, "민수");
    await q("select set_config('sgtudy.api_uid', $1, true)", [jieun]);
    assertEquals((await one(q, "select public.current_user_id()::text as u")).u, await uidOf(q, "민수"));
    await clearApi(q);
  } },
  { name: "api_authenticate 거부: 형식 · 없는 토큰 · 폐기 · 만료 · 스코프 · 모르는 op", run: async (q) => {
    await as(q, "민수");
    const ro = await mk(q, ["read"]);
    const gone = await mk(q);
    await q("select public.pat_revoke($1::uuid)", [gone.id]);
    const old = await mk(q, ["read"], 30);
    await asAnon(q);
    await expectFail(q("select public.api_authenticate('nope', 'me_studies')"), "API_TOKEN_INVALID");
    await expectFail(q("select public.api_authenticate($1, 'me_studies')", ["sgt_pat_" + "0".repeat(64)]), "API_TOKEN_INVALID");
    await expectFail(q("select public.api_authenticate($1, 'me_studies')", [gone.token]), "API_TOKEN_INVALID");
    await expectFail(q("select public.api_authenticate($1, 'curriculum_plan_apply')", [ro.token]), "API_SCOPE_DENIED");
    await expectFail(q("select public.api_authenticate($1, 'room_delete')", [ro.token]), "API_UNKNOWN_OP");
    await q("select set_config('app.now', (now() + interval '31 days')::text, true)");
    await expectFail(q("select public.api_authenticate($1, 'me_studies')", [old.token]), "API_TOKEN_EXPIRED");
  } },
  { name: "api_rate_check: 토큰당 60/분 · 적용 20/시간(미리보기는 별도 120/시간)", run: async (q) => {
    await as(q, "민수");
    const u = await uidOf(q, "민수");
    const t = await mk(q);
    await q(`insert into public.api_audit (token_id, user_id, source, op, ok, created_at)
             select $1::uuid, $2::uuid, 'PAT', 'me_studies', true, public.app_now() from generate_series(1, 60)`, [t.id, u]);
    await expectFail(q("select public.api_rate_check($1::uuid, $2::uuid, 'me_studies', null)", [t.id, u]), "API_RATE_LIMITED");
    await expectFail(q("select public.api_rate_check($1::uuid, $2::uuid, 'whoami', null)", [t.id, u]), "API_RATE_LIMITED");   // 〔C#6〕 라우트 인증도 분당 한도를 본다
    await q("delete from public.api_audit where token_id = $1::uuid", [t.id]);
    await q(`insert into public.api_audit (token_id, user_id, source, op, dry_run, ok, created_at)
             select $1::uuid, $2::uuid, 'PAT', 'curriculum_plan_apply', false, true, public.app_now() - interval '2 minutes' from generate_series(1, 20)`, [t.id, u]);
    await q("select public.api_rate_check($1::uuid, $2::uuid, 'curriculum_plan_preview', true)", [t.id, u]);   // 미리보기는 통과
    await expectFail(q("select public.api_rate_check($1::uuid, $2::uuid, 'curriculum_plan_apply', false)", [t.id, u]), "API_RATE_LIMITED");
    await q("select public.api_rate_check($1::uuid, $2::uuid, 'curriculum_plan_apply', false, true)", [t.id, u]);  // 〔C#7〕 확인된 재생은 통과
  } },
  { name: "〔N7〕 HTTP 인증 카운터: whoami 만 센다 · 분당 120 초과 → API_RATE_LIMITED · 다음 분이면 1부터", run: async (q) => {
    await as(q, "민수");
    const t = await mk(q, ["read"]);
    await asAnon(q);
    await q("select set_config('app.now', (date_trunc('minute', now()) + interval '30 seconds')::text, true)");   // 분 경계 흔들림 방지
    await q("update public.api_tokens set http_window = date_trunc('minute', public.app_now()), http_count = 120 where id = $1::uuid", [t.id]);
    await expectFail(q("select public.api_authenticate($1, 'whoami')", [t.token]), "API_RATE_LIMITED");
    assertEquals((await one(q, "select http_count from public.api_tokens where id = $1::uuid", [t.id])).http_count, 120);   // 실패한 요청은 롤백
    await q("select public.api_authenticate($1, 'me_studies')", [t.token]);   // 도구 op 는 이 카운터와 무관(감사 기반 60/분)
    await clearApi(q);
    await q("select set_config('app.now', (date_trunc('minute', now()) + interval '1 minute 30 seconds')::text, true)");
    await q("select public.api_authenticate($1, 'whoami')", [t.token]);
    assertEquals((await one(q, "select http_count from public.api_tokens where id = $1::uuid", [t.id])).http_count, 1);
    await clearApi(q);
  } },
  { name: "〔C#7〕 잠금 순서(정적): api_rate_check 는 집계 전에 사용자 잠금 · pat_create 는 개수 전에 사용자 잠금", run: async (q) => {
    // PGlite 는 단일 연결이라 동시 실행을 재현할 수 없다 → 함수 본문에서 순서를 고정하고, 실제 경쟁은 api-invoke-db.test.ts(실 PostgREST)에서 본다
    const src = async (fn: string) => (await one(q, "select prosrc from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1", [fn])).prosrc as string;
    const rc = await src("api_rate_check");
    assert(rc.indexOf("api_user_lock(") >= 0 && rc.indexOf("api_user_lock(") < rc.indexOf("count(*)"), "api_rate_check: lock → count");
    assert((await src("api_user_lock")).includes("pg_advisory_xact_lock"));
    const pc = await src("pat_create");
    assert(pc.indexOf("pg_advisory_xact_lock") >= 0 && pc.indexOf("pg_advisory_xact_lock") < pc.indexOf("count(*)"), "pat_create: lock → count");
    assertEquals((await one(q, "select provolatile from pg_proc where proname = 'api_rate_check'")).provolatile, "v");
  } },
  { name: "GRANT: pat_* 는 authenticated 만, 내부 함수는 아무도", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    for (const fn of ["public.pat_create(text, text[], integer)", "public.pat_list()", "public.pat_revoke(uuid)"]) {
      assertEquals([await can("anon", fn), await can("authenticated", fn)], [false, true], fn);
    }
    for (const fn of ["public.api_authenticate(text, text)", "public.api_rate_check(uuid, uuid, text, boolean, boolean)", "public.api_user_lock(uuid)",
                      "public.api_scope_of(text)", "public.api_limits()"]) {
      assertEquals([await can("anon", fn), await can("authenticated", fn)], [false, false], fn);
    }
  } },
]);
