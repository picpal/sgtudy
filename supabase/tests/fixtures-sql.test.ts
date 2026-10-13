import { assertEquals } from "@std/assert";
import { applySeed, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

cases("fixtures", db, [
  { name: "seed lookups: 9 rooms, aws leader 민수, EC2 node id, today pinned", run: async (q) => {
    assertEquals((await one(q, "select count(*)::int as n from public.rooms")).n, 9);
    const r = await one(q, "select leader_id::text as id from public.rooms where slug = 'aws'");
    assertEquals(r.id, await uidOf(q, "민수"));
    assertEquals(typeof await roomId(q, "aws"), "string");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    assertEquals((await one(q, "select title from public.goal_nodes where id = $1::bigint", [ec2])).title, "EC2 인스턴스 유형 정리");
    assertEquals((await one(q, "select public.kst_today()::text as d")).d, "2026-10-12");
  } },
  { name: "setNow sets app.now for the case only", run: async (q) => {
    await setNow(q, "2026-10-03T15:00:30Z");
    assertEquals((await one(q, "select current_setting('app.now', true) as v")).v, "2026-10-03T15:00:30Z");
  } },
]);
