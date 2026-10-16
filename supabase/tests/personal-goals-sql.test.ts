// 0014 개인 목표 — 팀원이 회차 아래에 직접 만드는 PERSONAL 리프. 배정 행 없음, 소유자 = owner_id
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { nodeByTitle, roomId } from "./_curriculum-helpers.ts";
import { cases, one, type Q, type Row, setNow, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

/** aws 회차 id (라벨로) */
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
/** 표에 직접 개인 목표 한 줄 (RPC 가 생기기 전 Task 1 용) */
async function rawPersonal(q: Q, round: string, owner: string, title: string): Promise<string> {
  const r = await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                          select n.room_id, n.id, n.id, 3, 99, $2, n.start_date, n.end_date, 'PERSONAL', $3::uuid from public.goal_nodes n where n.id = $1
                          returning id::text as id`, [round, title, owner]);
  return r.id as string;
}

cases("personal goals · schema", db, [
  { name: "제약: PERSONAL 은 owner 필수, owner 는 PERSONAL 에만, depth 3 만", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const chulsu = await uidOf(q, "철수");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'PERSONAL' from public.goal_nodes where id = $1`, [r2]), "ck_goal_nodes_owner");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'COMMON', $2::uuid from public.goal_nodes where id = $1`, [r2, chulsu]), "ck_goal_nodes_owner");
    const aws = await roomId(q, "aws");
    const bundle = await nodeByTitle(q, aws, "로드밸런서 비교");   // 3주차 묶음(depth 3) 아래 = depth 4
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, round_id, 4, 99, 'x', start_date, end_date, 'PERSONAL', $2::uuid from public.goal_nodes where id = $1`, [bundle, chulsu]), "ck_goal_nodes_personal_depth");
  } },
  { name: "트리거: 개인 목표 아래에는 아무것도 못 둔다 (PERSONAL_NODE)", run: async (q) => {
    const p = await rawPersonal(q, await roundOf(q, "2주차"), await uidOf(q, "철수"), "개인 A");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, round_id, 4, 0, 'x', start_date, end_date, 'COMMON' from public.goal_nodes where id = $1`, [p]), "PERSONAL_NODE");
  } },
  { name: "node_* 는 개인 목표를 대상으로도 부모로도 못 쓴다 (그룹장도)", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const r3 = await roundOf(q, "3주차");
    const p = await rawPersonal(q, r2, await uidOf(q, "철수"), "개인 A");
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.node_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [p, r3]), "PERSONAL_NODE");
    await expectFail(q("select public.node_delete('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_archive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_unarchive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_create('aws', $1, 'x')", [p]), "PERSONAL_NODE");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [ec2, p]), "PERSONAL_NODE");
  } },
  { name: "회차 삭제는 개인 목표를 함께 지운다 (제출 없을 때)", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const c0 = await one(q, "select public.node_create('aws', null, '임시 회차', null, null, '2026-12-01', '2026-12-07') as c");
    const round = (c0.c.nodes as Row[]).find((n) => n.title === "임시 회차")!.id as string;
    await rawPersonal(q, round, await uidOf(q, "철수"), "개인 B");
    const c = (await one(q, "select public.node_delete('aws', $1) as c", [round])).c;
    assertEquals((c.nodes as Row[]).some((n) => n.title === "개인 B"), false);
  } },
  { name: "is_task_assignee: 보관 아닌 개인 목표의 소유자만 참", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    const p = await rawPersonal(q, await roundOf(q, "2주차"), chulsu, "개인 A");
    const yes = async (u: string) => (await one(q, "select public.is_task_assignee($1, $2::uuid) as v", [p, u])).v as boolean;
    assertEquals([await yes(chulsu), await yes(await uidOf(q, "지은"))], [true, false]);
    await q("update public.goal_nodes set archived_at = now() where id = $1", [p]);
    assertEquals(await yes(chulsu), false);
  } },
  { name: "RLS 정책: 남의 개인 목표는 owner_id 조건이 붙는다", run: async (q) => {
    const pol = await one(q, "select pg_get_expr(polqual, polrelid) as e from pg_policy where polname = 'goal_nodes_select'");
    assert(String(pol.e).includes("owner_id"));
    assert(String(pol.e).includes("can_read_submissions"));
  } },
  { name: "RLS 직접 조회: 외부인·비로그인·대기자에겐 남의 개인 목표 행이 없다", run: async (q) => {
    const p = await rawPersonal(q, await roundOf(q, "2주차"), await uidOf(q, "철수"), "개인 RLS");
    await q("update public.room_members set status = 'PENDING', joined_at = null where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')",
            [await uidOf(q, "하나")]);
    // 호스티드 supabase 는 anon·authenticated 에 표 select 를 기본 부여한다 — PGlite 스텁엔 없어 이 케이스 안에서만 준다(롤백)
    await q("grant usage on schema public, auth to anon, authenticated");
    await q("grant execute on all functions in schema auth to anon, authenticated");
    await q("grant select on public.goal_nodes, public.rooms to anon, authenticated");
    const seen = async (role: string, nick: string | null) => {
      if (nick) await asUser(q, await uidOf(q, nick)); else await asAnon(q);
      await q(`set local role ${role}`);
      const n = (await one(q, "select count(*)::int as n from public.goal_nodes where id = $1", [p])).n as number;
      const team = (await one(q, "select count(*)::int as n from public.goal_nodes g join public.rooms r on r.id = g.room_id where r.slug = 'aws'")).n as number;
      await q("reset role");
      return [n, team > 0];
    };
    assertEquals(await seen("authenticated", "철수"), [1, true]);
    assertEquals(await seen("authenticated", "지은"), [1, true]);
    assertEquals(await seen("authenticated", "도윤"), [1, true]);
    assertEquals(await seen("authenticated", "서연"), [0, true]);
    assertEquals(await seen("authenticated", "하나"), [0, true]);
    assertEquals(await seen("anon", null), [0, true]);
  } },
]);

const create = (q: Q, round: string, title: string, s?: string, e?: string) =>
  one(q, "select public.personal_create('aws', $1, $2, $3::date, $4::date) as c", [round, title, s ?? null, e ?? null]).then((r) => r.c as Row);
const nodeOf = (c: Row, id: string) => (c.nodes as Row[]).find((n) => n.id === id)!;

cases("personal goals · write", db, [
  { name: "create: 편집 권한 없는 ACTIVE 멤버, 기본 기간 = 회차, 끝 순서, 팀 수치 불변", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    await asUser(q, await uidOf(q, "철수"));
    const before = (await one(q, "select public.curriculum_get('aws', true) as c")).c;
    const c = await create(q, r3, "  Udemy 7강 듣기  ");
    const n = nodeOf(c, c.createdId);
    assertEquals([n.title, n.startDate, n.endDate, n.parentId, n.depth], ["Udemy 7강 듣기", "2026-10-15", "2026-10-21", r3, 3]);
    assertEquals([n.task.type, n.task.assigned, n.task.submitted], ["personal", 1, 0]);
    assertEquals(n.sortOrder, Math.max(...(c.nodes as Row[]).filter((x) => x.parentId === r3).map((x) => x.sortOrder)));
    assertEquals(c.stats, before.stats);
    assertEquals(nodeOf(c, r3).pct, nodeOf(before, r3).pct);
    assertEquals(c.warnings, []);
  } },
  { name: "create 거부: 대기자·외부인·이탈자 / 종료 방 / 보관 회차 / 방 기간 밖 / 80자 초과 / 한도 20", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    await asUser(q, await uidOf(q, "서연"));
    await expectFail(create(q, r3, "x"), "NOT_ACTIVE_MEMBER");
    await asUser(q, await uidOf(q, "도윤"));                                   // INACTIVE
    await expectFail(create(q, r3, "x"), "NOT_ACTIVE_MEMBER");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(create(q, r3, "x", "2026-09-30", "2026-10-02"), "INVALID_PERIOD");
    await expectFail(create(q, r3, "가".repeat(81)), "INVALID_TITLE");
    for (let i = 0; i < 20; i++) await create(q, r3, `목표 ${i}`);
    await expectFail(create(q, r3, "21번째"), "PERSONAL_LIMIT_EXCEEDED");
    await asUser(q, await uidOf(q, "민수"));
    await q("select public.node_archive('aws', $1)", [await roundOf(q, "4주차")]);
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(create(q, await roundOf(q, "4주차"), "x"), "PARENT_ARCHIVED");
    await q("update public.rooms set status = 'ENDED' where slug = 'aws'");
    await expectFail(create(q, r3, "x"), "ROOM_NOT_EDITABLE");
  } },
  { name: "update: 소유자만, 회차 이동 + 기간을 한 번에, 회차 밖 경고", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    const r4 = await roundOf(q, "4주차");
    await asUser(q, await uidOf(q, "철수"));
    const id = (await create(q, r3, "A")).createdId as string;
    let c = (await one(q, "select public.personal_update('aws', $1, $2::jsonb) as c",
      [id, JSON.stringify({ roundId: r4, startDate: "2026-10-22", endDate: "2026-10-24", title: "A2" })])).c;
    assertEquals([nodeOf(c, id).parentId, nodeOf(c, id).roundId, nodeOf(c, id).startDate, nodeOf(c, id).title, c.warnings], [r4, r4, "2026-10-22", "A2", []]);
    c = (await one(q, "select public.personal_update('aws', $1, '{\"endDate\":\"2026-10-30\"}'::jsonb) as c", [id])).c;
    assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: id }]);
    await expectFail(q("select public.personal_update('aws', $1, '{\"owner\":\"x\"}'::jsonb)", [id]), "VALIDATION_FAILED");
    await asUser(q, await uidOf(q, "민수"));                                   // 그룹장도 내용은 못 고친다
    await expectFail(q("select public.personal_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [id]), "NOT_OWNER");
    await asUser(q, await uidOf(q, "서연"));                                   // 외부인: 존재 숨김
    await expectFail(q("select public.personal_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [id]), "NODE_NOT_FOUND");
  } },
  { name: "complete: 빈 제출로 완료·지각 판정, 내용 없는 완료만 취소", run: async (q) => {
    const r2 = await roundOf(q, "2주차");                                      // 10.08–10.14, 오늘 10.12
    await setNow(q, "2026-10-12T03:00:00Z");                                   // app_now 고정(실제 시각과 무관하게)
    await asUser(q, await uidOf(q, "철수"));
    const late = (await create(q, await roundOf(q, "1주차"), "지난 목표")).createdId as string;   // 10.01–10.07 → 마감 지남
    const cl = (await one(q, "select public.personal_complete('aws', $1, true) as c", [late])).c;
    assertEquals(nodeOf(cl, late).task.people[0].status, "late");
    const id = (await create(q, r2, "B")).createdId as string;
    let c = (await one(q, "select public.personal_complete('aws', $1, true) as c", [id])).c;
    assertEquals([nodeOf(c, id).task.submitted, nodeOf(c, id).task.people[0].status], [1, "done"]);
    await one(q, "select public.personal_complete('aws', $1, true) as c", [id]);   // 멱등
    c = (await one(q, "select public.personal_complete('aws', $1, false) as c", [id])).c;
    assertEquals(nodeOf(c, id).task.submitted, 0);
    await q("select public.submission_upsert($1, '메모', '{}', '{}')", [id]);      // 제출 카드 경로도 소유자에게 열린다
    await expectFail(q("select public.personal_complete('aws', $1, false)", [id]), "SUBMISSION_HAS_CONTENT");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(q("select public.personal_complete('aws', $1, true)", [id]), "NOT_OWNER");
  } },
  { name: "archive/delete: 소유자·그룹장, 그룹장은 제출 있으면 삭제 불가, 소유자는 제출째 삭제", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const chulsu = await uidOf(q, "철수");
    await asUser(q, chulsu);
    const id = (await create(q, r2, "C")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.personal_delete('aws', $1)", [id]), "NODE_HAS_SUBMISSIONS");
    let c = (await one(q, "select public.personal_archive('aws', $1, true) as c", [id])).c;
    assertEquals(nodeOf(c, id).archived, true);
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(q("select public.personal_archive('aws', $1, false)", [id]), "NOT_OWNER");
    await asUser(q, chulsu);
    c = (await one(q, "select public.personal_archive('aws', $1, false) as c", [id])).c;
    assertEquals(nodeOf(c, id).archived, false);
    c = (await one(q, "select public.personal_delete('aws', $1) as c", [id])).c;
    assertEquals((c.nodes as Row[]).some((n) => n.id === id), false);
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1", [id])).n, 0);
  } },
]);

const cur = (q: Q) => one(q, "select public.curriculum_get('aws', true) as c").then((r) => r.c as Row);
const hasTitle = (c: Row, t: string) => (c.nodes as Row[]).some((n) => n.title === t);

cases("personal goals · read", db, [
  { name: "노출: 소유자·그룹장·ACTIVE·INACTIVE 는 보고, 외부인·비로그인·대기자는 못 본다", run: async (q) => {
    await asUser(q, await uidOf(q, "철수"));
    const id = (await create(q, await roundOf(q, "3주차"), "철수 목표")).createdId as string;
    for (const nick of ["철수", "민수", "지은", "도윤"]) { await asUser(q, await uidOf(q, nick)); assert(hasTitle(await cur(q), "철수 목표"), nick); }
    await asUser(q, await uidOf(q, "서연")); assertEquals(hasTitle(await cur(q), "철수 목표"), false);
    await asAnon(q);                          assertEquals(hasTitle(await cur(q), "철수 목표"), false);
    await asAnon(q);
    await expectFail(q("select public.task_get('aws', $1)", [id]), "NODE_NOT_FOUND");
    await asUser(q, await uidOf(q, "지은"));
    const t = (await one(q, "select public.task_get('aws', $1) as t", [id])).t;
    assertEquals([t.node.task.type, t.node.ownerId, t.node.task.people.length, t.isAssignee], ["personal", await uidOf(q, "철수"), 1, false]);
  } },
  { name: "팀 수치 불변: 완료해도 stats·회차 pct·room_get stats/myProgress 그대로", run: async (q) => {
    await asUser(q, await uidOf(q, "철수"));
    const r2 = await roundOf(q, "2주차");
    const c0 = await cur(q);
    const d0 = (await one(q, "select public.room_get('aws') as d")).d;
    const id = (await create(q, r2, "D")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    const c1 = await cur(q);
    const d1 = (await one(q, "select public.room_get('aws') as d")).d;
    assertEquals([c1.stats, nodeOf(c1, r2).assigned, nodeOf(c1, r2).submitted], [c0.stats, nodeOf(c0, r2).assigned, nodeOf(c0, r2).submitted]);
    assertEquals([d1.stats, d1.rounds, d1.myProgress, d1.currentRound], [d0.stats, d0.rounds, d0.myProgress, d0.currentRound]);
    assertEquals([nodeOf(c1, id).assigned, nodeOf(c1, id).submitted, nodeOf(c1, id).task.state], [1, 1, "complete"]);
  } },
  { name: "curriculum.personal: canAdd(ACTIVE·그룹장·RECRUIT/ACTIVE), perRound 20, myPermissions 모양 그대로", run: async (q) => {
    await asUser(q, await uidOf(q, "지은"));
    let c = await cur(q);
    assertEquals([c.personal, c.myPermissions], [{ canAdd: true, perRound: 20 }, { canEditCurriculum: false }]);
    await asUser(q, await uidOf(q, "도윤"));
    assertEquals((await cur(q)).personal, { canAdd: false, perRound: 20 });
    await asAnon(q);
    assertEquals((await cur(q)).personal, { canAdd: false, perRound: 20 });
  } },
  { name: "자격 상실(INACTIVE) → resync 가 그 사람 개인 목표를 보관, 제출 보존, 재ACTIVE 후 본인 해제", run: async (q) => {
    const hana = await uidOf(q, "하나");
    await asUser(q, hana);
    const id = (await create(q, await roundOf(q, "2주차"), "하나 목표")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    // member_deactivate 는 하나의 단독 지정 과제(S3) 재지정 결정이 필요하다 — 여기선 resync 단계만 검증한다(이탈 RPC 끝은 resync)
    await q("update public.room_members set status = 'INACTIVE', left_at = now() where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [hana]);
    await q("select public.assignment_resync((select id from public.rooms where slug = 'aws'))");
    await asUser(q, await uidOf(q, "민수"));
    assertEquals(nodeOf(await cur(q), id).archived, true);
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1", [id])).n, 1);
    await expectFail(q("select public.personal_archive('aws', $1, false)", [id]), "OWNER_NOT_ACTIVE");
    await q("update public.room_members set status = 'ACTIVE', left_at = null where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [hana]);
    await asUser(q, hana);
    assertEquals(nodeOf((await one(q, "select public.personal_archive('aws', $1, false) as c", [id])).c, id).archived, false);
  } },
  { name: "자동 태그는 개인 목표 제목을 보지 않는다", run: async (q) => {
    const tagsOf = async () => (await q(`select rt.tag_slug as slug from public.room_tags rt
                                         join public.rooms r on r.id = rt.room_id where r.slug = 'aws' order by 1`)).map((t) => t.slug);
    await q("select public.tag_autoselect((select id from public.rooms where slug = 'aws'))");
    const before = await tagsOf();
    await asUser(q, await uidOf(q, "철수"));
    await create(q, await roundOf(q, "3주차"), "Kubernetes Docker React Java Spring 정리");   // 시드 CURATED 용어 여러 개
    await q("select public.tag_autoselect((select id from public.rooms where slug = 'aws'))");
    assertEquals(await tagsOf(), before);
  } },
]);

cases("personal goals · dto", db, [
  { name: "노드 DTO: 팀 노드는 ownerId null(키는 있음), 개인 목표는 소유자 uid — curriculum·task_get 같은 값", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    await asUser(q, chulsu);
    const id = (await create(q, await roundOf(q, "2주차"), "DTO")).createdId as string;
    const c = await cur(q);
    const team = (c.nodes as Row[]).filter((n) => n.id !== id);
    assert(team.length > 0 && team.every((n) => "ownerId" in n && n.ownerId === null));
    assertEquals(nodeOf(c, id).ownerId, chulsu);
    const ec2 = await nodeByTitle(q, await roomId(q, "aws"), "EC2 인스턴스 유형 정리");
    const t = (await one(q, "select public.task_get('aws', $1) as t", [ec2])).t;
    assertEquals(["ownerId" in t.node, t.node.ownerId], [true, null]);
    assertEquals((await one(q, "select public.task_get('aws', $1) as t", [id])).t.node.ownerId, chulsu);
  } },
]);

cases("personal goals · me", db, [
  { name: "me_tasks: 내 배정 팀 리프 + 내 개인 목표, 남의 것 없음, 방·회차·현재 회차", run: async (q) => {
    const jieun = await uidOf(q, "지은");
    await asUser(q, await uidOf(q, "철수"));
    await create(q, await roundOf(q, "2주차"), "철수 것");
    await asUser(q, jieun);
    const id = (await create(q, await roundOf(q, "2주차"), "지은 것")).createdId as string;
    const m = (await one(q, "select public.me_tasks() as m")).m;
    const titles = (m.items as Row[]).map((i) => i.title);
    assert(titles.includes("지은 것") && !titles.includes("철수 것"));
    assert(titles.includes("EC2 인스턴스 유형 정리"));            // 지은 지정 배정(시드 '-DO-')
    const aws = (m.studies as Row[]).find((s) => s.slug === "aws")!;
    assertEquals([aws.membership, aws.canAddPersonal, aws.currentRoundId], ["joined", true, await roundOf(q, "2주차")]);
    assertEquals((m.items as Row[]).find((i) => i.id === id)!.type, "personal");
    assertEquals(m.personalPerRound, 20);
    assert((m.rounds as Row[]).some((r) => r.slug === "aws" && r.label === "3주차" && r.canAdd === true));
  } },
  { name: "me_schedule: 내 개인 목표 포함(personal true), 대기자 미리보기·과제 안 하는 그룹장 화면에 남의 개인 목표 없음", run: async (q) => {
    await asUser(q, await uidOf(q, "지은"));
    await create(q, await roundOf(q, "2주차"), "지은 일정");
    const s = (await one(q, "select public.me_schedule('2026-10-01', '2026-10-31') as s")).s;
    assertEquals((s.tasks as Row[]).find((t) => t.title === "지은 일정")!.personal, true);
    assertEquals((s.tasks as Row[]).find((t) => t.title === "EC2 인스턴스 유형 정리")!.personal, false);
    // 과제 안 하는 그룹장: 시드 sqld 그룹장(leader_does_tasks=false)이 aws 멤버가 아니므로, aws 를 임시로 false 로 둔다
    await q("update public.rooms set leader_does_tasks = false where slug = 'aws'");
    await asUser(q, await uidOf(q, "민수"));
    const l = (await one(q, "select public.me_schedule('2026-10-01', '2026-10-31') as s")).s;
    assertEquals((l.tasks as Row[]).some((t) => t.title === "지은 일정"), false);
    // 승인 대기자 미리보기(전체 팀 리프)에도 남의 개인 목표는 없다
    const hana = await uidOf(q, "하나");
    await q("update public.room_members set status = 'PENDING', joined_at = null where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [hana]);
    await asUser(q, hana);
    const p = (await one(q, "select public.me_schedule('2026-10-01', '2026-10-31') as s")).s;
    assert((p.tasks as Row[]).some((t) => t.title === "EC2 인스턴스 유형 정리"));
    assertEquals((p.tasks as Row[]).some((t) => t.title === "지은 일정"), false);
  } },
]);
