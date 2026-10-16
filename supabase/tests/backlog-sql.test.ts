// 0013 백로그 수정 — 자동 태그 재선택 조건, 한글 slug, 기간 상한, 알림 본문, deactivate·수동 시작 알림, ASCII 태그 경계
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const tagsOf = async (q: Q, slug: string) =>
  (await q("select rt.tag_slug as slug, rt.source from public.room_tags rt join public.rooms r on r.id = rt.room_id where r.slug = $1 order by rt.tag_slug", [slug]))
    .map((x) => `${x.slug}:${x.source}`);
const upd = (q: Q, slug: string, node: string, patch: unknown) =>
  q("select public.node_update($1, $2::bigint, $3::jsonb)", [slug, node, JSON.stringify(patch)]);
/** aws 1주차 아래에 리프 하나를 직접 넣는다(태그 용어가 없는 제목) */
const addLeaf = async (q: Q, title: string) => {
  const r = await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                          select rd.room_id, rd.id, rd.id, 3, 99, $1, rd.start_date, rd.end_date, 'COMMON'
                          from public.goal_nodes rd join public.rooms r on r.id = rd.room_id
                          where r.slug = 'aws' and rd.depth = 2 and rd.label = '1주차' returning id::text as id`, [title]);
  return r.id as string;
};
const create = (q: Q, title: string, s = "2026-11-01", e = "2026-11-28") =>
  one(q, "select public.room_create($1, '소개', $2::date, $3::date, 4, true, 'direct') as d", [title, s, e]).then((r) => r.d);

cases("backlog", db, [
  // ───────── 1. 자동 태그 재선택 ─────────
  { name: "tags: node title save re-runs autoselect only when the old or new title mentions a curated term", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const leaf = await addLeaf(q, "테스트 과제");
    // 시드 태그와 자동 선택 결과가 어긋난 상태를 만든다(QA Q3-22: 무관한 저장이 #데이터 를 붙였다)
    await q("delete from public.room_tags where room_id = $1::bigint and source = 'AUTO'", [await roomId(q, "aws")]);
    const before = await tagsOf(q, "aws");
    await upd(q, "aws", leaf, { title: "QA3 테스트 과제" });                 // 용어 없음 → 그대로
    assertEquals(await tagsOf(q, "aws"), before);
    await upd(q, "aws", leaf, { descriptionMd: "설명만 고침 docker" });      // 설명은 점수에 안 쓰인다 → 그대로
    assertEquals(await tagsOf(q, "aws"), before);
    await upd(q, "aws", leaf, { title: "QA3 테스트 과제" });                 // 같은 제목 → 그대로
    assertEquals(await tagsOf(q, "aws"), before);
    await upd(q, "aws", leaf, { title: "도커 실습" });                       // 새 제목이 용어 → 다시 고른다
    const after = await tagsOf(q, "aws");
    assert(after.includes("docker:AUTO"), JSON.stringify(after));
    assert(after.includes("certificate:MANUAL"), JSON.stringify(after));     // MANUAL 은 그대로
    await upd(q, "aws", leaf, { title: "실습 정리" });                       // 옛 제목이 용어 → 다시 고른다(도커 빠짐)
    assert(!(await tagsOf(q, "aws")).includes("docker:AUTO"));
  } },

  { name: "tags: autoselect never turns a MANUAL tag into AUTO nor removes it", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await q("select public.room_tags_put('aws', array['docker','aws']::text[], '{}'::text[])");
    const leaf = await addLeaf(q, "도커 실습");
    await upd(q, "aws", leaf, { title: "쿠버네티스 실습" });
    const t = await tagsOf(q, "aws");
    assert(t.includes("docker:MANUAL") && t.includes("aws:MANUAL"), JSON.stringify(t));
  } },

  // ───────── 5c. ASCII 부분 일치 ─────────
  { name: "tag_term_hit: ASCII terms ≥3 chars must not be a prefix of a longer word (java ⊄ JavaScript)", run: async (q) => {
    const hit = async (t: string, term: string) => (await one(q, "select public.tag_term_hit($1, $2) as v", [t, term])).v;
    assertEquals(await hit("JavaScript 기초", "java"), false);
    assertEquals(await hit("Java 17 문법", "java"), true);
    assertEquals(await hit("Java로 배우는 자료구조", "java"), true);          // 한글 조사는 경계
    assertEquals(await hit("MySQL 튜닝", "sql"), true);                      // 앞쪽 결합(My·Postgre)은 허용
    assertEquals(await hit("SAA-C03 합격까지", "saa"), true);
    assertEquals(await hit("react.dev 공식 문서", "react.dev"), true);       // 정규식 메타문자 이스케이프
    assertEquals(await hit("reactdev", "react.dev"), false);
    assertEquals(await hit("Reactive 프로그래밍", "react"), false);
    assertEquals(await hit("AWS docs 읽기", "cs"), false);                   // 기존 2자 규칙 유지
  } },

  // ───────── 2. slug ─────────
  { name: "slugify: Hangul is romanized; emoji-only falls back to r-<base36 id>; reserved 'new' avoided", run: async (q) => {
    const s = async (t: string, id = 7) => (await one(q, "select public.slugify($1, $2::bigint) as s", [t, id])).s;
    assertEquals(await s("AWS SAA 자격증 3개월 완주"), "aws-saa-jagyeokjeung-3gaewol-wanju");
    assertEquals(await s("스프링 핵심 원리"), "seupeuring-haeksim-wonri");
    assertEquals(await s("🚀 큐에이 스프링"), "kyuei-seupeuring");
    assertEquals(await s("5년짜리 스터디"), "5nyeonjjari-seuteodi");
    assertEquals(await s("🚀🔥", 36), "r-10");
    assertEquals(await s("  Docker---Compose!! "), "docker-compose");
    assert(String(await s("가나다라마바사아자차카타파하 ".repeat(5))).length <= 50);
    await setToday(q, "2026-10-12");
    await asUser(q, await uidOf(q, "민수"));
    const a = await create(q, "New");
    assertEquals(a.slug, "new-2");                                          // /rooms/new 라우트와 겹치지 않게
    const b = await create(q, "스프링 핵심 원리");
    const c = await create(q, "스프링 핵심 원리");
    assertEquals([b.slug, c.slug], ["seupeuring-haeksim-wonri", "seupeuring-haeksim-wonri-2"]);
  } },

  // ───────── 3. 기간 상한 ─────────
  { name: "period: room_create / room_update reject periods longer than 1 year (PERIOD_TOO_LONG on endDate)", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(create(q, "5년짜리 스터디", "2026-10-20", "2031-12-31"), "PERIOD_TOO_LONG");
    await expectFail(create(q, "1년+1일", "2026-11-01", "2027-11-01"), "PERIOD_TOO_LONG");
    const ok = await create(q, "꽉 찬 1년", "2026-11-01", "2027-10-31");
    assertEquals(ok.endDate, "2027-10-31");
    await expectFail(q("select public.room_update($1, $2::jsonb)", [ok.slug, '{"endDate":"2027-11-01"}']), "PERIOD_TOO_LONG");
    await expectFail(q("select public.room_update($1, $2::jsonb)", [ok.slug, '{"startDate":"2026-10-20"}']), "PERIOD_TOO_LONG");
    const r = (await one(q, "select public.room_update($1, $2::jsonb) as r", [ok.slug, '{"startDate":"2026-11-02","endDate":"2027-11-01"}'])).r;
    assertEquals(r.endDate, "2027-11-01");
    const err = await create(q, "x", "2026-11-01", "2028-01-01").then(() => null, (e) => e as Error & { detail?: string; hint?: string });
    assertEquals(err?.detail, "기간은 최대 1년이에요");
    assertEquals(JSON.parse(err?.hint ?? "{}").field, "endDate");
  } },

  // ───────── 4. 알림 본문 ─────────
  { name: "notify_render: body never repeats the room title (task → null, round → round title, schedule → task + dates)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const round3 = await nodeId(q, "aws", "고가용성 아키텍처");
    const r = async (kind: string, node: string | null, model = "{}") =>
      (await one(q, "select public.notify_render($1, $2::bigint, $3::bigint, null, $4::jsonb) as t", [kind, aws, node, model])).t;
    for (const k of ["TASK_ALL_SUBMITTED", "DEADLINE_REMINDER", "TASK_ASSIGNED", "TASK_UNASSIGNED"]) {
      assertEquals((await r(k, ec2)).body, null, k);
    }
    assertEquals((await r("ROUND_STARTED", round3)).body, "고가용성 아키텍처");
    assertEquals((await r("SCHEDULE_CHANGED", ec2, '{"startDate":"2026-10-13","endDate":"2026-10-19"}')).body,
                 '"EC2 인스턴스 유형 정리" 10.13 – 10.19');
    assertEquals((await r("ROOM_STARTED", null)).body, null);
    const seeded = await q("select n.body from public.notifications n join public.rooms rm on rm.id = n.room_id where n.body = rm.title");
    assertEquals(seeded.length, 0);                                          // 시드·백필 후 방 제목 본문 없음
  } },

  // ───────── 5a. deactivate → TASK_ALL_SUBMITTED ─────────
  { name: "member_deactivate: a task that becomes all-submitted notifies the leader in IMMEDIATE mode", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");   // 지은 제출, 철수 미제출
    await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = $1::bigint", [await roomId(q, "aws")]);
    await asUser(q, minsu);
    await q("select public.member_deactivate('aws', $1::uuid, $2::jsonb)", [cheolsu, JSON.stringify([{ nodeId: ec2, action: "exclude" }])]);
    const rows = await q("select node_id::text as node from public.notifications where user_id = $1::uuid and kind = 'TASK_ALL_SUBMITTED' and created_at >= now()", [minsu]);
    assert(rows.some((x) => x.node === ec2), JSON.stringify(rows));
    const already = await q(`select count(*)::int as n from public.notifications where user_id = $1::uuid and kind = 'TASK_ALL_SUBMITTED'
                             and created_at >= now() and node_id not in (select ls.node_id from public.room_leaf_stats($2::bigint) ls where ls.asg > 0 and ls.sub = ls.asg)`,
                            [minsu, await roomId(q, "aws")]);
    assertEquals(already[0].n, 0);                                           // 전원 제출이 아닌 과제는 알리지 않는다
  } },

  { name: "member_deactivate: DAILY_DIGEST mode does not notify immediately; already-complete tasks are not re-notified", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, minsu);
    await q("select public.member_deactivate('aws', $1::uuid, $2::jsonb)", [cheolsu, JSON.stringify([{ nodeId: ec2, action: "exclude" }])]);
    assertEquals((await q("select 1 from public.notifications where user_id = $1::uuid and kind = 'TASK_ALL_SUBMITTED' and created_at >= now()", [minsu])).length, 0);
  } },

  // ───────── 5b. 수동 시작 당일 회차 ─────────
  { name: "room_start on a round's first day publishes ROUND_STARTED (same natural key as the job → no duplicate)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    await setToday(q, "2026-10-12");
    await asUser(q, minsu);
    const d = await create(q, "수동 시작 Manual", "2026-10-14", "2026-11-08");
    const rd = await one(q, `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
                             values ($1::bigint, null, 2, 0, '1주차', '첫 주', '2026-10-12', '2026-10-18') returning id::text as id`, [d.id]);
    await q("update public.goal_nodes set round_id = id where id = $1::bigint", [rd.id]);
    await q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
             values ($1::bigint, $2::bigint, $2::bigint, 3, 0, 't', '2026-10-12', '2026-10-18', 'COMMON')`, [d.id, rd.id]);
    await q("select public.room_open_recruit($1)", [d.slug]);
    await asUser(q, cheolsu);
    await q("select public.room_join($1)", [d.slug]);
    await asUser(q, minsu);
    await q("select public.room_start($1)", [d.slug]);
    const rs = await q("select user_id::text as u, dedupe_key from public.notifications where kind = 'ROUND_STARTED' and node_id = $1::bigint order by user_id", [rd.id]);
    assertEquals(rs.map((x) => x.u).sort(), [minsu, cheolsu].sort());       // 그룹장(시작한 사람)도 받는다 — 상태 이벤트
    assertEquals(rs[0].dedupe_key.startsWith(`ROUND_STARTED:${d.id}:${rd.id}:`), true);
    await q("select public.job_round_started()");                            // 같은 날 잡은 중복을 만들지 않는다
    assertEquals((await q("select 1 from public.notifications where kind = 'ROUND_STARTED' and node_id = $1::bigint", [rd.id])).length, 2);
  } },
]);
