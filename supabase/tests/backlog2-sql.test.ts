// 0018 백로그 수정 — 이탈 전원 제출의 요약 알림, 노드 삭제·보관 후 자동 태그 재선택, 한글 태그 용어 뒤쪽 경계, 방 기간 변경 알림
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, makeQ, openDb, setToday, sqlTest } from "./_harness.ts";
import { cases, nodeId, one, roomId, TODAY, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const tagsOf = async (q: Q, slug: string) =>
  (await q("select rt.tag_slug as slug, rt.source from public.room_tags rt join public.rooms r on r.id = rt.room_id where r.slug = $1 order by rt.tag_slug", [slug]))
    .map((x) => `${x.slug}:${x.source}`);
const hit = async (q: Q, text: string, term: string) => (await one(q, "select public.tag_term_hit($1, $2) as v", [text, term])).v as boolean;
/** 글이 맞히는 CURATED 태그 slug 목록(정렬) */
const tagsFor = async (q: Q, text: string) =>
  ((await one(q, `select coalesce(array_agg(distinct t.slug order by t.slug), '{}') as s
                  from public.tags t cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
                  where t.kind = 'CURATED' and public.tag_term_hit($1, x.term)`, [text])).s) as string[];
/** 용어 없는 제목·소개의 DRAFT 방 + 1주차 회차. leaf(title) 로 그 회차 아래 공통 리프를 넣는다 */
const tagRoom = async (q: Q) => {
  const d = (await one(q, "select public.room_create('테스트 방', '소개', '2026-11-01'::date, '2026-11-28'::date, 4, true, 'direct') as d")).d;
  const rd = await one(q, `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
                           values ($1::bigint, null, 2, 0, '1주차', '첫 주', '2026-11-01', '2026-11-07') returning id::text as id`, [d.id]);
  await q("update public.goal_nodes set round_id = id where id = $1::bigint", [rd.id]);
  let i = 0;
  const leaf = async (title: string) => (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
      values ($1::bigint, $2::bigint, $2::bigint, 3, $3, $4, '2026-11-01', '2026-11-07', 'COMMON') returning id::text as id`, [d.id, rd.id, i++, title])).id as string;
  return { slug: d.slug as string, id: d.id as string, round: rd.id as string, leaf };
};
const kstToday = async (q: Q) => (await one(q, "select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as d")).d as string;
const nextDay = (ymd: string) => new Date(Date.parse(ymd + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

cases("backlog2", db, [
  // ───────── 1. 요약 모드에서 이탈로 전원 제출 ─────────
  { name: "digest: member_deactivate that completes a task is counted in the next day's TASK_COMPLETION_DIGEST (DAILY_DIGEST mode)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");   // 지은 제출, 철수 미제출
    const openBefore = (await q("select node_id::text as n from public.room_leaf_stats($1::bigint) where asg > 0 and sub < asg", [aws])).map((x) => x.n);
    await asUser(q, minsu);
    await q("select public.member_deactivate('aws', $1::uuid, $2::jsonb)", [cheolsu, JSON.stringify([{ nodeId: ec2, action: "exclude" }])]);
    const doneNow = (await q("select node_id::text as n from public.room_leaf_stats($1::bigint) where asg > 0 and sub = asg", [aws])).map((x) => x.n);
    const completedByLeave = openBefore.filter((n) => doneNow.includes(n));
    assert(completedByLeave.includes(ec2), JSON.stringify(completedByLeave));
    assertEquals((await q("select 1 from public.notifications where user_id = $1::uuid and kind = 'TASK_ALL_SUBMITTED' and created_at >= now()", [minsu])).length, 0);

    // 이탈 당일(KST)의 다음 날 요약
    await setToday(q, nextDay(await kstToday(q)));
    await q("select public.job_completion_digest()");
    const d = await q("select title from public.notifications where user_id = $1::uuid and kind = 'TASK_COMPLETION_DIGEST' and room_id = $2::bigint and created_at >= now()", [minsu, aws]);
    assertEquals(d.map((x) => x.title), [`어제 ${completedByLeave.length}개 과제가 전원 제출됐어요`]);
    // 그다음 날에는 다시 세지 않는다
    await setToday(q, nextDay(nextDay(await kstToday(q))));
    await q("select public.job_completion_digest()");
    assertEquals((await q("select 1 from public.notifications where user_id = $1::uuid and kind = 'TASK_COMPLETION_DIGEST' and room_id = $2::bigint and created_at >= now()", [minsu, aws])).length, 1);
  } },

  { name: "digest: a released assignee who had submitted (seed 도윤) does not move the completion day", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const aws = await roomId(q, "aws");
    // 시드 기준: 이탈자 도윤은 IAM 에 released + 제출물. 아무 일도 없으면 내일 요약에 aws 는 없다
    await setToday(q, nextDay(await kstToday(q)));
    await q("select public.job_completion_digest()");
    assertEquals((await q("select 1 from public.notifications where user_id = $1::uuid and kind = 'TASK_COMPLETION_DIGEST' and room_id = $2::bigint and created_at >= now()", [minsu, aws])).length, 0);
  } },

  // ───────── 2. 삭제·보관·해제 후 자동 태그 ─────────
  { name: "tags: node_delete / node_archive / node_unarchive re-run autoselect only when a curated term is involved", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const { slug, id, leaf } = await tagRoom(q);
    const plain = await leaf("테스트 과제");
    const docker = await leaf("도커 실습");
    await leaf("쿠버네티스 맛보기");
    await q("select public.tag_autoselect($1::bigint)", [id]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO", "kubernetes:AUTO"]);
    // 자동 선택 결과와 어긋난 상태(수동 정리 흉내): 용어 없는 노드 조작은 그대로 둬야 한다
    await q("delete from public.room_tags where room_id = $1::bigint and tag_slug = 'kubernetes'", [id]);
    await q("select public.node_archive($1, $2::bigint)", [slug, plain]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO"]);
    await q("select public.node_unarchive($1, $2::bigint)", [slug, plain]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO"]);
    await q("select public.node_delete($1, $2::bigint)", [slug, plain]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO"]);

    await q("select public.node_archive($1, $2::bigint)", [slug, docker]);            // 도커가 빠진 채 재선택
    assertEquals(await tagsOf(q, slug), ["kubernetes:AUTO"]);
    await q("select public.node_unarchive($1, $2::bigint)", [slug, docker]);          // 되살리면 다시 붙는다
    assertEquals(await tagsOf(q, slug), ["docker:AUTO", "kubernetes:AUTO"]);
    await q("select public.room_tags_put($1, array['docker']::text[], '{}'::text[])", [slug]);   // docker MANUAL, kubernetes 억제
    await q("select public.node_delete($1, $2::bigint)", [slug, docker]);             // 지워도 MANUAL·억제는 그대로
    assertEquals(await tagsOf(q, slug), ["docker:MANUAL"]);
  } },

  { name: "tags: archiving / deleting a round re-selects when any team node in the subtree mentions a term", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const { slug, id, round, leaf } = await tagRoom(q);
    await leaf("쿠버네티스 맛보기");
    const r2 = await one(q, `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
                             values ($1::bigint, null, 2, 1, '2주차', '둘째 주', '2026-11-08', '2026-11-14') returning id::text as id`, [id]);
    await q("update public.goal_nodes set round_id = id where id = $1::bigint", [r2.id]);
    await q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
             values ($1::bigint, $2::bigint, $2::bigint, 3, 0, '도커 실습', '2026-11-08', '2026-11-14', 'COMMON')`, [id, r2.id]);
    await q("select public.tag_autoselect($1::bigint)", [id]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO", "kubernetes:AUTO"]);
    await q("select public.node_archive($1, $2::bigint)", [slug, round]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO"]);
    await q("select public.node_unarchive($1, $2::bigint)", [slug, round]);
    assertEquals(await tagsOf(q, slug), ["docker:AUTO", "kubernetes:AUTO"]);
    await q("select public.node_delete($1, $2::bigint)", [slug, r2.id]);
    assertEquals(await tagsOf(q, slug), ["kubernetes:AUTO"]);
  } },

  // ───────── 3. 한글 용어 뒤쪽 경계 ─────────
  { name: "tag_term_hit: Hangul terms need a trailing boundary — particles and study nouns allowed (자바 ⊄ 자바스크립트)", run: async (q) => {
    assertEquals(await hit(q, "자바스크립트 기초", "자바"), false);
    assertEquals(await hit(q, "자바 기초", "자바"), true);
    for (const t of ["자바를 배워요", "자바로 배우는 자료구조", "자바와 스프링", "자바의 정석", "자바에서는", "자바까지는", "자바·코틀린", "자바(Java)", "자바!"]) {
      assertEquals(await hit(q, t, "자바"), true, t);
    }
    for (const t of ["자바스터디", "자바개발자", "자바기초", "자바입문", "자바문제 풀이"]) assertEquals(await hit(q, t, "자바"), true, t);
    for (const t of ["자바도구", "자바칩 프라푸치노", "자바라"]) assertEquals(await hit(q, t, "자바"), false, t);
    assertEquals(await hit(q, "데이터베이스 설계", "데이터"), false);
    assertEquals(await hit(q, "서버리스 아키텍처", "서버"), false);
    assertEquals(await hit(q, "웹서버 구축", "서버"), true);                       // 앞쪽 결합은 허용(ASCII 규칙과 같다)
    assertEquals(await hit(q, "하루 1문제씩", "1문제"), true);
    assertEquals(await hit(q, "모의 면접에서", "모의 면접"), true);
    assertEquals(await hit(q, "LC·RC 파트", "lc·rc"), true);
    assertEquals(await hit(q, "LC·RCX", "lc·rc"), false);                          // 영숫자로 끝나는 혼합 용어는 ASCII 뒤쪽 경계
    // 0013 ASCII 규칙 회귀
    assertEquals(await hit(q, "JavaScript 기초", "java"), false);
    assertEquals(await hit(q, "Java로 배우는 자료구조", "java"), true);
    assertEquals(await hit(q, "MySQL 튜닝", "sql"), true);
    assertEquals(await hit(q, "react.dev 공식 문서", "react.dev"), true);
    assertEquals(await hit(q, "AWS docs 읽기", "cs"), false);
  } },

  { name: "tag_term_hit: every curated term — hits alone / with particle / before a study noun / after a prefix, misses inside a longer word", run: async (q) => {
    const terms = (await q(`select t.slug, x.term from public.tags t cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
                            where t.kind = 'CURATED' order by t.slug, x.term`)) as { slug: string; term: string }[];
    assert(terms.length >= 75, String(terms.length));
    for (const { slug, term } of terms) {
      const k = `${slug}/${term}`;
      const hangulEnd = /[가-힣]$/.test(term);
      assertEquals(await hit(q, term, term), true, k + " alone");
      assertEquals(await hit(q, `${term} 스터디`, term), true, k + " + space");
      assertEquals(await hit(q, `[${term}]`, term), true, k + " brackets");
      assertEquals(await hit(q, `${term.toUpperCase()}, 정리`, term), true, k + " upper + comma");
      if (term.length > 2 || hangulEnd) assertEquals(await hit(q, `주간${term} 정리`, term), true, k + " prefix");
      if (hangulEnd) {
        for (const p of ["를", "로", "의", "와", "에서", "까지", "은", "이랑", "씩", "에서는"]) assertEquals(await hit(q, `${term}${p} 공부`, term), true, k + " +" + p);
        for (const s of ["문제", "스터디", "공부", "정리", "기초", "실습", "시험"]) assertEquals(await hit(q, `${term}${s}`, term), true, k + " +" + s);
        for (const c of ["쿵", "쿵쿵", "스크립트", "베이스", "리스"]) assertEquals(await hit(q, `${term}${c}`, term), false, k + " +" + c);
      } else if (/[a-z0-9]$/i.test(term)) {
        for (const c of ["x", "9", "script"]) assertEquals(await hit(q, `${term}${c}`, term), false, k + " +" + c);
        assertEquals(await hit(q, `${term}로 공부`, term), true, k + " +로");
      }
    }
  } },

  { name: "tag_term_hit: tag-level regressions over realistic titles", run: async (q) => {
    const cases: [string, string[]][] = [
      ["자바스크립트 기초", []],
      ["모던 자바스크립트 Deep Dive", []],
      ["자바로 배우는 자료구조", ["java"]],
      ["자바의 정석 3판", ["java"]],
      ["데이터베이스 설계", []],
      ["데이터 분석 입문", ["data"]],
      ["스프링부트 입문", ["spring"]],
      ["하루 1문제씩 백준", ["algorithm", "coding-test"]],
      ["기출문제 풀이", ["certificate", "coding-test"]],
      ["정처기 실기 대비", ["info-processing"]],
      ["서버리스 아키텍처", []],
      ["서버 개발 기초", ["backend"]],
      ["프론트엔드 면접 준비", ["frontend", "interview"]],
      ["모의고사를 풀어요", ["certificate"]],
      ["쿠버네티스와 도커 컨테이너", ["docker", "kubernetes"]],
      ["운영체제·네트워크 정리", ["cs"]],
      ["리액트 공식문서 함께 읽기", ["react"]],
      ["영어회화 스터디", ["english"]],
      ["토익 900 목표", ["toeic"]],
      ["AWS SAA 자격증 3개월 완주", ["aws", "certificate"]],
      ["클라우드 인프라 구축", ["cloud"]],
    ];
    for (const [text, want] of cases) assertEquals(await tagsFor(q, text), want, text);
  } },

  // ───────── 4. 방 기간 변경 알림 ─────────
  { name: "room_update: changing start/end notifies ACTIVE members (not the leader, not INACTIVE) with ROOM_PERIOD_CHANGED", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const aws = await roomId(q, "aws");
    const k = (await one(q, "select public.notification_kinds() as k")).k as string[];
    assert(k.includes("ROOM_PERIOD_CHANGED"));
    await asUser(q, minsu);
    await q("select public.room_update('aws', $1::jsonb)", [JSON.stringify({ endDate: "2027-01-15" })]);
    const rows = await q(`select user_id::text as u, title, body, link, actor_user_id::text as actor, dedupe_key from public.notifications
                          where kind = 'ROOM_PERIOD_CHANGED' and room_id = $1::bigint and created_at >= now() order by user_id`, [aws]);
    const want = await Promise.all(["지은", "철수", "하나"].map((n) => uidOf(q, n)));
    assertEquals(rows.map((x) => x.u), [...want].sort());
    assertEquals(rows[0].title, "AWS SAA 자격증 3개월 완주 기간이 변경됐어요");
    assertEquals(rows[0].body, "26.10.01 – 26.12.31 → 26.10.01 – 27.01.15");          // 해를 넘기면 연도까지
    assertEquals(rows[0].link, "/my-study/aws");
    assertEquals(rows[0].actor, minsu);
    assert(new RegExp(`^ROOM_PERIOD_CHANGED:${aws}:\\d+:`).test(rows[0].dedupe_key), rows[0].dedupe_key);
    const rendered = (await one(q, "select public.notify_render('ROOM_PERIOD_CHANGED', $1::bigint, null, null, $2::jsonb) as t",
      [aws, JSON.stringify({ oldStartDate: "2026-12-01", oldEndDate: "2026-12-20", startDate: "2026-12-02", endDate: "2026-12-24" })])).t;
    assertEquals(rendered.body, "12.01 – 12.20 → 12.02 – 12.24");                      // 같은 해면 월.일
  } },

  { name: "room_update: no notification when the period is unchanged, other fields change, or schedule_changed is off", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const aws = await roomId(q, "aws");
    const count = async () => Number((await one(q, "select count(*)::int as n from public.notifications where kind = 'ROOM_PERIOD_CHANGED' and room_id = $1::bigint", [aws])).n);
    await asUser(q, minsu);
    await q("select public.room_update('aws', $1::jsonb)", [JSON.stringify({ title: "AWS 새 제목", endDate: "2026-12-31" })]);
    assertEquals(await count(), 0);
    await q("update public.room_notification_settings set schedule_changed = false where room_id = $1::bigint", [aws]);
    await q("select public.room_update('aws', $1::jsonb)", [JSON.stringify({ endDate: "2027-01-02" })]);
    assertEquals(await count(), 0);
  } },

  { name: "room_update: recruiting room start-date change notifies joined members; one save = one event (txid key, like SCHEDULE_CHANGED)", run: async (q) => {
    const sumin = await uidOf(q, "수민");
    const jcg = await roomId(q, "jcg");
    await asUser(q, sumin);
    await q("select public.room_update('jcg', $1::jsonb)", [JSON.stringify({ startDate: "2026-10-20" })]);
    const n = await q("select user_id::text as u, dedupe_key from public.notifications where kind = 'ROOM_PERIOD_CHANGED' and room_id = $1::bigint", [jcg]);
    const active = await q("select user_id::text as u from public.room_members where room_id = $1::bigint and status = 'ACTIVE' and user_id <> $2::uuid", [jcg, sumin]);
    assertEquals(n.map((x) => x.u).sort(), active.map((x) => x.u).sort());
    assert(n.length > 0);
    assert(n.every((x) => (x.dedupe_key as string).includes(":" + (n[0].dedupe_key as string).split(":")[2] + ":")));
    // 한계: 사례 하나가 한 트랜잭션(begin … rollback)이라 txid 가 하나뿐이다 → "두 번 저장 = 두 건"은 아래 별도 DB 테스트가 본다
  } },
]);

