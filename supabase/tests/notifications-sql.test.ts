import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, uuids, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

/** notify_publish 직접 호출(테스트는 수퍼유저라 권한 회수에 걸리지 않는다). 반환: 생성 건수 */
const publish = async (q: Q, kind: string, room: string, node: string | null, actor: string | null, to: string[], prefix: string, model = "{}") =>
  Number((await one(q, "select public.notify_publish($1, $2::bigint, $3::bigint, $4::uuid, $5::uuid[], $6, $7::jsonb) as n",
                     [kind, room, node, actor, uuids(to), prefix, model])).n);
/** 이 사례 트랜잭션이 만든 행만 본다(created_at = now() = 사례 tx 시작). 시드 §4 행은 그보다 앞선다(E4) */
const rowsOf = (q: Q, uid: string, kind?: string) =>
  q(`select kind, title, body, link, node_id::text as node_id, actor_user_id::text as actor, read_at from public.notifications
     where user_id = $1::uuid and ($2::text is null or kind = $2) and created_at >= now() order by id`,
    [uid, kind ?? null]);

cases("notifications", db, [
  { name: "dedupe: same prefix twice → 1 then 0 (Review Focus 3)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}`), 1);
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}`), 0);
    assertEquals((await rowsOf(q, cheolsu, "ROOM_STARTED")).length, 1);
    // 다른 prefix 면 새 행
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}:again`), 1);
  } },

  { name: "prefix passes through unchanged (callers own txid, C1/E1); key = prefix:<uid>, long prefix hashed (D8)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const cheolsu = await uidOf(q, "철수");
    const tx = (await one(q, "select txid_current()::text as t")).t;
    const prefix = `TASK_ASSIGNED:${aws}:${ec2}:${tx}`;                          // 0006 node_update 가 넘기는 모양(txid 포함)
    assertEquals(await publish(q, "TASK_ASSIGNED", aws, ec2, null, [cheolsu], prefix), 1);
    assertEquals(await publish(q, "TASK_ASSIGNED", aws, ec2, null, [cheolsu], prefix), 0);   // 한 저장(같은 트랜잭션) = 1건
    const k = await one(q, "select dedupe_key from public.notifications where user_id = $1::uuid and kind = 'TASK_ASSIGNED'", [cheolsu]);
    assertEquals(k.dedupe_key, `${prefix}:${cheolsu}`);
    // 상태성 kind 는 그대로
    await publish(q, "ROUND_STARTED", aws, ec2, null, [cheolsu], `ROUND_STARTED:${aws}:${ec2}`);
    assertEquals((await one(q, "select dedupe_key from public.notifications where user_id = $1::uuid and kind = 'ROUND_STARTED'", [cheolsu])).dedupe_key,
                 `ROUND_STARTED:${aws}:${ec2}:${cheolsu}`);
    // 긴 prefix 는 해시로 줄이고 수신자 uuid 는 보존
    await publish(q, "ROOM_ENDED", aws, null, null, [cheolsu], "ROOM_ENDED:" + "x".repeat(200));
    const long = await one(q, "select dedupe_key from public.notifications where user_id = $1::uuid and kind = 'ROOM_ENDED'", [cheolsu]);
    assert(long.dedupe_key.startsWith("h:") && long.dedupe_key.endsWith(`:${cheolsu}`) && long.dedupe_key.length <= 160);
  } },

  { name: "actor excluded; duplicates and nulls in recipients collapse", run: async (q) => {
    const aws = await roomId(q, "aws");
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const n = await publish(q, "SCHEDULE_CHANGED", aws, null, minsu, [minsu, cheolsu, cheolsu], `SCHEDULE_CHANGED:${aws}:0:2026101220261015`);
    assertEquals(n, 1);
    assertEquals((await rowsOf(q, minsu, "SCHEDULE_CHANGED")).length, 0);
    const r = await rowsOf(q, cheolsu, "SCHEDULE_CHANGED");
    assertEquals(r.length, 1);
    assertEquals(r[0].actor, minsu);
    assertEquals(r[0].title, "AWS SAA 자격증 3개월 완주 일정이 변경됐어요");
    assertEquals(r[0].link, "/my-study/aws");
  } },

  { name: "optional kind filtered by room settings; missing settings row = ON (Review Focus 4)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("update public.room_notification_settings set reminder_d1 = false where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:${aws}:${ec2}:d1`, '{"days":1}'), 0);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:${aws}:${ec2}:d3`, '{"days":3}'), 1);
    await q("update public.room_notification_settings set task_assigned = false, room_start_end = false where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "TASK_ASSIGNED", aws, ec2, null, [cheolsu], `TASK_ASSIGNED:${aws}:${ec2}`), 0);
    assertEquals(await publish(q, "TASK_UNASSIGNED", aws, ec2, null, [cheolsu], `TASK_UNASSIGNED:${aws}:${ec2}`), 0);
    assertEquals(await publish(q, "ROOM_ENDED", aws, null, null, [cheolsu], `ROOM_ENDED:${aws}`), 0);
    // 기본·잠금 kind 는 설정과 무관
    assertEquals(await publish(q, "ROUND_STARTED", aws, await nodeId(q, "aws", "EC2·S3"), null, [cheolsu], `ROUND_STARTED:${aws}:x`), 1);
    // 설정 행이 없으면 기본 ON
    await q("delete from public.room_notification_settings where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:${aws}:${ec2}:d1:b`, '{"days":1}'), 1);
  } },

  { name: "titles and links per kind (Korean templates, task link carries ?task=)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const round3 = await nodeId(q, "aws", "고가용성 아키텍처");
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const gaeun = await uidOf(q, "가은");          // 비멤버

    await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DR:${ec2}`, '{"days":1}');
    await publish(q, "JOIN_REQUESTED", aws, null, gaeun, [minsu], `JR:${gaeun}`);
    await publish(q, "JOIN_REJECTED", aws, null, minsu, [gaeun], `JX:${gaeun}`);
    await publish(q, "ROUND_STARTED", aws, round3, null, [cheolsu], `RS:${round3}`);
    await publish(q, "TASK_COMPLETION_DIGEST", aws, null, null, [minsu], `TCD:${aws}`, '{"count":3}');
    await publish(q, "TASK_ALL_SUBMITTED", aws, ec2, cheolsu, [minsu], `TAS:${ec2}`);
    await publish(q, "MEMBER_DEACTIVATED", aws, null, minsu, [cheolsu], `MD:${cheolsu}`);
    await publish(q, "ROOM_START_BLOCKED", aws, null, null, [minsu], `RSB:${aws}`);

    const c = await rowsOf(q, cheolsu);
    assertEquals(c.map((r) => [r.kind, r.title, r.link]), [
      ["DEADLINE_REMINDER", '"EC2 인스턴스 유형 정리" 마감 1일 전이에요', `/my-study/aws?task=${ec2}`],
      ["ROUND_STARTED", "AWS SAA 자격증 3개월 완주의 3주차가 시작됐어요", "/my-study/aws"],
      ["MEMBER_DEACTIVATED", "AWS SAA 자격증 3개월 완주 스터디에서 이탈 처리됐어요", "/my-study/aws"],
    ]);
    assertEquals(c[0].body, null);                                             // 0013: 본문에 방 제목을 되풀이하지 않는다(제목이 과제를 말한다)
    assertEquals(c[1].body, "고가용성 아키텍처");                               // 회차 시작 본문 = 회차 제목
    const m = await rowsOf(q, minsu);
    assertEquals(m.map((r) => [r.kind, r.title, r.link]), [
      ["JOIN_REQUESTED", "가은님이 AWS SAA 자격증 3개월 완주 참가를 신청했어요", "/my-study/aws#applications"],   // 0024 딥링크
      ["TASK_COMPLETION_DIGEST", "어제 3개 과제가 전원 제출됐어요", "/my-study/aws"],
      ["TASK_ALL_SUBMITTED", '"EC2 인스턴스 유형 정리" 과제를 전원 제출했어요', `/my-study/aws?task=${ec2}#submissions`],
      ["ROOM_START_BLOCKED", "AWS SAA 자격증 3개월 완주 시작일이 지났지만 말단 과제가 없어 시작하지 못했어요", "/my-study/aws"],
    ]);
    const g = await rowsOf(q, gaeun);
    assertEquals(g.map((r) => [r.kind, r.link]), [["JOIN_REJECTED", "/rooms/aws"]]);   // 비참가자는 /rooms

    await expectFail(publish(q, "NOPE", aws, null, null, [cheolsu], "x"), "VALIDATION_FAILED");
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [], `empty:${aws}`), 0);
  } },

  { name: "list: cursor paging 20+8, unread_count, read, read_all, foreign id → NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    const minsu = await uidOf(q, "민수");
    for (let i = 0; i < 25; i++) await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `page:${i}`);
    await asUser(q, cheolsu);
    // 시드 §4(Task 10) 전에는 0, 후에는 시드분 — 어느 시점에 돌려도 같은 단언이 되도록 사례 tx 이전 행을 센다(E4)
    const seeded = Number((await one(q, "select count(*)::int as n from public.notifications where user_id = $1::uuid and created_at < now() and read_at is null", [cheolsu])).n);
    const total = 25 + seeded;
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: total });
    const p1 = (await one(q, "select public.notifications_list(null, 20) as l")).l;
    assertEquals(p1.items.length, 20);
    assert(p1.nextCursor !== null);
    assertEquals(p1.items[0].kind, "ROOM_STARTED");
    assertEquals(p1.items[0].room, { slug: "aws", title: "AWS SAA 자격증 3개월 완주" });
    assertEquals(p1.items[0].readAt, null);
    assertEquals(p1.items[0].actor, null);
    const p2 = (await one(q, "select public.notifications_list($1, 20) as l", [p1.nextCursor])).l;
    assertEquals(p2.items.length, total - 20);
    assertEquals(p2.nextCursor, null);
    assert(Number(p2.items[0].id) < Number(p1.items[19].id));

    await q("select public.notifications_read($1::bigint)", [p1.items[0].id]);
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: total - 1 });
    await q("select public.notifications_read($1::bigint)", [p1.items[0].id]);   // 멱등
    assertEquals((await one(q, "select public.notifications_read_all() as r")).r, { updated: total - 1 });
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: 0 });

    await publish(q, "ROOM_STARTED", aws, null, null, [minsu], `mine:${minsu}`);
    const other = await one(q, "select id::text as id from public.notifications where user_id = $1::uuid order by id desc limit 1", [minsu]);
    await expectFail(q("select public.notifications_read($1::bigint)", [other.id]), "NOT_FOUND");
    await asUser(q, cheolsu);
    await expectFail(q("select public.notifications_list('abc', 20)"), "VALIDATION_FAILED");               // 숫자가 아닌 커서는 raw 22P02 가 아니다
    await expectFail(q("select public.notifications_list('99999999999999999999', 20)"), "VALIDATION_FAILED");   // bigint 범위 밖
    await asAnon(q);   // 수퍼유저 + 빈 uid 경로. 실제 anon 은 GRANT 층에서 42501(notifications-grants 사례, D10)
    await expectFail(q("select public.notifications_list('abc', 20)"), "AUTH_REQUIRED");                   // 인증이 커서 검사보다 먼저
    await expectFail(q("select public.notifications_list(null, 20)"), "AUTH_REQUIRED");
    await expectFail(q("select public.notifications_unread_count()"), "AUTH_REQUIRED");
  } },

  { name: "notification_json hides room once the recipient can no longer read it (final review Minor 1)", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    const before = (await one(q, "select public.notifications_list(null, 50) as l")).l.items.find((i: { kind: string }) => i.kind === "ROUND_STARTED");
    assertEquals(before.room.slug, "spring");                                  // ACTIVE 멤버: 읽을 수 있다
    await q("update public.room_members set status = 'REJECTED' where user_id = $1::uuid and room_id = $2::bigint", [cheolsu, await roomId(q, "spring")]);
    const after = (await one(q, "select public.notifications_list(null, 50) as l")).l.items.find((i: { kind: string }) => i.kind === "ROUND_STARTED");
    assertEquals(after.room, null);                                            // spring 은 비공개 — 멤버가 아니면 제목·slug 도 못 본다
    assertEquals(after.title.includes("2주차"), true);                          // 생성 시점 스냅샷 title 은 그대로
  } },

  { name: "settings_get/put: defaults, full replace, NOT_LEADER, VALIDATION_FAILED", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const d = (await one(q, "select public.settings_get('aws') as s")).s;
    assertEquals(d, { reminderD1: true, reminderD3: true, taskAssigned: true, scheduleChanged: true, roomStartEnd: true, completionMode: "daily", submissionDigest: true });   // 0025 submissionDigest
    const put = (s: unknown) => one(q, "select public.settings_put('aws', $1::jsonb) as s", [JSON.stringify(s)]).then((r) => r.s);
    const u = await put({ ...d, reminderD3: false, completionMode: "immediate" });
    assertEquals([u.reminderD3, u.completionMode], [false, "immediate"]);
    assertEquals((await one(q, "select completion_mode as m from public.room_notification_settings where room_id = $1::bigint", [await roomId(q, "aws")])).m, "IMMEDIATE");
    await expectFail(put({ ...d, completionMode: "weekly" }), "VALIDATION_FAILED");
    await expectFail(put({ ...d, reminderD1: "yes" }), "VALIDATION_FAILED");
    await expectFail(put({ ...d, completionMode: undefined }), "VALIDATION_FAILED");   // 키 누락(B8)
    await expectFail(q("select public.settings_get('spring')"), "ROOM_NOT_FOUND");      // 비공개 방 외부인(D5 require_leader)
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(q("select public.settings_get('aws')"), "NOT_LEADER");
    await expectFail(put(d), "NOT_LEADER");
    await asAnon(q);   // 수퍼유저 + 빈 uid 경로. 실제 anon 은 42501(D10)
    await expectFail(q("select public.settings_get('aws')"), "AUTH_REQUIRED");
  } },

  { name: "TASK_ALL_SUBMITTED: immediate mode notifies leader at the final submission; digest mode does not", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");            // 지은 D, 철수 O
    const minsu = await uidOf(q, "민수");
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, ec2);                                                      // DAILY_DIGEST(기본) → 즉시 알림 없음
    assertEquals((await rowsOf(q, minsu, "TASK_ALL_SUBMITTED")).length, 0);
    await q("delete from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [ec2, await uidOf(q, "철수")]);
    await asUser(q, minsu);
    await q(`select public.settings_put('aws', '{"reminderD1":true,"reminderD3":true,"taskAssigned":true,"scheduleChanged":true,"roomStartEnd":true,"completionMode":"immediate"}'::jsonb)`);
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, ec2);
    const r = await rowsOf(q, minsu, "TASK_ALL_SUBMITTED");
    assertEquals(r.length, 1);
    assertEquals(r[0].node_id, ec2);
    await submit(q, ec2, "수정");                                              // 갱신은 다시 알리지 않는다
    assertEquals((await rowsOf(q, minsu, "TASK_ALL_SUBMITTED")).length, 1);
  } },

  { name: "plan 02/03 placeholder calls now produce rows: JOIN_REQUESTED, JOIN_APPROVED, ROOM_STARTED+JOIN_EXPIRED (tick), SCHEDULE_CHANGED", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    const gaeun = await uidOf(q, "가은");                                      // sqld 그룹장(APPROVAL, RECRUIT)
    await asUser(q, seoyeon);
    await q("select public.room_apply('sqld')");
    const jr = await rowsOf(q, gaeun, "JOIN_REQUESTED");
    assertEquals(jr.length, 1);
    assertEquals(jr[0].title, "서연님이 SQLD 4주 벼락치기 참가를 신청했어요");
    await asUser(q, gaeun);
    await q("select public.room_approve('sqld', $1::uuid)", [seoyeon]);
    const ja = await rowsOf(q, seoyeon, "JOIN_APPROVED");
    assertEquals(ja.length, 1);
    assertEquals(ja[0].link, "/my-study/sqld");                              // 승인 뒤에는 참가자 화면으로 간다

    await setToday(q, "2026-10-26");                                          // sqld start_date
    await q("select public.room_tick()");
    assertEquals((await rowsOf(q, gaeun, "ROOM_STARTED")).length, 1);
    assertEquals((await rowsOf(q, seoyeon, "ROOM_STARTED")).length, 1);
    assertEquals((await rowsOf(q, await uidOf(q, "철수"), "JOIN_EXPIRED")).length, 1);   // 철수 PENDING → EXPIRED
    await q("select public.room_tick()");                                      // 재실행: 중복 없음 (Review Focus 3)
    assertEquals((await rowsOf(q, gaeun, "ROOM_STARTED")).length, 1);

    await setToday(q, "2026-10-12");
    await asUser(q, await uidOf(q, "민수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-15\"}'::jsonb)", [ec2]);
    const sc = await rowsOf(q, await uidOf(q, "철수"), "SCHEDULE_CHANGED");
    assertEquals(sc.length, 1);
    assertEquals((await rowsOf(q, await uidOf(q, "민수"), "SCHEDULE_CHANGED")).length, 0);   // actor 제외
    // txid 는 호출부가 한 번만 붙인다(C1) — notify_publish 가 또 붙이면 :txid:txid:uid 가 된다
    const cheolsu = await uidOf(q, "철수");
    const sk = await one(q, "select dedupe_key from public.notifications where user_id = $1::uuid and kind = 'SCHEDULE_CHANGED' and created_at >= now()", [cheolsu]);
    assert(new RegExp(`^SCHEDULE_CHANGED:${await roomId(q, "aws")}:${ec2}:\\d+:${cheolsu}$`).test(sk.dedupe_key), sk.dedupe_key);
  } },
]);

