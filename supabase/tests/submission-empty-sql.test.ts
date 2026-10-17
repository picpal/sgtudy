// 0022 빈 제출 — 팀 과제(COMMON·DESIGNATED)는 본문·링크·첨부가 모두 없으면 SUBMISSION_EMPTY. 개인 목표는 빈 저장 허용(완료 유지 → 완료 취소, QA Q1-2)
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

/** Storage 업로드 흉내(storage.objects 스텁 행) — files-sql.test 와 같은 방식 */
async function uploaded(q: Q, path: string, owner: string) {
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, owner, JSON.stringify({ size: 1234, mimetype: "image/png" })]);
}

cases("submission empty (0022)", db, [
  { name: "팀 과제: 본문(공백뿐)·링크·첨부 모두 없으면 SUBMISSION_EMPTY — 처음 제출도, 수정으로 비우기도", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");          // 철수 담당, 진행 중
    await expectFail(q("select public.submission_upsert($1::bigint, '', '{}', '{}')", [ec2]), "SUBMISSION_EMPTY");
    await expectFail(q("select public.submission_upsert($1::bigint, E' \\n\\t ', null, null)", [ec2]), "SUBMISSION_EMPTY");
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1::bigint and user_id = public.require_user()", [ec2])).n, 0);
    await submit(q, ec2, "본문");
    await expectFail(q("select public.submission_upsert($1::bigint, '', '{}', '{}')", [ec2]), "SUBMISSION_EMPTY");
    assertEquals((await one(q, "select body_md from public.submissions where node_id = $1::bigint and user_id = public.require_user()", [ec2])).body_md, "본문");
  } },
  { name: "팀 과제: 링크만·첨부만(file_register 뒤 upsert) 제출은 된다", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    assertEquals((await submit(q, ec2, "", ["https://example.com/a"])).links, ["https://example.com/a"]);
    const fid = crypto.randomUUID();
    const path = `${await roomId(q, "aws")}/${ec2}/${cheolsu}/${fid}.png`;
    await uploaded(q, path, cheolsu);
    await one(q, "select public.file_register($1::bigint, $2, 'a.png', 'image/png', 1234::bigint)", [ec2, path]);
    const s = await submit(q, ec2, "", [], [fid]);
    assertEquals([s.bodyMd, s.links, s.files.length], ["", [], 1]);
  } },
  { name: "유형 없는 노드(task_type NULL — 회차·묶음)는 빈 검사 전에 submission_target 이 NODE_NOT_LEAF 로 막는다 (최종 리뷰 Minor 4: 0022 의 <> 'PERSONAL' 이 NULL 을 놓쳐도 도달 불가)", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const round = (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = '2주차'")).id;
    await expectFail(q("select public.submission_upsert($1::bigint, '', '{}', '{}')", [round]), "NODE_NOT_LEAF");
  } },
  { name: "개인 목표: 빈 저장 허용 유지 — 완료(빈 제출) 남고 그 뒤 완료 취소", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const round = (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = '2주차'")).id;
    const c = (await one(q, "select public.personal_create('aws', $1::bigint, '빈 저장 목표', null, null) as c", [round])).c;
    const id = c.createdId as string;
    await submit(q, id, "메모");
    const s = await submit(q, id, "");
    assertEquals(s.bodyMd, "");
    await one(q, "select public.personal_complete('aws', $1::bigint, false) as c", [id]);
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1::bigint", [id])).n, 0);
    assertEquals((await submit(q, id, "")).bodyMd, "");                      // 처음 저장도 빈 채로 가능(= 완료로 표시와 같음)
  } },
]);