// 두 번 저장 = 두 건: 사례 하네스(한 트랜잭션)로는 txid 가 같아 검증할 수 없다 → 따로 연 DB 에서 저장마다 커밋한다
sqlTest("backlog2: room_update: two saves (separate transactions) = two ROOM_PERIOD_CHANGED events per member", async () => {
  const db2 = await openDb();
  await applySeed(db2);
  const q = makeQ(db2);
  const sumin = await uidOf(q, "수민");
  const jcg = await roomId(q, "jcg");
  const save = async (startDate: string) => {
    await db2.exec("begin");
    try {
      await setToday(q, TODAY);
      await asUser(q, sumin);
      await q("select public.room_update('jcg', $1::jsonb)", [JSON.stringify({ startDate })]);
      await db2.exec("commit");
    } catch (e) { await db2.exec("rollback"); throw e; }
  };
  await save("2026-10-20");
  await save("2026-10-21");
  const n = await q("select user_id::text as u, dedupe_key from public.notifications where kind = 'ROOM_PERIOD_CHANGED' and room_id = $1::bigint", [jcg]);
  const active = await q("select user_id::text as u from public.room_members where room_id = $1::bigint and status = 'ACTIVE' and user_id <> $2::uuid", [jcg, sumin]);
  assert(active.length > 0);
  assertEquals(n.length, active.length * 2);
  for (const a of active) {
    const keys = n.filter((x) => x.u === a.u).map((x) => (x.dedupe_key as string).split(":")[2]);
    assertEquals(keys.length, 2);
    assert(keys[0] !== keys[1], JSON.stringify(keys));                 // 저장마다 다른 txid
  }
  await db2.close();
});