cases("notifications-grants", db, [
  { name: "internal helpers not executable by anon/authenticated; public RPCs granted to authenticated only (B4)", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, `select has_function_privilege($1, $2, 'execute') as v`, [role, fn])).v;
    for (const fn of ["public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb)", "public.notify_render(text, bigint, bigint, uuid, jsonb)",
                      "public.notify_enabled(text, bigint, jsonb)", "public.notify_link(text, bigint, bigint, uuid)",
                      "public.notification_kinds()", "public.notification_json(public.notifications)",
                      "public.leader_room(text, boolean)", "public.settings_json(bigint)"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), false, fn);
    }
    for (const fn of ["public.notifications_list(text, int)", "public.notifications_unread_count()", "public.notifications_read(bigint)",
                      "public.notifications_read_all()", "public.settings_get(text)", "public.settings_put(text, jsonb)"]) {
      assertEquals(await can("authenticated", fn), true, fn);
      assertEquals(await can("anon", fn), false, fn);
    }
    // 실제 실행(D7): authenticated 는 통과, anon 은 GRANT 층에서 거절
    await asUser(q, await uidOf(q, "철수"));
    await q("set local role authenticated");
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: 3 });   // 시드 §4 미읽음 3건
    await q("reset role");
    await asUser(q, await uidOf(q, "민수"));
    await q("set local role authenticated");
    assertEquals((await one(q, "select public.settings_get('aws') as s")).s.completionMode, "daily");
    await q("reset role");
    await asAnon(q);
    await q("set local role anon");
    await expectFail(q("select public.notifications_list()"), "permission denied");
    await q("reset role");
  } },
]);
