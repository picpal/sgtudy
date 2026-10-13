import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);
const run = async (q: Q, fn: string) => (await one(q, `select public.${fn}() as n`)).n;
/** 시드 §4 가 미리 넣은 알림은 제외 — 이번 케이스 트랜잭션(now())에서 생긴 행만 본다 */
const kinds = (q: Q, uid: string, kind: string) =>
  q(`select title, node_id::text as node, room_id::text as room from public.notifications
     where user_id = $1::uuid and kind = $2 and created_at >= now() order by id`, [uid, kind]);

cases("jobs", db, [
  { name: "job_draft_blocked: DRAFT past start_date notifies leader once per day (idempotent)", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await asUser(q, seoyeon);
    const d = (await one(q, "select public.room_create('Draft Room', '소개', '2026-11-01'::date, '2026-11-28'::date, 4, true, 'direct') as d")).d;
    assertEquals(await run(q, "job_draft_blocked"), 0);                        // 아직 start_date 전
    await setToday(q, "2026-11-01");
    assertEquals(Number(await run(q, "job_draft_blocked")), 1);
    assertEquals(Number(await run(q, "job_draft_blocked")), 0);                // 같은 날 재실행
    const n = await kinds(q, seoyeon, "ROOM_START_BLOCKED");
    assertEquals(n.length, 1);
    assertEquals(n[0].room, d.id);
    await setToday(q, "2026-11-02");
    assertEquals(Number(await run(q, "job_draft_blocked")), 1);                // 다음 날은 새 키
    assertEquals((await one(q, "select status from public.rooms where id = $1::bigint", [d.id])).status, "DRAFT");   // 전환은 안 한다
  } },

  { name: "job_round_started: aws 3주차 on 10/15 → ACTIVE members (4), not INACTIVE 도윤; idempotent; 10/12 = spring 5 + react 5 (minus seeded natural keys)", run: async (q) => {
    await setToday(q, "2026-10-15");
    const n = Number(await run(q, "job_round_started"));
    assertEquals(n, 4);                                                        // 10/15 시작 회차 = aws 3주차뿐
    const round3 = await nodeId(q, "aws", "고가용성 아키텍처");
    for (const nick of ["민수", "지은", "철수", "하나"]) {
      const r = await kinds(q, await uidOf(q, nick), "ROUND_STARTED");
      assertEquals(r.filter((x) => x.node === round3).length, 1, nick);
    }
    assertEquals((await kinds(q, await uidOf(q, "도윤"), "ROUND_STARTED")).length, 0);
    assertEquals(Number(await run(q, "job_round_started")), 0);
    // 10/12 에는 spring 2주차가 시작한다(src/data/my-study.ts:362) — spring ACTIVE 5명에게 1건씩. 시드가 같은 자연 키로 미리 넣은 행은 dedupe 되고, kinds() 는 created_at >= now() 로 걸러진다
    await setToday(q, "2026-10-12");
    const springActive = Number((await one(q, "select count(*)::int as n from public.room_members m join public.rooms r on r.id = m.room_id where r.slug = 'spring' and m.status = 'ACTIVE'")).n);
    assertEquals(springActive, 5);
    // react 4주차도 10/12 시작(ACTIVE 5명) → spring 5 + react 5 = 10. 시드(Task 10)가 spring 한 행을 자연 키로 미리 넣으면 그만큼 dedupe 된다 (E4: 9)
    const pre = Number((await one(q, `select count(*)::int as n from public.notifications n join public.goal_nodes g on g.id = n.node_id
      where n.kind = 'ROUND_STARTED' and g.depth = 2 and g.start_date = '2026-10-12'::date
        and n.dedupe_key like 'ROUND_STARTED:' || n.room_id || ':' || g.id || ':%'`)).n);
    assertEquals(Number(await run(q, "job_round_started")), 10 - pre);
    assertEquals(Number(await run(q, "job_round_started")), 0);                // 같은 날 재실행
  } },

  { name: "job_deadline_reminder: D-1 to unsubmitted assignees only; D-3 honors reminder_d3; idempotent", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");            // end 10-14: 지은 D, 철수 O
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");        // end 10-14: 하나 O
    await setToday(q, "2026-10-13");
    const n1 = Number(await run(q, "job_deadline_reminder"));
    assertEquals(n1, 2);                                                       // EC2 철수 + S3 하나
    const c = await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER");
    assertEquals(c.filter((x) => x.node === ec2).map((x) => x.title), ['"EC2 인스턴스 유형 정리" 마감 1일 전이에요']);
    assertEquals((await kinds(q, await uidOf(q, "하나"), "DEADLINE_REMINDER")).filter((x) => x.node === s3).length, 1);
    assertEquals((await kinds(q, await uidOf(q, "지은"), "DEADLINE_REMINDER")).filter((x) => x.node === ec2).length, 0);
    assertEquals(Number(await run(q, "job_deadline_reminder")), 0);

    await setToday(q, "2026-10-11");                                          // D-3
    await q("update public.room_notification_settings set reminder_d3 = false where room_id = $1::bigint", [await roomId(q, "aws")]);
    await run(q, "job_deadline_reminder");
    assertEquals((await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER")).filter((x) => x.title.includes("3일 전")).length, 0);
    await q("update public.room_notification_settings set reminder_d3 = true where room_id = $1::bigint", [await roomId(q, "aws")]);
    await run(q, "job_deadline_reminder");
    assertEquals((await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER")).filter((x) => x.title.includes("3일 전") && x.node === ec2).length, 1);
  } },

  { name: "job_completion_digest: leaves completed yesterday → one TASK_COMPLETION_DIGEST per room; IMMEDIATE rooms skipped; idempotent", run: async (q) => {
    const iam = await nodeId(q, "aws", "IAM 정책 이해");                       // 민수 D·지은 L·철수 D·하나 M
    const minsu = await uidOf(q, "민수");
    await setToday(q, "2026-10-11");
    await setNow(q, "2026-10-11T03:00:00Z");                                   // KST 10/11 12:00
    await asUser(q, await uidOf(q, "하나"));
    await submit(q, iam);                                                       // 이제 4/4, 마지막 제출일 = 10/11
    assertEquals((await kinds(q, minsu, "TASK_ALL_SUBMITTED")).length, 0);     // digest 모드
    await setToday(q, "2026-10-12");
    assertEquals(Number(await run(q, "job_completion_digest")), 3);            // aws IAM + spring 1주차(DDDDD, end 10/11) + react 3주차 노트 — 방마다 1건
    const d = await kinds(q, minsu, "TASK_COMPLETION_DIGEST");
    assertEquals(d.map((x) => x.title), ["어제 1개 과제가 전원 제출됐어요"]);
    assertEquals(Number(await run(q, "job_completion_digest")), 0);           // 같은 날 재실행
    await setToday(q, "2026-10-13");
    await run(q, "job_completion_digest");
    assertEquals((await kinds(q, minsu, "TASK_COMPLETION_DIGEST")).length, 1); // 그제 완료분은 안 센다

    await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = $1::bigint", [await roomId(q, "aws")]);
    await setToday(q, "2026-10-12");
    await q("delete from public.notifications where kind = 'TASK_COMPLETION_DIGEST' and user_id = $1::uuid", [minsu]);
    await run(q, "job_completion_digest");
    assertEquals((await kinds(q, minsu, "TASK_COMPLETION_DIGEST")).length, 0); // IMMEDIATE 방은 제외
  } },

  { name: "job_cleanup: stale PENDING (>1h) and unlinked READY orphans (>24h) → DELETED; never deletes storage.objects or files rows (S2·S3)", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const stale = crypto.randomUUID(), fresh = crypto.randomUUID(), orphan = crypto.randomUUID(), young = crypto.randomUUID(), old = crypto.randomUUID();
    const path = (id: string) => `${aws}/${ec2}/${cheolsu}/${id}.txt`;
    const ins = (id: string, status: string, created: string, deleted: string | null) =>
      q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, created_at, deleted_at)
         values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'ATTACHMENT', $5, 'x.txt', 'text/plain', 1, $6, $7::timestamptz, $8::timestamptz)`,
        [id, cheolsu, aws, ec2, path(id), status, created, deleted]);
    await ins(stale, "PENDING", "2026-10-01T00:00:00Z", null);
    await ins(fresh, "PENDING", new Date().toISOString(), null);
    await ins(orphan, "READY", "2026-10-01T00:00:00Z", null);                  // 등록만 하고 제출 안 함, 24h 경과
    await ins(young, "READY", new Date().toISOString(), null);                 // 방금 등록(업로드 중 묶음)
    await ins(old, "DELETED", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
    await q("insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2), ('attachments', $3, $2)", [path(old), cheolsu, path(orphan)]);
    const mail = (sentAt: string) => q(`insert into public.mail_outbox (to_email, template, model, status, sent_at, created_at)
      values ('m@example.com', 't', '{}'::jsonb, 'SENT', $1::timestamptz, $1::timestamptz) returning id::text as id`, [sentAt]);
    const oldMail = (await mail("2026-09-01T00:00:00Z"))[0].id, newMail = (await mail(new Date().toISOString()))[0].id;
    const r = (await one(q, "select public.job_cleanup() as r")).r;
    assertEquals([r.filesExpired, r.orphansExpired, r.mailPurged], [1, 1, 1]);
    assertEquals((await q("select id::text as id from public.mail_outbox where id in ($1::bigint, $2::bigint)", [oldMail, newMail])).map((x) => x.id), [newMail]);
    const st = async (id: string) => (await one(q, "select status, (deleted_at is not null) as del from public.files where id = $1::uuid", [id]));
    assertEquals(await st(stale), { status: "DELETED", del: true });
    assertEquals(await st(fresh), { status: "PENDING", del: false });
    assertEquals(await st(orphan), { status: "DELETED", del: true });
    assertEquals(await st(young), { status: "READY", del: false });
    assertEquals((await st(old)).status, "DELETED");                            // 행은 남는다 — 2단계 Edge Function 이 Storage API 로 객체를 지운 뒤 정리
    assertEquals((await q("select 1 from storage.objects where name in ($1, $2)", [path(old), path(orphan)])).length, 2);   // SQL 로 객체를 지우지 않는다
    assertEquals((await one(q, "select public.job_cleanup() as r")).r.filesExpired, 0);   // 재실행 0
  } },

  { name: "member_count_audit: repairs drifted member_count (I7); locks rooms before counting (no stale write over a concurrent join)", run: async (q) => {
    // PGlite 는 단일 연결이라 경합을 재현할 수 없다 — 정의에 선행 잠금이 있는지만 고정한다
    const def = (await one(q, "select pg_get_functiondef('public.member_count_audit()'::regprocedure) as d")).d as string;
    assert(/for update/i.test(def), "member_count_audit must lock rooms before counting");
    await q("update public.rooms set member_count = 1 where slug = 'aws'");
    assertEquals(Number(await run(q, "member_count_audit")), 1);
    assertEquals((await one(q, "select member_count as n from public.rooms where slug = 'aws'")).n, 4);
    assertEquals(Number(await run(q, "member_count_audit")), 0);
  } },

  { name: "jobs are not executable by anon/authenticated (no GRANT, B4)", run: async (q) => {
    for (const fn of ["job_draft_blocked()", "job_round_started()", "job_deadline_reminder()", "job_completion_digest()", "job_cleanup()", "member_count_audit()"]) {
      for (const role of ["anon", "authenticated"]) {
        assertEquals((await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${fn}`])).v, false, `${role} ${fn}`);
      }
    }
    // 실제 역할로 실행해도 막힌다 (D7) — 쓰기를 하는 job_cleanup 으로 확인
    for (const role of ["anon", "authenticated"]) {
      await asUser(q, await uidOf(q, "철수"));
      await q(`set local role ${role}`);
      await expectFail(q("select public.job_cleanup()"), "permission denied");
      await q("reset role");
    }
  } },
]);
