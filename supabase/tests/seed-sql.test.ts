import { assertEquals } from "@std/assert";
import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();
await applySeed(db);

// src/lib/palette.ts NAME_TONE 과 동일해야 한다
const NAME_TONE: Record<string, string> = {
  철수: "blue", 민수: "mint", 서연: "blue", 지훈: "lav", 현우: "slate", 수민: "peach", 예린: "amber", 태호: "blue", 가은: "amber",
  민재: "mint", 보람: "mint", 도현: "mint", 하은: "mint", 시우: "mint",
  지은: "peach", 소율: "peach", 지성: "peach", 은지: "peach",
  하나: "lav", 다은: "lav", 태윤: "lav", 나연: "lav", 다인: "lav",
  도윤: "slate",
  아린: "amber", 유진: "amber", 준서: "amber", 현준: "amber",
  승호: "blue",
};

sqlTest("seed: 29 users with palette tones and fixed uuids", withCase(db, async (q) => {
  const rows = await q("select id::text as id, nickname, avatar_tone, email::text as email, nickname_normalized from public.profiles where email like '%@sgtudy.local' order by id");
  assertEquals(rows.length, 29);
  for (const r of rows) {
    assertEquals(r.avatar_tone, NAME_TONE[r.nickname as string], `tone of ${r.nickname}`);
    assertEquals(/^00000000-0000-4000-8000-0000000000\d{2}$/.test(r.id as string), true, r.id as string);
    assertEquals(r.nickname_normalized, r.nickname);
  }
  assertEquals(Object.keys(NAME_TONE).length, 29);
}));

sqlTest("seed: 철수 is user 01, 민수 is user 02, identities exist", withCase(db, async (q) => {
  const c = await q("select nickname from public.profiles where id = '00000000-0000-4000-8000-000000000001'");
  assertEquals(c[0].nickname, "철수");
  const m = await q("select nickname from public.profiles where id = '00000000-0000-4000-8000-000000000002'");
  assertEquals(m[0].nickname, "민수");
  const idn = await q("select count(*)::int as n from auth.identities i join public.profiles p on p.id = i.user_id where p.email like '%@sgtudy.local'");
  assertEquals(idn[0].n, 29);
}));

sqlTest("seed: is idempotent", withCase(db, async (q) => {
  await applySeed(db);
  const n = await q("select count(*)::int as n from public.profiles where email like '%@sgtudy.local'");
  assertEquals(n[0].n, 29);
}));

sqlTest("seed: last statement pins today = 2026-10-12 in internal.settings (02 §8)", withCase(db, async () => {
  const text = await Deno.readTextFile(new URL("../seed.sql", import.meta.url));
  const stmts = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--"));
  assertEquals(stmts.at(-1), "insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;");
}));

sqlTest("seed: after seeding, kst_today() is 2026-10-12 without any session setting", withCase(db, async (q) => {
  await q("select set_config('app.today', '', true)");
  assertEquals((await q("select public.kst_today()::text as d"))[0].d, "2026-10-12");
}));

// supabase CLI 는 seed 를 비 superuser `postgres` 로, pgx 배치(전 문장 선 Parse)로 보낸다.
sqlTest("seed: no superuser-only statements and no temp table shared across top-level statements", withCase(db, async () => {
  const text = await Deno.readTextFile(new URL("../seed.sql", import.meta.url));
  const code = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assertEquals(/alter\s+(database|role|system)\b/i.test(code), false, "alter database/role/system needs superuser on Supabase");
  const outsideDo = code.replace(/do\s+(\$\w*\$)[\s\S]*?\1\s*;/gi, "");
  assertEquals(/create\s+temp(orary)?\s+table/i.test(outsideDo), false, "temp table must live inside a do block");
}));
