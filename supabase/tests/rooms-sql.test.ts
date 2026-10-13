import { assertEquals } from "@std/assert";
import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";
import { ROOM_CASES } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

for (const c of ROOM_CASES) sqlTest(`rooms: ${c.name}`, withCase(db, c.run));

sqlTest("rooms: seed §2 is idempotent (second applySeed keeps all counts)", withCase(db, async (q) => {
  const c = async () => (await q("select (select count(*) from public.rooms)::int r, (select count(*) from public.room_members)::int m, (select count(*) from public.tags)::int t, (select count(*) from public.room_tags)::int rt, (select count(*) from public.room_invites)::int i, (select count(*) from public.room_notification_settings)::int s, (select count(*) from public.task_assignments)::int a"))[0];
  const b = await c();
  await applySeed(db);
  assertEquals(await c(), b);
}));
