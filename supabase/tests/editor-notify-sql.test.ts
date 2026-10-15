// 0012 진행목표 편집 권한 알림 — member_set_curriculum_editor 가 값이 실제로 바뀔 때만 대상 멤버에게 알린다
import { assertEquals } from "@std/assert";
import { applySeed, asUser, openDb } from "./_harness.ts";
import { cases, one, type Q, type Row, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const grant = (q: Q, slug: string, user: string, allow: boolean) =>
  one(q, "select public.member_set_curriculum_editor($1, $2::uuid, $3) as m", [slug, user, allow]).then((r) => r.m as Row);
/** 이 사례 트랜잭션이 만든 편집 권한 알림만 (시드 행 제외) */
const rowsOf = (q: Q, uid: string) =>
  q(`select kind, title, body, link, actor_user_id::text as actor from public.notifications
     where user_id = $1::uuid and kind like 'CURRICULUM_EDITOR_%' and created_at >= now() order by id`, [uid]);

cases("editor notifications", db, [
  { name: "kinds are registered", run: async (q) => {
    const k = (await one(q, "select public.notification_kinds() as k")).k as string[];
    assertEquals([k.includes("CURRICULUM_EDITOR_GRANTED"), k.includes("CURRICULUM_EDITOR_REVOKED"), k.includes("MEMBER_DEACTIVATED")], [true, true, true]);
  } },

  { name: "grant notifies the member once; idempotent grant adds nothing; leader not notified", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const chulsu = await uidOf(q, "철수");
    await asUser(q, minsu);
    await grant(q, "aws", chulsu, true);
    await grant(q, "aws", chulsu, true);
    const r = await rowsOf(q, chulsu);
    assertEquals(r.length, 1);
    assertEquals([r[0].kind, r[0].title, r[0].link, r[0].actor], ["CURRICULUM_EDITOR_GRANTED", "진행목표 편집 권한을 받았어요", "/my-study/aws?tab=curriculum", minsu]);
    assertEquals((await rowsOf(q, minsu)).length, 0);
  } },

  { name: "revoke notifies; revoking a non-editor notifies nobody", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const chulsu = await uidOf(q, "철수");
    const jieun = await uidOf(q, "지은");
    await asUser(q, minsu);
    await grant(q, "aws", jieun, false);                       // 원래 false → 변화 없음
    assertEquals((await rowsOf(q, jieun)).length, 0);
    await q("update public.room_members m set can_edit_curriculum = true from public.rooms r where r.id = m.room_id and r.slug = 'aws' and m.user_id = $1::uuid", [chulsu]);
    await grant(q, "aws", chulsu, false);
    await grant(q, "aws", chulsu, false);
    const r = await rowsOf(q, chulsu);
    assertEquals(r.map((x) => [x.kind, x.title, x.link]), [["CURRICULUM_EDITOR_REVOKED", "진행목표 편집 권한이 회수됐어요", "/my-study/aws?tab=curriculum"]]);
    assertEquals((await rowsOf(q, minsu)).length, 0);
  } },

  { name: "notification_json exposes the kind to the list", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    await asUser(q, await uidOf(q, "민수"));
    await grant(q, "aws", chulsu, true);
    await asUser(q, chulsu);
    const items = (await one(q, "select public.notifications_list(null, 50) as l")).l.items as Row[];
    const n = items.find((x) => x.kind === "CURRICULUM_EDITOR_GRANTED");
    assertEquals([n?.title, n?.link, n?.room?.slug], ["진행목표 편집 권한을 받았어요", "/my-study/aws?tab=curriculum", "aws"]);
  } },
]);
