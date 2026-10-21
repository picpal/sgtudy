// 0035 — api_invoke 게이트웨이(PAT → 기존 RPC) · api_studies · 스터디 이름 해석 · personal_create_many/delete_many · 감사
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, makeQ, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";
import { mkRoom, submit } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const clearApi = (q: Q) => q("select set_config('sgtudy.api_uid', '', true)");
const tokenFor = async (q: Q, nick: string, scopes = "{read,curriculum:write,personal:write}") => {
  await clearApi(q);
  await as(q, nick);
  const t = (await one(q, "select public.pat_create('test', $1::text[], 90) as t", [scopes])).t as Row;
  await asAnon(q);
  return t.token as string;
};
const call = async (q: Q, token: string | null, op: string, args: unknown = {}) => {
  const r = (await one(q, "select public.api_invoke($1, $2, $3::jsonb) as r", [token, op, JSON.stringify(args)])).r as Row;
  await clearApi(q);
  return r;
};

cases("api invoke 0035", db, [
  { name: "whoami · me_studies(편집권·현재 회차·meta.expiresAt) — PAT 주인 기준", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const w = await call(q, t, "whoami");
    assertEquals([w.ok, w.data.nickname, w.data.source, w.data.tokenName], [true, "민수", "pat", "test"]);
    assertEquals(w.data.userId, await uidOf(q, "민수"));   // 〔P8〕
    assertEquals(w.data.scopes, ["curriculum:write", "personal:write", "read"]);
    assert(w.meta.expiresAt);
    const s = await call(q, t, "me_studies");
    const aws = s.data.items.find((x: Row) => x.slug === "aws");
    assertEquals([aws.role, aws.canEditCurriculum, aws.status, aws.startDate, aws.endDate, aws.canAddPersonal],
      ["leader", true, "active", "2026-10-01", "2026-12-31", true]);
    assertEquals([aws.currentRound.label, aws.currentRound.title, aws.currentRound.startDate], ["2주차", "EC2·S3", "2026-10-08"]);
    assertEquals([aws.membership, aws.archived, typeof aws.when.kind, aws.intro.length > 0], ["leader", false, "string", true]);   // me_studies 항목 그대로
    assert(s.meta.expiresAt);
    const j = await call(q, await tokenFor(q, "지은"), "me_studies");
    assertEquals(j.data.items.find((x: Row) => x.slug === "aws").role, "member");
  } },
  { name: "〔P11〕 api_studies: 추가 모집 창이 열린 ACTIVE 방의 PENDING 신청 = status active · role pending · 모집 쪽 정렬 · 이름 해석 ③ 포함", run: async (q) => {
    const aws = await roomId(q, "aws");
    const u = await uidOf(q, "승호");   // 시드: cs(RECRUIT, 10-14 시작) 멤버, aws 와 무관
    await q("update public.rooms set recruit_until = '2026-10-20' where id = $1::bigint", [aws]);
    await q("insert into public.room_members (room_id, user_id, role, status, applied_at) values ($1::bigint, $2::uuid, 'MEMBER', 'PENDING', now())", [aws, u]);
    const items = ((await one(q, "select public.api_studies($1::uuid, false) as s", [u])).s as Row).items as Row[];
    // 대기 신청은 "모집" 쪽(방 상태는 active 그대로) — 그 안은 시작일 순: aws(10-01) → cs
    assertEquals(items.map((x) => [x.slug, x.status, x.role]), [["aws", "active", "pending"], ["cs", "recruit", "member"]]);
    const p = items[0];
    assertEquals([p.canEditCurriculum, p.canAddPersonal, p.when.kind], [false, false, "recruitEnd"]);
    // 창이 닫히면 빠진다(0032 조건)
    await q("update public.rooms set recruit_until = '2026-10-11' where id = $1::bigint", [aws]);
    assertEquals((((await one(q, "select public.api_studies($1::uuid, false) as s", [u])).s as Row).items as Row[]).map((x) => x.slug), ["cs"]);
    // 이름 해석 ③: study 없음 → 진행·모집 중 1개면 그것. 승호는 cs 하나뿐 → cs
    assertEquals((await one(q, "select public.api_resolve_study($1::uuid, null) as s", [u])).s, "cs");
    await q("update public.rooms set recruit_until = '2026-10-20' where id = $1::bigint", [aws]);
    await expectFail(q("select public.api_resolve_study($1::uuid, '')", [u]), "STUDY_AMBIGUOUS");   // cs + aws(대기)
  } },
  { name: "me_studies: 종료 방은 includeEnded 일 때만 · 정렬 진행 → 모집 → 종료", run: async (q) => {
    const u = await uidOf(q, "민수");
    const r = await mkRoom(q, "민수", { title: "민수 모집 방" });
    await q("update public.rooms set status = 'RECRUIT' where id = $1::bigint", [r.id]);
    const e = await mkRoom(q, "민수", { title: "민수 끝난 방" });
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [e.id]);
    await asAnon(q);
    const a = ((await one(q, "select public.api_studies($1::uuid, false) as s", [u])).s as Row).items as Row[];
    assertEquals(a.map((x) => x.status), ["active", "recruit"]);
    const b = ((await one(q, "select public.api_studies($1::uuid, true) as s", [u])).s as Row).items as Row[];
    assertEquals(b.map((x) => x.status), ["active", "recruit", "ended"]);
    assertEquals(b[1].currentRound, null);
  } },
  { name: "〔D14·P3〕 study 이름 해석: slug · 제목 일부 · 겹치면 STUDY_AMBIGUOUS(후보) · 없으면 STUDY_NOT_FOUND · 하나뿐이면 생략 가능", run: async (q) => {
    const t = await tokenFor(q, "민수");
    assertEquals((await call(q, t, "curriculum_get")).data.study.slug, "aws");          // ③ 민수의 진행·모집 스터디는 aws 하나
    assertEquals((await call(q, t, "curriculum_get", { study: "aws" })).data.study.slug, "aws");
    assertEquals((await call(q, t, "curriculum_get", { study: "aws saa" })).data.study.slug, "aws");   // 대소문자 무시
    assertEquals((await call(q, t, "curriculum_get", { slug: "aws" })).data.study.slug, "aws");
    await mkRoom(q, "민수", { title: "AWS 심화 스터디" });                             // 〔P3〕 같은 낱말이 든 두 번째 방
    await asAnon(q);
    await clearApi(q);
    assertEquals((await call(q, t, "curriculum_get", { study: "AWS SAA" })).data.study.slug, "aws");   // 여전히 하나
    const amb = await call(q, t, "curriculum_get", { study: "AWS" });
    assertEquals([amb.ok, amb.error.code], [false, "STUDY_AMBIGUOUS"]);
    assertEquals(amb.error.details.candidates.length, 2);
    assert(amb.error.details.candidates.every((c: Row) => typeof c.slug === "string" && typeof c.title === "string"));
    assertEquals((await call(q, t, "curriculum_get")).error.code, "STUDY_AMBIGUOUS");                  // ③ 이제 둘
    assertEquals((await call(q, t, "curriculum_get", { study: "없는스터디" })).error.code, "STUDY_NOT_FOUND");
    // ① slug 정확 일치는 내 스터디가 아니어도 — 공개 방 읽기
    assertEquals((await call(q, t, "curriculum_get", { study: "toeic" })).data.study.slug, "toeic");
    const au = await one(q, "select ok, error_code from public.api_audit where op = 'curriculum_get' and error_code = 'STUDY_NOT_FOUND'");
    assertEquals(au.ok, false);   // 해석 오류도 감사
  } },
  { name: "curriculum_get: version · study · currentRoundId · viewer", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const c = await call(q, t, "curriculum_get", { study: "aws" });
    assertEquals(c.data.version.length, 32);
    assertEquals(c.data.study, { slug: "aws", title: "AWS SAA 자격증 3개월 완주", status: "active", startDate: "2026-10-01", endDate: "2026-12-31" });
    assertEquals(c.data.viewer.nickname, "민수");
    assertEquals(c.data.currentRoundId, await nodeId(q, "aws", "EC2·S3"));
    assert(c.data.nodes.length > 0);
    assertEquals((await call(q, t, "curriculum_get", { study: "spring" })).error.code, "ROOM_NOT_FOUND");   // 비공개 방 외부인
  } },
  { name: "〔C#8〕 fileCounts: 붙은 READY NODE_DOC 만 실제 개수 — 미연결·삭제·개인 목표 노드 제외", run: async (q) => {
    const aws = await roomId(q, "aws");
    const leaf = await nodeId(q, "aws", "ALB vs NLB 실습");
    const other = await nodeId(q, "aws", "EC2·S3");
    const minsu = await uidOf(q, "민수");
    await as(q, "지은");
    const mine = (await one(q, "select public.personal_create('aws', $1::bigint, '내 복습') as c", [other])).c as Row;
    const ins = (node: string, status: string, attached: boolean) => q(
      `insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, created_at, attached_at)
       values (gen_random_uuid(), $1::uuid, $2::bigint, $3::bigint, 'NODE_DOC', 'n/' || $2 || '/' || $3 || '/' || gen_random_uuid() || '.pdf',
               'x.pdf', 'application/pdf', 1, $4, now(), case when $5 then now() end)`, [minsu, aws, node, status, attached]);
    await ins(leaf, "READY", true); await ins(leaf, "READY", true);   // 2개 셈
    await ins(leaf, "READY", false);                                   // 미저장(attached_at null) 제외
    await ins(leaf, "DELETED", true);                                  // 삭제 제외
    await ins(mine.createdId as string, "READY", true);               // 개인 목표 노드 제외(팀 노드만)
    const t = await tokenFor(q, "민수");
    const fc = (await call(q, t, "curriculum_get", { study: "aws" })).data.fileCounts;
    assertEquals(fc[leaf], 2);
    assertEquals(mine.createdId in fc, false);
    assertEquals(Object.keys(fc).length >= 1, true);
    assertEquals(Object.values(fc).every((n) => typeof n === "number" && n > 0), true);   // 0 은 생략
  } },
  { name: "〔C#5〕 isMine: 지은 토큰 → 지은 목표 true · 철수 목표 false(볼 수는 있음) · 팀 노드 false", run: async (q) => {
    const r2 = await nodeId(q, "aws", "EC2·S3");
    await as(q, "지은");
    const a = ((await one(q, "select public.personal_create('aws', $1::bigint, '지은 목표') as c", [r2])).c as Row).createdId;
    await as(q, "철수");
    const b = ((await one(q, "select public.personal_create('aws', $1::bigint, '철수 목표') as c", [r2])).c as Row).createdId;
    const t = await tokenFor(q, "지은");
    const nodes = (await call(q, t, "curriculum_get", { study: "aws" })).data.nodes as Row[];
    const by = (id: string) => nodes.find((n) => n.id === id)!;
    assertEquals([by(a).isMine, by(b).isMine, by(r2).isMine], [true, false, false]);
    assertEquals(by(b).task.people[0].nickname, "철수");   // 〔P8〕 ownerNickname 출처
    assert(nodes.every((n) => typeof n.isMine === "boolean"));
  } },
  { name: "me_schedule: 기간 창 그대로 · 62일 초과는 SCHEDULE_RANGE_INVALID · 날짜 형식 오류 VALIDATION_FAILED", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const r = await call(q, t, "me_schedule", { from: "2026-10-12", to: "2026-10-25" });
    assert(Array.isArray(r.data.tasks));
    assertEquals((await call(q, t, "me_schedule", { from: "2026-01-01", to: "2026-12-31" })).error.code, "SCHEDULE_RANGE_INVALID");
    assertEquals((await call(q, t, "me_schedule", { from: "10월 12일", to: "2026-12-31" })).error.code, "VALIDATION_FAILED");
  } },
  { name: "미리보기 → 적용(previewId) — 감사 2행(op 별, preview_id) · 재적용 replayed", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const r2 = (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug='aws' and n.title='EC2·S3'")).id;
    const plan = { schema: "sgtudy.plan/v1", ops: [{ op: "create", parent: r2, title: "PAT 로 만든 과제", taskType: "common" }] };
    const d = await call(q, t, "curriculum_plan_preview", { study: "aws", plan });
    assertEquals([d.ok, d.data.ok], [true, true]);
    const a = await call(q, t, "curriculum_plan_apply", { previewId: d.data.previewId });
    assertEquals([a.ok, a.data.applied], [true, true]);
    assertEquals((await call(q, t, "curriculum_plan_apply", { previewId: d.data.previewId })).data.replayed, true);
    const n = await one(q, "select created_by::text as by from public.goal_nodes where title = 'PAT 로 만든 과제'");
    assertEquals(n.by, await uidOf(q, "민수"));
    const audit = await q("select op, ok, preview_id, source, room_id::text as room, dry_run, summary from public.api_audit where op like 'curriculum_plan_%' order by id");
    assertEquals(audit.map((x) => [x.op, x.ok, x.source, x.dry_run]),
      [["curriculum_plan_preview", true, "PAT", true], ["curriculum_plan_apply", true, "PAT", false], ["curriculum_plan_apply", true, "PAT", false]]);
    assertEquals(audit.map((x) => x.preview_id), [d.data.previewId, d.data.previewId, d.data.previewId]);
    assertEquals(audit.map((x) => x.room), Array(3).fill(await roomId(q, "aws")));
    assertEquals([audit[1].summary.replayed, audit[2].summary.replayed], [undefined, true]);
    assertEquals(audit[0].summary.summary.created, 1);
  } },
  { name: "apply: 남의 previewId·없는 previewId → {ok:false, PREVIEW_NOT_FOUND} + 감사", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const r = await call(q, t, "curriculum_plan_apply", { previewId: "pv_000000000000" });
    assertEquals([r.ok, r.error.code], [false, "PREVIEW_NOT_FOUND"]);
    const a = await one(q, "select ok, error_code, preview_id from public.api_audit order by id desc limit 1");
    assertEquals([a.ok, a.error_code, a.preview_id], [false, "PREVIEW_NOT_FOUND", "pv_000000000000"]);
  } },
  { name: "〔C#7〕 적용 20/시간을 채운 뒤: 이미 적용한 previewId 재시도(replay)는 통과 · 새 적용은 API_RATE_LIMITED", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const mk = async (title: string) => (await call(q, t, "curriculum_plan_preview",
      { study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", parent: r2, title, taskType: "common" }] } })).data.previewId as string;
    const done = await mk("이미 적용");
    await call(q, t, "curriculum_plan_apply", { previewId: done });
    const fresh = await mk("새 적용");
    await q(`insert into public.api_audit (token_id, user_id, source, op, dry_run, ok, created_at)
             select null, $1::uuid, 'PAT', 'curriculum_plan_apply', false, true, public.app_now() - interval '2 minutes' from generate_series(1, 20)`,
            [await uidOf(q, "민수")]);
    assertEquals((await call(q, t, "curriculum_plan_apply", { previewId: done })).data.replayed, true);   // 응답을 잃은 20번째의 재시도
    await expectFail(q("select public.api_invoke($1, 'curriculum_plan_apply', $2::jsonb)", [t, JSON.stringify({ previewId: fresh })]), "API_RATE_LIMITED");
  } },
  { name: "레이트리밋은 api_invoke 가 같은 트랜잭션에 넣은 감사 행을 센다: 분당 60(토큰) — 59 + 1 통과, 다음 API_RATE_LIMITED", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const tid = (await one(q, "select id::text as id from public.api_tokens where user_id = $1::uuid order by created_at desc limit 1", [await uidOf(q, "지은")])).id;
    await q(`insert into public.api_audit (token_id, user_id, source, op, dry_run, ok, created_at)
             select $1::uuid, $2::uuid, 'PAT', 'me_studies', null, true, public.app_now() from generate_series(1, 59)`, [tid, await uidOf(q, "지은")]);
    assertEquals((await call(q, t, "me_studies")).ok, true);                    // 60번째 — 이 호출이 감사 행을 남긴다
    assertEquals((await one(q, "select count(*)::int as n from public.api_audit where token_id = $1::uuid", [tid])).n, 60);
    await expectFail(q("select public.api_invoke($1, 'me_studies', '{}'::jsonb)", [t]), "API_RATE_LIMITED");
    await expectFail(q("select public.api_invoke($1, 'whoami', '{}'::jsonb)", [t]), "API_RATE_LIMITED");   // whoami 도 분당 한도는 본다
  } },
  { name: "〔C#13〕 적용 중간 실패(PAT 경로) → {ok:false} · 앞 op 노드 없음 · 감사 실패 행 · 초안 미적용", run: async (q) => {
    const t = await tokenFor(q, "민수");
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const leaf = ((await one(q, "select public.node_create('aws', $1::bigint, '제출될 과제', null, 'common') as c", [r2])).c as Row)
      .nodes.find((n: Row) => n.title === "제출될 과제").id as string;
    await asAnon(q);
    const d = await call(q, t, "curriculum_plan_preview", { study: "aws", plan: { schema: "sgtudy.plan/v1",
      ops: [{ op: "create", parent: r2, title: "먼저 생길 과제", taskType: "common" }, { op: "create", parent: leaf, title: "하위" }] } });
    await submit(q, leaf, "지은");
    const a = await call(q, t, "curriculum_plan_apply", { previewId: d.data.previewId });
    assertEquals([a.ok, a.error.code], [false, "NODE_HAS_SUBMISSIONS"]);
    assertEquals((await q("select 1 from public.goal_nodes where title in ('먼저 생길 과제', '하위')")).length, 0);
    const au = await one(q, "select ok, error_code from public.api_audit where op = 'curriculum_plan_apply' order by id desc limit 1");
    assertEquals([au.ok, au.error_code], [false, "NODE_HAS_SUBMISSIONS"]);
    assertEquals((await one(q, "select applied_at from public.api_plan_drafts where id = $1", [d.data.previewId])).applied_at, null);
  } },
  { name: "〔C#11〕 인자 300KB 초과 → PAYLOAD_TOO_LARGE(예외, 인증 전 — 잘못된 토큰이어도 이것)", run: async (q) => {
    const t = await tokenFor(q, "민수");
    const big = JSON.stringify({ study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "x", descriptionMd: "a".repeat(310_000) }] } });
    await expectFail(q("select public.api_invoke($1, 'curriculum_plan_preview', $2::jsonb)", [t, big]), "PAYLOAD_TOO_LARGE");
    await expectFail(q("select public.api_invoke('nope', 'curriculum_plan_preview', $1::jsonb)", [big]), "PAYLOAD_TOO_LARGE");
    await expectFail(q("select public.api_invoke($1, 'whoami', '[1]'::jsonb)", [t]), "VALIDATION_FAILED");
  } },
  { name: "권한 불변: 멤버 토큰의 미리보기 → {ok:false, NOT_CURRICULUM_EDITOR} + 감사 실패 행 · 비참가자 개인 목표 NOT_ACTIVE_MEMBER", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const r = await call(q, t, "curriculum_plan_preview", { study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "x" }] } });
    assertEquals([r.ok, r.error.code], [false, "NOT_CURRICULUM_EDITOR"]);
    const a = await one(q, "select ok, error_code, dry_run from public.api_audit order by id desc limit 1");
    assertEquals([a.ok, a.error_code, a.dry_run], [false, "NOT_CURRICULUM_EDITOR", true]);
    const out = await tokenFor(q, "서연");   // aws 외부인(공개 방 — 읽기는 됨)
    assertEquals((await call(q, out, "curriculum_plan_preview", { study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "x" }] } })).error.code, "NOT_CURRICULUM_EDITOR");
    assertEquals((await call(q, out, "personal_create_many", { study: "aws", goals: [{ title: "x" }] })).error.code, "NOT_ACTIVE_MEMBER");
  } },
  { name: "스코프: read 토큰으로 personal_create_many → API_SCOPE_DENIED(예외) · 모르는 op API_UNKNOWN_OP · 감사 없음", run: async (q) => {
    const t = await tokenFor(q, "지은", "{read}");
    await expectFail(q("select public.api_invoke($1, 'personal_create_many', '{}'::jsonb)", [t]), "API_SCOPE_DENIED");
    await expectFail(q("select public.api_invoke($1, 'drop_everything', '{}'::jsonb)", [t]), "API_UNKNOWN_OP");
    await expectFail(q("select public.api_invoke('sgt_pat_' || repeat('0', 64), 'whoami', '{}'::jsonb)"), "API_TOKEN_INVALID");
    assertEquals((await one(q, "select count(*)::int as n from public.api_audit")).n, 0);
  } },
  { name: "personal_create_many: 원자 — 하나라도 틀리면 0개, 다 맞으면 전부 · 회차 라벨 · 같은 제목 재시도는 건너뜀", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const bad = await call(q, t, "personal_create_many", { study: "aws", round: "2주차", goals: [{ title: "복습 1" }, { title: "" }] });
    assertEquals([bad.ok, bad.error.code], [false, "INVALID_TITLE"]);
    assertEquals((await q("select 1 from public.goal_nodes where title = '복습 1'")).length, 0);
    const ok = await call(q, t, "personal_create_many", { study: "aws", round: "2주차", goals: [{ title: "복습 1" }, { title: "복습 2", endDate: "2026-10-13" }] });
    assertEquals([ok.ok, ok.data.count, ok.data.createdIds.length, ok.data.round.label, ok.data.round.title], [true, 2, 2, "2주차", "EC2·S3"]);
    assertEquals([ok.data.skipped, ok.data.remaining, ok.data.warnings], [[], 18, []]);
    const again = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "복습 1" }, { title: "복습 3" }] });
    assertEquals([again.data.count, again.data.skipped], [1, ["복습 1"]]);
    assertEquals((await call(q, t, "personal_create_many", { study: "aws", round: "99주차", goals: [{ title: "x" }] })).error.code, "ROUND_NOT_FOUND");
    const dup = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "복습 4" }, { title: " 복습 4 " }] });
    assertEquals([dup.data.count, dup.data.skipped], [1, ["복습 4"]]);   // 입력 안 중복도 건너뜀
    const cur = await call(q, t, "personal_create_many", { study: "aws", goals: [{ title: "현재 회차" }] });   // 기본 = current
    assertEquals(cur.data.round.label, "2주차");
    const au = await one(q, "select summary from public.api_audit where op = 'personal_create_many' and ok order by id desc limit 1");
    assertEquals(au.summary.createdIds, cur.data.createdIds);
    // 경고에는 한국어 message 〔C#9〕
    const w = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "밖", startDate: "2026-10-16", endDate: "2026-10-17" }] });
    assertEquals(w.data.warnings.map((x: Row) => [x.code, typeof x.message]), [["PERIOD_OUTSIDE_PARENT", "string"]]);
  } },
  { name: "personal_create_many 입력 검증: 0개·21개·모르는 키·객체 아님 → VALIDATION_FAILED · 잘못된 날짜 VALIDATION_FAILED", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const code = async (goals: unknown) => (await call(q, t, "personal_create_many", { study: "aws", round: 2, goals })).error?.code;
    assertEquals(await code([]), "VALIDATION_FAILED");
    assertEquals(await code(Array.from({ length: 21 }, (_, i) => ({ title: "g" + i }))), "VALIDATION_FAILED");
    assertEquals(await code([{ title: "x", owner: "철수" }]), "VALIDATION_FAILED");
    assertEquals(await code(["x"]), "VALIDATION_FAILED");
    assertEquals(await code(null), "VALIDATION_FAILED");
    assertEquals(await code([{ title: "x", endDate: "다음주" }]), "VALIDATION_FAILED");
  } },
  { name: "〔T5〕 personal_create_many 20개 한 번에(성능 기록)", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const t0 = performance.now();
    const r = await call(q, t, "personal_create_many", { study: "aws", round: 3, goals: Array.from({ length: 20 }, (_, i) => ({ title: "목표 " + i })) });
    const ms = Math.round(performance.now() - t0);
    console.log(`personal_create_many 20개: ${ms}ms (PGlite)`);
    assertEquals([r.data.count, r.data.remaining], [20, 0]);
    assertEquals((await call(q, t, "personal_create_many", { study: "aws", round: 3, goals: [{ title: "21번째" }] })).error.code, "PERSONAL_LIMIT_EXCEEDED");
  } },
  { name: "〔C#2〕 전부 중복이어도 자격·방 상태를 본다: INACTIVE 도윤의 재시도 → NOT_ACTIVE_MEMBER(예전 판은 skipped 로 성공)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const doyun = await uidOf(q, "도윤");   // 시드: aws INACTIVE
    await q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
             select $1::bigint, n.id, n.id, 3, 99, '떠나기 전 목표', n.start_date, n.end_date, 'PERSONAL', $3::uuid from public.goal_nodes n where n.id = $2::bigint`,
            [aws, r2, doyun]);
    const t = await tokenFor(q, "도윤");
    const r = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "떠나기 전 목표" }] });
    assertEquals([r.ok, r.error.code], [false, "NOT_ACTIVE_MEMBER"]);
    // 방 상태도: ENDED 방이면 전부 중복이어도 ROOM_NOT_EDITABLE
    const j = await tokenFor(q, "지은");
    await call(q, j, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "끝나기 전" }] });
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    assertEquals((await call(q, j, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "끝나기 전" }] })).error.code, "ROOM_NOT_EDITABLE");
  } },
  { name: "〔N3〕 잠금 순서(정적): api_invoke 의 apply 는 사용자 잠금 → 방 잠금 → replay 판정 → api_rate_check", run: async (q) => {
    const src = (await one(q, "select prosrc from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'api_invoke'")).prosrc as string;
    const at = (needle: string) => src.indexOf(needle);
    assert(at("api_user_lock(") >= 0 && at("api_user_lock(") < at("room_lock(") && at("room_lock(") < at("applied_at is not null")
           && at("applied_at is not null") < at("api_rate_check("), "user → room → replay → rate");
    // 감사 insert 는 레이트리밋과 같은 함수(같은 트랜잭션) — 예외 블록 밖, 반환 전
    assert(at("api_rate_check(") < at("insert into public.api_audit") && at("exception when others") < at("insert into public.api_audit"));
  } },
  { name: "〔C#2〕 잠금 순서(정적): personal_*_many 는 personal_room(방 잠금)이 중복·제출·소유 검사보다 먼저", run: async (q) => {
    const src = async (fn: string) => (await one(q, "select prosrc from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1", [fn])).prosrc as string;
    const c = await src("personal_create_many");
    assert(c.indexOf("personal_room(") >= 0 && c.indexOf("personal_room(") < c.indexOf("personal_eligible(") && c.indexOf("personal_eligible(") < c.indexOf("trim(n.title)"));
    const d = await src("personal_delete_many");
    assert(d.indexOf("personal_room(") >= 0 && d.indexOf("personal_room(") < d.indexOf("public.submissions") && d.indexOf("personal_room(") < d.indexOf("owner_id"));
  } },
  { name: "〔D16〕 personal_delete_many: 내 것만 · 남의 것 섞이면 전부 실패", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const c = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "지울 것 1" }, { title: "지울 것 2" }] });
    const mine = c.data.createdIds as string[];
    const other = await tokenFor(q, "철수");   // aws ACTIVE 멤버
    const o = await call(q, other, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "철수 것" }] });
    const mixed = await call(q, t, "personal_delete_many", { study: "aws", ids: [mine[0], o.data.createdIds[0]] });
    assertEquals([mixed.ok, mixed.error.code], [false, "NOT_OWNER"]);
    assertEquals((await q("select 1 from public.goal_nodes where id = $1::bigint", [mine[0]])).length, 1);
    const team = await call(q, t, "personal_delete_many", { study: "aws", ids: [await nodeId(q, "aws", "VPC 실습")] });   // 팀 노드 = 이 방의 개인 목표 아님
    assertEquals([team.ok, team.data.deleted, team.data.skipped.length], [true, 0, 1]);
    const d = await call(q, t, "personal_delete_many", { study: "aws", ids: mine });
    assertEquals([d.ok, d.data.deleted], [true, 2]);
    const au = await one(q, "select summary from public.api_audit where op = 'personal_delete_many' order by id desc limit 1");
    assertEquals([au.summary.ids, au.summary.deleted], [mine, 2]);
  } },
  { name: "〔C#1·#13〕 제출 있는 목표: 실제로 완료(제출)한 뒤 삭제 → NODE_HAS_SUBMISSIONS · 목표·제출 그대로", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const c = await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "끝낸 목표" }] });
    const id = c.data.createdIds[0] as string;
    await as(q, "지은");
    await q("select public.personal_complete('aws', $1::bigint, true)", [id]);   // 웹 경로 그대로 제출 행 생성
    await asAnon(q);
    assertEquals((await q("select 1 from public.submissions where node_id = $1::bigint", [id])).length, 1);
    const r = await call(q, t, "personal_delete_many", { study: "aws", ids: [id] });
    assertEquals([r.ok, r.error.code], [false, "NODE_HAS_SUBMISSIONS"]);
    assertEquals((await q("select 1 from public.goal_nodes where id = $1::bigint", [id])).length, 1);
    assertEquals((await q("select 1 from public.submissions where node_id = $1::bigint", [id])).length, 1);
  } },
  { name: "〔C#10〕 삭제 멱등: 같은 id 두 번 → 1개 삭제 · 다시 호출 → deleted 0 + skipped(성공) · 1~20개", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const id = (await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "한 번만" }] })).data.createdIds[0] as string;
    const a = await call(q, t, "personal_delete_many", { study: "aws", ids: [id, id] });
    assertEquals([a.ok, a.data.deleted, a.data.skipped], [true, 1, []]);
    const b = await call(q, t, "personal_delete_many", { study: "aws", ids: [id] });
    assertEquals([b.ok, b.data.deleted, b.data.skipped], [true, 0, [id]]);
    assertEquals((await call(q, t, "personal_delete_many", { study: "aws", ids: [] })).error.code, "VALIDATION_FAILED");
    assertEquals((await call(q, t, "personal_delete_many", { study: "aws", ids: [null] })).error.code, "VALIDATION_FAILED");
    assertEquals((await call(q, t, "personal_delete_many", { study: "aws", ids: [Number(id)] })).data.skipped, [id]);   // 숫자 id 도
  } },
  { name: "로그인 세션 + 토큰 동시 → API_AUTH_CONFLICT · 세션만(p_token null) → source SESSION · 세션 경로도 감사", run: async (q) => {
    const t = await tokenFor(q, "민수");
    await as(q, "민수");
    await expectFail(q("select public.api_invoke($1, 'whoami', '{}'::jsonb)", [t]), "API_AUTH_CONFLICT");
    await expectFail(q("select public.api_invoke('garbage', 'whoami', '{}'::jsonb)"), "API_AUTH_CONFLICT");   // 형식과 무관하게 먼저
    const w = (await one(q, "select public.api_invoke(null, 'whoami', '{}'::jsonb) as r")).r as Row;
    assertEquals([w.data.source, w.data.tokenName, w.meta], ["session", null, {}]);
    const s = (await one(q, "select public.api_invoke(null, 'me_studies', '{}'::jsonb) as r")).r as Row;
    assertEquals(s.ok, true);
    const a = await one(q, "select source, token_id from public.api_audit order by id desc limit 1");
    assertEquals([a.source, a.token_id], ["SESSION", null]);
    await expectFail(q("select public.api_invoke(null, 'nope', '{}'::jsonb)"), "API_UNKNOWN_OP");
    await asAnon(q);
    await expectFail(q("select public.api_invoke(null, 'whoami', '{}'::jsonb)"), "AUTH_REQUIRED");
  } },
  { name: "내부 오류 원문 비노출: 형식 오류 → VALIDATION_FAILED · 감사 요약에 토큰 원문 없음", run: async (q) => {
    const t = await tokenFor(q, "지은");
    const r = await call(q, t, "personal_delete_many", { study: "aws", ids: ["abc"] });
    assertEquals([r.ok, r.error.code], [false, "VALIDATION_FAILED"]);
    assertEquals(JSON.stringify(r).includes("bigint"), false);
    assertEquals((await call(q, t, "me_studies", { includeEnded: "가끔" })).error.code, "VALIDATION_FAILED");
    await call(q, t, "personal_create_many", { study: "aws", round: 2, goals: [{ title: t }] });   // 토큰을 제목으로 보내도
    const rows = await q("select summary::text as s, coalesce(error_code, '') as e from public.api_audit");
    assert(rows.length >= 3);
    assert(rows.every((x) => !(x.s as string).includes("sgt_pat_") && !(x.e as string).includes("sgt_pat_")), "감사에 토큰 원문");
  } },
  { name: "api_error_json: P0001 코드·문구·details(객체만) · 형식 오류 VALIDATION_FAILED · 그 밖 INTERNAL", run: async (q) => {
    const e = async (s: string, c: string, d: string | null, h: string | null) =>
      (await one(q, "select public.api_error_json($1, $2, $3, $4) as j", [s, c, d, h])).j as Row;
    assertEquals(await e("P0001", "NOT_OWNER", "본인 것만", '{"nodeId":"1"}'), { code: "NOT_OWNER", message: "본인 것만", details: { nodeId: "1" } });
    assertEquals(await e("P0001", "NOT_OWNER", null, "{}"), { code: "NOT_OWNER", message: "NOT_OWNER" });
    assertEquals(await e("P0001", "NOT_OWNER", "x", "not json"), { code: "NOT_OWNER", message: "x" });
    assertEquals((await e("P0001", "duplicate key value violates", "x", null)).code, "INTERNAL");
    assertEquals((await e("22P02", "invalid input syntax for type bigint", null, null)).code, "VALIDATION_FAILED");
    assertEquals(await e("23505", "duplicate key", "Key (id)=(1)", null), { code: "INTERNAL", message: "처리 중 오류가 났어요" });
  } },
  { name: "GRANT · GUC 를 쓰는 함수는 api_authenticate 하나", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    assertEquals([await can("anon", "public.api_invoke(text, text, jsonb)"), await can("authenticated", "public.api_invoke(text, text, jsonb)")], [true, true]);
    for (const fn of ["public.personal_create_many(text, jsonb, jsonb)", "public.personal_delete_many(text, jsonb)",
                      "public.api_resolve_study(uuid, text)", "public.api_studies(uuid, boolean)", "public.api_node_file_counts(bigint)",
                      "public.api_curriculum_view(jsonb, uuid)", "public.api_error_json(text, text, text, text)",
                      "public.api_authenticate(text, text)", "public.api_user_lock(uuid)", "public.api_rate_check(uuid, uuid, text, boolean, boolean)"]) {
      assertEquals([await can("anon", fn), await can("authenticated", fn)], [false, false], fn);
    }
    const fns = await q(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                         where s.nspname = 'public' and p.prosrc ilike '%set_config(''sgtudy.api_uid''%'`);
    assertEquals(fns.map((f) => f.proname), ["api_authenticate"]);
    const all = await q(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                         where s.nspname = 'public' and p.prosrc ilike '%sgtudy.api_uid%' order by 1`);
    assertEquals(all.map((f) => f.proname), ["api_authenticate", "current_user_id"]);   // 읽는 곳 1 · 쓰는 곳 1
  } },
  { name: "api_invoke 속성: security definer · search_path '' · statement_timeout 15s", run: async (q) => {
    const p = await one(q, `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                            where s.nspname = 'public' and p.proname = 'api_invoke'`);
    assertEquals(p.prosecdef, true);
    assertEquals([...(p.proconfig as string[])].sort(), ['search_path=""', "statement_timeout=15s"]);
  } },
  { name: "〔C#9·N6〕 응답 계약 스냅숏(src/lib/mcp/__fixtures__/api-contract.json)", run: async (q) => {
    const data = await contractData(q);
    checkIntegrity(data);
    if (Deno.env.get("UPDATE_CONTRACT") === "1") {
      await Deno.mkdir(FIXTURE_DIR, { recursive: true });
      await Deno.writeTextFile(FIXTURE, JSON.stringify(data, null, 2) + "\n");
      console.log("api-contract.json 갱신");
    } else {
      const saved = JSON.parse(await Deno.readTextFile(FIXTURE));
      checkIntegrity(saved);
      assertEquals(shapeOf(data), shapeOf(saved), "SQL 응답 모양이 계약과 다르다 — UPDATE_CONTRACT=1 로 갱신하고 vitest(contract.test.ts)를 다시 돌린다");
    }
  } },
]);

// ───────── 응답 계약(〔C#9·N6〕) ─────────
const FIXTURE_DIR = new URL("../../src/lib/mcp/__fixtures__/", import.meta.url);
const FIXTURE = new URL("api-contract.json", FIXTURE_DIR);

async function contractData(q: Q): Promise<Row> {
  const r4 = await nodeId(q, "aws", "오토스케일링");
  const minsu = await tokenFor(q, "민수");
  const jieun = await tokenFor(q, "지은");
  const cheolsu = await tokenFor(q, "철수");
  await call(q, cheolsu, "personal_create_many", { study: "aws", round: 2, goals: [{ title: "철수 목표" }] });
  const personal = (await call(q, jieun, "personal_create_many",
    { study: "aws", round: 2, goals: [{ title: "지은 목표" }, { title: "지은 목표 2", startDate: "2026-10-15", endDate: "2026-10-16" }, { title: "지은 목표" }] })).data;
  const curriculum = (await call(q, jieun, "curriculum_get", { study: "aws" })).data;
  const plan = { schema: "sgtudy.plan/v1", ops: [
    { op: "create", parent: r4, title: "계약 새 과제", taskType: "designated", assignees: ["지은"] },
    { op: "update", id: await nodeId(q, "aws", "Auto Scaling 정책 정리"), set: { endDate: "2026-10-30" } },   // 회차 밖 → 경고
    { op: "move", id: await nodeId(q, "aws", "DynamoDB 설계 퀴즈"), parent: r4, index: 0 },
    { op: "shift", from: "5주차", days: 7 },
  ] };
  const preview = (await call(q, minsu, "curriculum_plan_preview", { study: "aws", plan })).data;
  const apply = (await call(q, minsu, "curriculum_plan_apply", { previewId: preview.previewId })).data;
  const undoPreview = (await call(q, minsu, "curriculum_plan_preview", { study: "aws", undo: preview.previewId })).data;
  const remove = (await call(q, jieun, "personal_delete_many", { study: "aws", ids: [personal.createdIds[0], "999999999"] })).data;
  const studies = (await call(q, jieun, "me_studies")).data;
  const whoami = (await call(q, jieun, "whoami")).data;
  const schedule = (await call(q, jieun, "me_schedule", { from: "2026-10-12", to: "2026-10-25" })).data;
  assertEquals([preview.ok, apply.applied, undoPreview.ok], [true, true, true]);
  return normalize({ whoami, me_studies: studies, me_schedule: schedule, curriculum_get: curriculum, curriculum_plan_preview: preview,
                     curriculum_plan_apply: apply, curriculum_plan_preview_undo: undoPreview, personal_create_many: personal, personal_delete_many: remove });
}

// 결정적 일대일 치환: 키 정렬 깊이 우선, 처음 본 순서대로. 같은 원래 값 → 같은 치환값(참조 보존)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T/;
const ID_KEYS = new Set(["id", "parent", "parentId", "roundId", "nodeId", "createdId", "currentRoundId"]);
const ID_ARRAYS = new Set(["createdIds", "skipped", "nodeIds", "ids"]);
const MAP_KEYS = new Set(["fileCounts"]);
function normalize(v: unknown): Row {
  const u = new Map<string, string>(), n = new Map<string, string>(), p = new Map<string, string>();
  const sub = (m: Map<string, string>, s: string, f: (i: number) => string) => { if (!m.has(s)) m.set(s, f(m.size + 1)); return m.get(s)!; };
  const nid = (s: string) => sub(n, s, (i) => "n" + i);
  const str = (s: string, key: string | null, inIdArray: boolean): string => {
    if (UUID.test(s)) return sub(u, s, (i) => "u" + i);
    if (/^pv_[0-9a-f]{12}$/.test(s)) return sub(p, s, (i) => "pv_" + String(i).padStart(12, "0"));
    if (key === "version") return "v".repeat(32);
    if (ISO.test(s)) return "2026-01-01T00:00:00.000Z";
    if (/^[0-9]+$/.test(s) && ((key && ID_KEYS.has(key)) || inIdArray)) return nid(s);
    return s;
  };
  const walk = (x: unknown, key: string | null, inIdArray = false): unknown => {
    if (typeof x === "string") return str(x, key, inIdArray);
    if (Array.isArray(x)) return x.map((e) => walk(e, key, key !== null && ID_ARRAYS.has(key)));
    if (x && typeof x === "object") {
      const o = x as Row;
      const out: Row = {};
      for (const k of Object.keys(o).sort()) {
        if (key && MAP_KEYS.has(key)) out[/^[0-9]+$/.test(k) ? nid(k) : k] = walk(o[k], null);
        else if (key === "refs") out[k] = typeof o[k] === "string" ? nid(o[k]) : walk(o[k], k);
        else out[k] = walk(o[k], k);
      }
      return out;
    }
    return x;
  };
  return walk(v, null) as Row;
}

// 종류별 모양: 배열은 모든 원소를 판별자별로 합집합. 동적 키 객체(fileCounts·refs)는 값 모양만
type Shape = string | { [k: string]: Shape };
function disc(e: unknown): string {
  if (!e || typeof e !== "object" || Array.isArray(e)) return typeof e;
  const o = e as Row;
  if (typeof o.op === "string") return "op:" + o.op;
  if ("task" in o && "depth" in o) {
    if (!o.task) return o.parentId ? "node:bundle" : "node:round";
    return "node:" + o.task.type + (o.task.type === "personal" ? ":mine=" + o.isMine : "");
  }
  if (typeof o.kind === "string") return "kind:" + o.kind;
  return "*";
}
function merge(a: Shape | undefined, b: Shape): Shape {
  if (a === undefined) return b;
  if (typeof a === "string" || typeof b === "string") {
    if (typeof a === "string" && typeof b === "string") return [...new Set([...a.split("|"), ...b.split("|")])].sort().join("|");
    return typeof a === "string" ? (a === "null" ? b : a + "|object") : (b === "null" ? a : b + "|object");
  }
  const out: { [k: string]: Shape } = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(out[k], b[k]);
  return out;
}
function shapeOf(v: unknown, key: string | null = null): Shape {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    const g: { [k: string]: Shape } = {};
    for (const e of v) { const d = disc(e); g[d] = merge(g[d], shapeOf(e)); }
    return { "[]": Object.keys(g).length ? sortShape(g) : "empty" };
  }
  if (typeof v === "object") {
    const o = v as Row;
    if (key && (MAP_KEYS.has(key) || key === "refs" || key === "sched")) {
      let m: Shape | undefined;
      for (const k of Object.keys(o)) m = merge(m, shapeOf(o[k]));
      return { "{}": m ?? "empty" };
    }
    const out: { [k: string]: Shape } = {};
    for (const k of Object.keys(o).sort()) out[k] = shapeOf(o[k], k);
    return out;
  }
  return typeof v;
}
function sortShape(s: { [k: string]: Shape }) {
  const out: { [k: string]: Shape } = {};
  for (const k of Object.keys(s).sort()) out[k] = s[k];
  return out;
}
function checkIntegrity(d: Row) {
  const nodes = d.curriculum_get.nodes as Row[];
  const ids = new Set(nodes.map((x) => x.id));
  for (const x of nodes) {
    if (x.parentId !== null) assert(ids.has(x.parentId), "parentId " + x.parentId);
    if (x.roundId !== null) assert(ids.has(x.roundId), "roundId " + x.roundId);
  }
  assert(Object.keys(d.curriculum_get.fileCounts).every((k) => ids.has(k)), "fileCounts ⊂ nodes");
  assert(ids.has(d.curriculum_get.currentRoundId), "currentRoundId");
  const kinds = new Set(nodes.map(disc));
  for (const k of ["node:round", "node:bundle", "node:common", "node:designated", "node:personal:mine=true", "node:personal:mine=false"]) assert(kinds.has(k), k);
  assertEquals(new Set((d.curriculum_plan_preview.diff as Row[]).map((x) => x.op)), new Set(["create", "update", "move"]));
  assertEquals(new Set((d.curriculum_plan_preview_undo.diff as Row[]).map((x) => x.op)), new Set(["restore"]));
  assert((d.curriculum_plan_preview.warnings as Row[]).length > 0 && (d.curriculum_plan_preview.warnings as Row[]).every((w) => typeof w.message === "string"));
  const created = new Set(d.curriculum_plan_apply.createdIds as string[]);
  assert(Object.values(d.curriculum_plan_apply.refs as Row).every((v) => created.has(v)), "refs ⊂ createdIds");
  assert((d.personal_create_many.skipped as string[]).length === 1 && (d.personal_delete_many.skipped as string[]).length === 1);
  assert(!JSON.stringify(d).match(/[0-9a-f]{8}-[0-9a-f]{4}-/i), "uuid 남음");
}

// ───────── 마이그레이션 원문 · 트랜잭션 경계 ─────────
Deno.test("마이그레이션 원문: sgtudy.api_uid 를 set_config 하는 곳은 0033 api_authenticate 뿐", async () => {
  const dir = new URL("../migrations/", import.meta.url);
  const hits: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(e.name, dir));
    if (/set_config\(\s*'sgtudy\.api_uid'\s*,\s*t\.user_id/i.test(sql)) hits.push(e.name);
    else if (/set_config\(\s*'sgtudy\.api_uid'/i.test(sql)) hits.push(`${e.name}:OTHER`);
  }
  assertEquals(hits, ["0033_api_tokens.sql"]);
});

// 〔C#13〕 cases() 는 사례마다 begin…rollback 한 트랜잭션이라 "다음 트랜잭션에서 GUC 가 비는지" 를 볼 수 없다 → 별도 DB 로 커밋 경계를 실제로 만든다
Deno.test({ name: "트랜잭션 경계: api_invoke 가 남긴 sgtudy.api_uid 는 커밋 뒤 다음 트랜잭션에서 비어 있다", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const g = await openDb();
  await applySeed(g);
  const q = makeQ(g);
  await g.exec("begin");
  await setToday(q, "2026-10-12");
  await asUser(q, await uidOf(q, "민수"));
  const t = ((await q("select public.pat_create('guc', '{read}', 90) as t"))[0].t as Row).token as string;
  await g.exec("commit");
  await g.exec("begin");
  await asAnon(q);
  assertEquals(((await q("select public.api_invoke($1, 'whoami', '{}'::jsonb) as r", [t]))[0].r as Row).ok, true);
  assertEquals((await q("select public.current_user_id()::text as u"))[0].u, await uidOf(q, "민수"));   // 같은 트랜잭션 안에서는 유지
  await g.exec("commit");
  await g.exec("begin");
  assertEquals((await q("select nullif(current_setting('sgtudy.api_uid', true), '') as v"))[0].v, null);
  assertEquals((await q("select public.current_user_id() as u"))[0].u, null);                         // 다음 트랜잭션 = 신원 없음
  await expectFail(q("select public.api_invoke(null, 'whoami', '{}'::jsonb)"), "AUTH_REQUIRED");
  await g.exec("rollback");
  await g.close();
} });
