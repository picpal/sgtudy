import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf } from "./_fixtures.ts";

// 0036: O1 anon 의 public_profiles 직접 열람 차단(사람 정보는 security definer RPC JSON 으로만) · G1 첨부 직접 삭제 정책 제거
const db = await openDb();
await applySeed(db);

cases("security 0036", db, [
  { name: "O1: anon has no privilege on public_profiles; authenticated keeps select only", run: async (q) => {
    const priv = async (role: string, p: string) => (await one(q, "select has_table_privilege($1, 'public.public_profiles', $2) as ok", [role, p])).ok;
    assertEquals(await priv("anon", "select"), false);
    assertEquals(await priv("authenticated", "select"), true);
    for (const p of ["insert", "update", "delete"]) assertEquals(await priv("authenticated", p), false, p);
    await asAnon(q);
    await q("set local role anon");
    await expectFail(q("select id, nickname from public.public_profiles"), "permission denied");
    await q("reset role");
    await asUser(q, await uidOf(q, "철수"));
    await q("set local role authenticated");
    const rows = await q("select id, nickname from public.public_profiles");
    await q("reset role");
    assertEquals(rows.length > 0, true);
  } },

  { name: "O1: anon-facing RPCs (room_get, rooms_list) still carry the leader nickname via person_json", run: async (q) => {
    const room = await roomId(q, "aws");
    const { leader } = await one(q, "select p.nickname as leader from public.rooms r join public.profiles p on p.id = r.leader_id where r.id = $1", [room]);
    await asAnon(q);
    await q("set local role anon");
    const { r } = await one(q, "select public.room_get($1) as r", ["aws"]);
    const { l } = await one(q, "select public.rooms_list(p_size => 50) as l");
    await q("reset role");
    assertEquals(r.leader.nickname, leader);
    const card = JSON.stringify(l);
    assertEquals(card.includes(`"nickname": "${leader}"`) || card.includes(`"nickname":"${leader}"`), true, "rooms_list leader nickname");
  } },

  { name: "G1: attachments_delete_own is gone — an author's client-side delete removes nothing", run: async (q) => {
    const pols = await q("select polname from pg_policy where polrelid = 'storage.objects'::regclass and polcmd = 'd'");
    assertEquals(pols, []);
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const path = `${room}/${ec2}/${cheolsu}/${crypto.randomUUID()}.png`;
    await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, '{\"size\":1}'::jsonb)", [path, cheolsu]);
    await q("grant usage on schema storage to authenticated");
    await q("grant select, delete on storage.objects to authenticated");          // 호스팅 기본 GRANT 흉내 — 막는 것은 정책 부재여야 한다
    await asUser(q, cheolsu);
    await q("set local role authenticated");
    const del = await q("delete from storage.objects where name = $1 returning name", [path]);
    await q("reset role");
    assertEquals(del, []);
    assertEquals((await one(q, "select count(*)::int as n from storage.objects where name = $1", [path])).n, 1);
  } },
]);
