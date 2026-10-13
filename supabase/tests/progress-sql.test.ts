import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, progress, submit, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

sqlTest("goal_nodes_guard: 직접 INSERT/UPDATE 도 depth=부모+1·round_id 일치·label 은 depth 2 만 (A1)", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const ins = (cols: string, vals: unknown[]) =>
    q(`insert into public.goal_nodes (${cols}) values (${vals.map((_, i) => "$" + (i + 1)).join(",")}) returning id::text as id, round_id::text as round_id`, vals);
  // 루트: round_id 를 비워 두면 자기 id 로 채운다
  const [root] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date", [room.id, null, 2, 0, "1주차", "R", "2026-11-01", "2026-11-07"]);
  assertEquals(root.round_id, root.id);
  // 하위: round_id 를 비워 두면 부모의 round_id 를 물려받는다
  const [child] = await ins("room_id, parent_id, depth, sort_order, title, start_date, end_date, task_type", [room.id, root.id, 3, 0, "C", "2026-11-01", "2026-11-03", "COMMON"]);
  assertEquals(child.round_id, root.id);
  const base = "room_id, parent_id, depth, sort_order, title, start_date, end_date";
  await expectFail(ins(base, [room.id, root.id, 4, 1, "깊이 틀림", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base + ", round_id", [room.id, root.id, 3, 1, "회차 틀림", "2026-11-01", "2026-11-03", child.id]), "VALIDATION_FAILED");
  await expectFail(ins(base + ", label", [room.id, root.id, 3, 1, "하위 라벨", "2026-11-01", "2026-11-03", "x"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 3, 1, "루트 깊이 3", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 2, 1, "루트 라벨 없음", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  await expectFail(ins(base, [other.id, root.id, 3, 0, "다른 방 부모", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  // UPDATE 도 같은 규칙: 회차 라벨 지우기·하위에 라벨
  await expectFail(q("update public.goal_nodes set label = null where id = $1", [root.id]), "VALIDATION_FAILED");
  await expectFail(q("update public.goal_nodes set label = 'x' where id = $1", [child.id]), "VALIDATION_FAILED");
  // depth-2 리프(회차 자체가 과제)는 허용(A7)
  const [leafRoot] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type",
    [room.id, null, 2, 1, "2주차", "회차 과제", "2026-11-08", "2026-11-14", "COMMON"]);
  assertEquals(leafRoot.round_id, leafRoot.id);
}));

sqlTest("node_subtree / node_has_submissions: 자기 포함 서브트리, 제출물은 어느 깊이든 감지", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const leaf = await mkLeaf(q, mid, "리프", "COMMON", "2026-11-01", "2026-11-03");
  const r2 = await mkRound(q, room.id, "2주차", "회차2", "2026-11-08", "2026-11-14");
  const rows = await q("select s::text as id from public.node_subtree($1) s order by s", [r1]);
  assertEquals(rows.map((x) => x.id), [r1, mid, leaf].sort((a, b) => Number(a) - Number(b)));
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, false);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, leaf, "서연");
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [mid]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [r2]))[0].b, false);
}));

sqlTest("node_assert_editable: 그룹장·상태·보관 검사, node_get: 방 소속", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  assertEquals((await q("select (public.node_assert_editable($1)).id::text as id", [room.slug]))[0].id, room.id);
  await asUser(q, await uid(q, "민수"));
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_FOUND");   // DRAFT: 외부인은 존재도 모른다 (I-2)
  await q("update public.rooms set status = 'RECRUIT' where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "NOT_LEADER");   // 공개 RECRUIT 는 읽을 수 있다
  await q("update public.rooms set status = 'DRAFT' where id = $1", [room.id]);
  await asAnon(q);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "AUTH_REQUIRED");
  await asUser(q, room.leader);
  await expectFail(q("select public.node_assert_editable($1)", ["no-such-room"]), "ROOM_NOT_FOUND");
  await q("update public.rooms set status = 'ENDED' where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  await q("update public.rooms set status = 'ACTIVE', archived_at = now() where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  // node_get: 다른 방의 노드 id 는 NODE_NOT_FOUND
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  assertEquals((await q("select (public.node_get($1, $2)).id::text as id", [room.id, r1]))[0].id, r1);
  await expectFail(q("select public.node_get($1, $2)", [other.id, r1]), "NODE_NOT_FOUND");
}));

sqlTest("room_progress: 리프 asg/sub 를 조상까지 합산, 보관 서브트리 제외, pct half-up", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await mkRoom(q, "서연");
  // 서연(그룹장, leader_does_tasks=true) + 민수 + 지훈 = 담당 3명
  for (const n of ["민수", "지훈"]) {
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at) values ($1, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [room.id, await uid(q, n)]);
  }
  await q("update public.rooms set member_count = 3 where id = $1", [room.id]);
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const a = await mkLeaf(q, mid, "A", "COMMON", "2026-11-01", "2026-11-03");       // 3명
  const b = await mkLeaf(q, r1, "B", "DESIGNATED", "2026-11-04", "2026-11-07");   // 지정 1명
  const c = await mkLeaf(q, r1, "C", "COMMON", "2026-11-04", "2026-11-07");       // 3명, 보관 예정
  await q(`insert into public.task_assignments (node_id, user_id, source) values ($1, $2::uuid, 'DESIGNATED')`, [b, await uid(q, "민수")]);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, a, "서연"); await submit(q, a, "민수", true);
  await submit(q, b, "민수");
  await submit(q, c, "지훈");
  let p = await progress(q, room.id);
  assertEquals(p[a], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[b], { asg: 1, sub: 1, pct: 100 });
  assertEquals(p[c], { asg: 3, sub: 1, pct: 33 });
  assertEquals(p[mid], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[r1], { asg: 7, sub: 4, pct: 57 });            // 4/7 = 57.14
  // C 보관 → 집계 제외(행은 0/0, pct null). resync 가 C 의 COMMON 행을 released 로 돌린다
  await q("update public.goal_nodes set archived_at = now() where id = $1", [c]);
  await q("select public.assignment_resync($1)", [room.id]);
  p = await progress(q, room.id);
  assertEquals(p[c], { asg: 0, sub: 0, pct: null });
  assertEquals(p[r1], { asg: 4, sub: 3, pct: 75 });
  // room_leaf_stats 는 같은 숫자를 돌려주고 보관 리프는 빠진다
  const ls = await q("select node_id::text as id, asg, sub from public.room_leaf_stats($1) order by node_id", [room.id]);
  assertEquals(ls, [{ id: a, asg: 3, sub: 2 }, { id: b, asg: 1, sub: 1 }]);
  // 빈 방은 빈 집합
  const empty = await mkRoom(q, "지훈", { title: "빈 방 Empty" });
  assertEquals(Object.keys(await progress(q, empty.id)).length, 0);
}));
