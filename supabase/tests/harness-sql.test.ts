import { assertEquals } from "@std/assert";
import { asAnon, asUser, expectFail, openDb, PG_CRON_LINE, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("harness: stubs expose auth.uid() driven by app.uid", withCase(db, async (q) => {
  await asAnon(q);
  assertEquals((await q("select auth.uid() as uid"))[0].uid, null);
  const uid = crypto.randomUUID();
  await asUser(q, uid);
  assertEquals((await q("select auth.uid()::text as uid"))[0].uid, uid);
  assertEquals((await q("select auth.role() as r"))[0].r, "authenticated");
}));

sqlTest("harness: rollback isolates cases", withCase(db, async (q) => {
  await q("create table _tmp_probe (x int)");
  await q("insert into _tmp_probe values (1)");
}));

sqlTest("harness: an expected failure does not abort the case (statement savepoints)", withCase(db, async (q) => {
  await q("create table _tmp_sp (x int)");
  await q("insert into _tmp_sp values (1)");
  await expectFail(q("select 1/0"), "division by zero");
  await asUser(q, crypto.randomUUID());                                   // 실패 뒤에도 같은 트랜잭션에서 계속
  assertEquals((await q("select count(*)::int as n from _tmp_sp"))[0].n, 1);
}));

sqlTest("harness: previous case left nothing behind", withCase(db, async (q) => {
  const r = await q("select to_regclass('public._tmp_probe') as t");
  assertEquals(r[0].t, null);
}));

sqlTest("harness: storage.foldername drops the file name", withCase(db, async (q) => {
  const r = await q("select storage.foldername('12/34/abc/x.png') as f");
  assertEquals(r[0].f, ["12", "34", "abc"]);
}));

sqlTest("harness: pg_cron line form is pinned; cron.schedule/unschedule stubs work", withCase(db, async (q) => {
  // 정확히 이 형태만 걷어낸다
  assertEquals("create extension if not exists pg_cron;".replace(PG_CRON_LINE, ""), "");
  assertEquals("create extension if not exists pg_cron with schema pg_catalog;".replace(PG_CRON_LINE, "").length > 0, true);
  await q("select cron.schedule('probe', '0 15 * * *', 'select 1')");
  assertEquals((await q("select cron.unschedule('probe') as ok"))[0].ok, true);
  assertEquals((await q("select count(*)::int as n from cron.job where jobname = 'probe'"))[0].n, 0);
}));
