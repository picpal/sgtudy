import { assertEquals } from "@std/assert";
import { applySeed, asUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

cases("cron+seed", db, [
  { name: "0010 registers 7 jobs with 02 §7 schedules (UTC)", run: async (q) => {
    const jobs = await q("select jobname, schedule, command from cron.job order by jobname");
    assertEquals(jobs.map((j) => [j.jobname, j.schedule, j.command]), [
      ["cleanup",            "0 19 * * *",  "select public.job_cleanup()"],
      ["completion_digest",  "0 0 * * *",   "select public.job_completion_digest()"],
      ["deadline_reminder",  "0 0 * * *",   "select public.job_deadline_reminder()"],
      ["draft_blocked",      "5 15 * * *",  "select public.job_draft_blocked()"],
      ["member_count_audit", "30 19 * * *", "select public.member_count_audit()"],
      ["room_tick",          "*/5 * * * *", "select public.room_tick()"],
      ["round_started",      "1 15 * * *",  "select public.job_round_started()"],
    ]);
  } },

  { name: "seed §4: 철수 has 3 unread notifications; every room has a settings row; 지은's EC2 submission has 2 links", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: 3 });
    const l = (await one(q, "select public.notifications_list(null, 20) as l")).l;
    assertEquals(l.items.map((i: { kind: string }) => i.kind), ["SCHEDULE_CHANGED", "ROUND_STARTED", "DEADLINE_REMINDER"]);
    const ts = l.items.map((i: { createdAt: string }) => i.createdAt);
    assertEquals(ts, [...ts].sort().reverse());                                  // id DESC = 시간 DESC (시드 삽입 순서 = 시간 순)
    assertEquals(l.items[2].link, `/my-study/aws?task=${await nodeId(q, "aws", "EC2 인스턴스 유형 정리")}`);
    assertEquals(l.items[0].actor.nickname, "민수");
    const s = await one(q, "select count(*)::int as n from public.rooms r left join public.room_notification_settings st on st.room_id = r.id where st.room_id is null");
    assertEquals(s.n, 0);
    const links = await q(`select l.url from public.submission_links l join public.submissions s on s.id = l.submission_id
                           where s.node_id = $1::bigint and s.user_id = $2::uuid order by l.sort_order`,
                          [await nodeId(q, "aws", "EC2 인스턴스 유형 정리"), await uidOf(q, "지은")]);
    assertEquals(links.map((x) => x.url), ["https://docs.aws.amazon.com/ec2/latest/instancetypes/", "https://github.com/jieun/aws-notes/blob/main/ec2.md"]);
  } },
]);
