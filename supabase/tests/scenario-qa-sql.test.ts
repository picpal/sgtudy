// 0024 시나리오 QA 수정(2026-10-19) — D1 일정 당기기 · D2 회차 동반 이동 · D3 탈퇴 요청 · D4 신청 한마디·제출 요약 ·
// 알림(보관·개인 목표 보관·모집 중 지정·딥링크·자동 읽음) · 노드 작성자 · 보관 방 내 스터디 · 알림 날짜 표기(format.ts 규칙)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const notes = (q: Q, nick: string, kind: string) => uidOf(q, nick).then((u) =>
  q(`select title, body, link, read_at, node_id::text as node_id from public.notifications
     where user_id = $1::uuid and kind = $2 and created_at >= now() order by id`, [u, kind]));
const dates = async (q: Q, id: string) =>
  (await one(q, "select to_char(start_date, 'YYYY-MM-DD') || '~' || to_char(end_date, 'YYYY-MM-DD') as d from public.goal_nodes where id = $1::bigint", [id])).d as string;

/** 모집중 방(그룹장 민수, 철수 참가): 1회차(회차 → 묶음 → 공통 리프, 보관 리프) + 철수 개인 목표 */
const recruitRoom = async (q: Q, today: string, s: string, e: string) => {
  await setToday(q, today);
  await as(q, "민수");
  const d = (await one(q, "select public.room_create($1, '소개', $2::date, $3::date, 4, true, 'direct') as d", [`당기기 Shift ${s}`, s, e])).d as Row;
  const cur = (await one(q, "select public.node_create($1, null, '첫 주', '1주차', null, $2::date, ($2::date + 6)) as c", [d.slug, s])).c as Row;
  const round = cur.nodes[0].id as string;
  const g = (await one(q, "select public.node_create($1, $2::bigint, '묶음', null, null) as c", [d.slug, round])).c as Row;
  const group = g.nodes.find((n: Row) => n.parentId === round).id as string;
  // 묶음은 아직 리프(common) → 그 아래 과제를 만들면 부모로 전환된다
  const t = (await one(q, "select public.node_create($1, $2::bigint, '과제', null, 'common') as c", [d.slug, group])).c as Row;
  const leaf = t.nodes.find((n: Row) => n.parentId === group).id as string;
  const a = (await one(q, "select public.node_create($1, $2::bigint, '보관할 과제', null, 'common') as c", [d.slug, round])).c as Row;
  const arch = a.nodes.find((n: Row) => n.title === "보관할 과제").id as string;
  await q("select public.node_archive($1, $2::bigint)", [d.slug, arch]);
  await q("select public.room_open_recruit($1)", [d.slug]);
  await as(q, "철수");
  await q("select public.room_join($1)", [d.slug]);
  const p = (await one(q, "select public.personal_create($1, $2::bigint, '내 목표') as c", [d.slug, round])).c as Row;
  const personal = p.createdId as string;
  await as(q, "민수");
  return { slug: d.slug as string, id: d.id as string, round, group, leaf, arch, personal };
};

cases("scenario-qa (0024)", db, [
  // ───────── D1 ─────────
  { name: "D1 room_start(p_shift=true) 앞당김: 모든 노드(보관·개인 포함) n일 당김, 방 종료일 그대로, ROOM_STARTED 본문", run: async (q) => {
    const x = await recruitRoom(q, "2026-10-12", "2026-10-20", "2026-11-30");
    await setToday(q, "2026-10-13");
    const r = (await one(q, "select public.room_start($1, true) as r", [x.slug])).r as Row;
    assertEquals([r.status, r.startDate, r.endDate], ["active", "2026-10-13", "2026-11-30"]);
    assertEquals(r.shift, { days: 7, nodes: 5 });
    for (const id of [x.round, x.group, x.leaf, x.arch, x.personal]) assertEquals(await dates(q, id), "2026-10-13~2026-10-19", id);
    const [st] = await notes(q, "철수", "ROOM_STARTED");
    assertEquals(st.body, "일정을 7일 앞당겨 오늘 시작해요");
    // 당긴 회차가 오늘을 포함 → ROUND_STARTED 즉시(0013)
    assertEquals((await notes(q, "철수", "ROUND_STARTED")).length, 1);
  } },
  { name: "D1 room_start 기본(p_shift 없음)은 일정 그대로, shift.days 0, 본문 null · 늦은 시작은 p_shift 무시", run: async (q) => {
    const x = await recruitRoom(q, "2026-10-12", "2026-10-20", "2026-11-30");
    await setToday(q, "2026-10-13");
    const r = (await one(q, "select public.room_start($1) as r", [x.slug])).r as Row;
    assertEquals([r.startDate, r.shift], ["2026-10-13", { days: 0, nodes: 0 }]);
    assertEquals(await dates(q, x.leaf), "2026-10-20~2026-10-26");
    assertEquals((await notes(q, "철수", "ROOM_STARTED"))[0].body, null);
    const y = await recruitRoom(q, "2026-10-12", "2026-10-14", "2026-11-30");
    await setToday(q, "2026-10-16");
    const r2 = (await one(q, "select public.room_start($1, true) as r", [y.slug])).r as Row;
    assertEquals([r2.startDate, r2.shift], ["2026-10-14", { days: 0, nodes: 0 }]);
    assertEquals(await dates(q, y.leaf), "2026-10-14~2026-10-20");
  } },

  // ───────── D2 ─────────
  { name: "D2 node_update shiftDescendants: 회차 하위(묶음·과제·개인)를 같은 날수만큼, ROUND_SCHEDULE_CHANGED(ACTIVE 멤버), 과제 개별 알림 없음", run: async (q) => {
    const rid = await roomId(q, "aws");
    const round = (await one(q, "select id::text as id from public.goal_nodes where room_id = $1::bigint and label = '3주차'", [rid])).id as string;
    const grp = await nodeId(q, "aws", "로드밸런서 비교");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await as(q, "철수");
    const pc = (await one(q, "select public.personal_create('aws', $1::bigint, '3주차 내 목표') as c", [round])).c as Row;
    await as(q, "민수");
    const u = (await one(q, "select public.node_update('aws', $1::bigint, $2::jsonb) as r",
      [round, JSON.stringify({ startDate: "2026-10-22", endDate: "2026-10-28", shiftDescendants: true })])).r as Row;
    assertEquals(u.shifted, { days: 7, tasks: 1, personal: 1, groups: 1, archived: 0 });
    for (const id of [grp, alb, pc.createdId]) assertEquals(await dates(q, id), "2026-10-22~2026-10-28", id);
    const got = await notes(q, "지은", "ROUND_SCHEDULE_CHANGED");
    assertEquals(got.map((n) => [n.title, n.body, n.link]), [[
      "AWS SAA 자격증 3개월 완주 회차 일정이 변경됐어요",
      '3주차 "고가용성 아키텍처" 기간 10.15 – 10.21 → 10.22 – 10.28 · 과제 2개도 함께 옮겼어요',
      "/my-study/aws?tab=curriculum"]]);
    assertEquals((await notes(q, "철수", "ROUND_SCHEDULE_CHANGED")).length, 1);
    assertEquals((await notes(q, "민수", "ROUND_SCHEDULE_CHANGED")).length, 0);   // 행위자
    assertEquals((await notes(q, "도윤", "ROUND_SCHEDULE_CHANGED")).length, 0);   // INACTIVE
    assertEquals((await q("select 1 from public.notifications where kind = 'SCHEDULE_CHANGED' and node_id = $1::bigint", [alb])).length, 0);
  } },
  { name: "D2 shiftDescendants 없으면 하위는 그대로(알림 꼬리 없음) · 리프에 주면 VALIDATION_FAILED · 종료일만 바꾸면 이동 0", run: async (q) => {
    const rid = await roomId(q, "aws");
    const round = (await one(q, "select id::text as id from public.goal_nodes where room_id = $1::bigint and label = '3주차'", [rid])).id as string;
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await as(q, "민수");
    const u = (await one(q, "select public.node_update('aws', $1::bigint, $2::jsonb) as r", [round, JSON.stringify({ startDate: "2026-10-16" })])).r as Row;
    assertEquals(u.shifted, { days: 0, tasks: 0, personal: 0, groups: 0, archived: 0 });
    assertEquals(await dates(q, alb), "2026-10-15~2026-10-21");
    assertEquals((await notes(q, "지은", "ROUND_SCHEDULE_CHANGED")).map((n) => n.body), ['3주차 "고가용성 아키텍처" 시작 10.15 → 10.16']);
    await expectFail(q("select public.node_update('aws', $1::bigint, $2::jsonb)", [alb, JSON.stringify({ shiftDescendants: true })]), "VALIDATION_FAILED");
    const e = (await one(q, "select public.node_update('aws', $1::bigint, $2::jsonb) as r", [round, JSON.stringify({ endDate: "2026-10-23", shiftDescendants: true })])).r as Row;
    assertEquals(e.shifted.days, 0);
    assertEquals(await dates(q, alb), "2026-10-15~2026-10-21");
  } },

  // ───────── D3 ─────────
  { name: "D3 탈퇴 요청: 그룹장 알림(#leave-requests)·me.leaveRequest·목록(pendingTaskCount)·중복 거부·취소하면 알림 읽음", run: async (q) => {
    await as(q, "철수");
    const m = (await one(q, "select public.member_leave_request('aws', '  일이 바빠져서 ') as r")).r as Row;
    assertEquals(m.me.leaveRequest.reason, "일이 바빠져서");
    await expectFail(q("select public.member_leave_request('aws')"), "LEAVE_ALREADY_REQUESTED");
    const [n] = await notes(q, "민수", "LEAVE_REQUESTED");
    assertEquals([n.title, n.body, n.link, n.read_at], ["철수님이 AWS SAA 자격증 3개월 완주 탈퇴를 요청했어요", "일이 바빠져서", "/my-study/aws#leave-requests", null]);
    await as(q, "민수");
    const l = (await one(q, "select public.room_leave_requests('aws') as r")).r as Row;
    assertEquals(l.items.map((i: Row) => [i.nickname, i.reason, i.pendingTaskCount]), [["철수", "일이 바빠져서", 1]]);
    assertEquals((await one(q, "select public.room_get('aws') as r")).r.leaveRequestCount, 1);
    const mem = (await one(q, "select public.room_members_get('aws') as r")).r as Row;
    assert(mem.items.find((i: Row) => i.nickname === "철수").leaveRequestedAt);
    await as(q, "철수");
    const c = (await one(q, "select public.member_leave_request_cancel('aws') as r")).r as Row;
    assertEquals(c.me.leaveRequest, undefined);
    assert((await notes(q, "민수", "LEAVE_REQUESTED"))[0].read_at);
    await expectFail(q("select public.member_leave_request_cancel('aws')"), "NOT_FOUND");
  } },
  { name: "D3 내보내기(member_deactivate)면 요청이 비워지고 알림 읽음 · 반려는 멤버 알림 · 오류 코드", run: async (q) => {
    await as(q, "철수");
    await q("select public.member_leave_request('aws')");
    await as(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("select public.member_deactivate('aws', $1::uuid, $2::jsonb)", [cheolsu, JSON.stringify([{ nodeId: ec2, action: "exclude" }])]);
    assertEquals((await one(q, "select public.room_leave_requests('aws') as r")).r.items, []);
    assert((await notes(q, "민수", "LEAVE_REQUESTED"))[0].read_at);
    assertEquals((await one(q, "select leave_requested_at from public.room_members where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [cheolsu])).leave_requested_at, null);
    // 반려
    await as(q, "지은");
    await q("select public.member_leave_request('aws', null)");
    await as(q, "민수");
    const d = (await one(q, "select public.member_leave_request_dismiss('aws', $1::uuid) as r", [await uidOf(q, "지은")])).r as Row;
    assertEquals(d.items, []);
    assertEquals((await notes(q, "지은", "LEAVE_REQUEST_DISMISSED")).map((n) => [n.title, n.link]), [["AWS SAA 자격증 3개월 완주 탈퇴 요청이 반려됐어요", "/my-study/aws"]]);
    await expectFail(q("select public.member_leave_request_dismiss('aws', $1::uuid)", [await uidOf(q, "지은")]), "NOT_FOUND");
    // 오류
    await expectFail(q("select public.member_leave_request('aws')"), "OWNER_CANNOT_LEAVE");
    await as(q, "하나");
    await expectFail(q("select public.member_leave_request('aws', $1)", ["가".repeat(201)]), "VALIDATION_FAILED");
    await as(q, "도현");
    await expectFail(q("select public.member_leave_request('toeic')"), "ROOM_NOT_ACTIVE");
    await as(q, "하나");
    await expectFail(q("select public.room_leave_requests('aws')"), "NOT_LEADER");
  } },

  // ───────── D4 ─────────
  { name: "D4 참가 신청 한마디: 저장·그룹장 조회·JOIN_REQUESTED 본문/#applications · 200자 초과 거부 · 처리하면 신청 알림 자동 읽음(#18)", run: async (q) => {
    await as(q, "지은");
    await expectFail(q("select public.room_apply('sqld', null, $1)", ["가".repeat(201)]), "VALIDATION_FAILED");
    await q("select public.room_apply('sqld', null, ' 열심히 할게요 ')");
    await as(q, "가은");
    const a = (await one(q, "select public.room_applications('sqld') as r")).r as Row;
    assertEquals(a.items.map((i: Row) => [i.nickname, i.message]), [["철수", null], ["지은", "열심히 할게요"]]);
    const [n] = await notes(q, "가은", "JOIN_REQUESTED");
    assertEquals([n.body, n.link, n.read_at], ["열심히 할게요", "/my-study/sqld#applications", null]);
    await q("select public.room_approve('sqld', $1::uuid)", [await uidOf(q, "지은")]);
    assert((await notes(q, "가은", "JOIN_REQUESTED"))[0].read_at);
    // 신청자가 직접 취소해도 읽음
    await as(q, "하나");
    await q("select public.room_apply('sqld')");
    await q("select public.room_cancel_application('sqld')");
    assert((await notes(q, "가은", "JOIN_REQUESTED")).every((x) => x.read_at));
  } },
  { name: "D4 SUBMISSION_DIGEST: 어제 팀 과제 제출(그룹장 제외) → 그룹장 1건, 최다 과제 #submissions 링크, 멱등", run: async (q) => {
    await setToday(q, "2026-10-20");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const asg = await nodeId(q, "aws", "Auto Scaling 정책 정리");
    const sub = async (node: string, nick: string) => q(
      `insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late) values ($1::bigint, $2::uuid, 'x', '2026-10-19 21:00+09', false)`,
      [node, await uidOf(q, nick)]);
    await sub(alb, "지은"); await sub(alb, "철수"); await sub(alb, "민수");
    await q("select public.job_submission_digest()");
    let [n] = await notes(q, "민수", "SUBMISSION_DIGEST");
    assertEquals([n.title, n.body, n.link], ["어제 제출 2건이 들어왔어요", '"ALB vs NLB 실습"', `/my-study/aws?task=${alb}#submissions`]);
    assertEquals((await one(q, "select public.job_submission_digest() as n")).n, 0);
    await q("delete from public.notifications where kind = 'SUBMISSION_DIGEST'");
    await sub(asg, "하나");
    await q("select public.job_submission_digest()");
    [n] = await notes(q, "민수", "SUBMISSION_DIGEST");
    assertEquals([n.title, n.body], ["어제 제출 3건이 들어왔어요", '"ALB vs NLB 실습" 외 과제 1개']);
    assertEquals((await q("select 1 from cron.job where jobname = 'submission_digest'")).length, 1);
  } },

  // ───────── 알림·작성자·보관 ─────────
  { name: "room_archive → ACTIVE 멤버 ROOM_ARCHIVED · me_studies(true) 의 archived 그룹, 기본 호출은 그대로", run: async (q) => {
    await as(q, "민수");
    await q("select public.room_archive('aws')");
    for (const nick of ["지은", "철수", "하나"]) {
      assertEquals((await notes(q, nick, "ROOM_ARCHIVED")).map((n) => [n.title, n.body, n.link]),
        [["AWS SAA 자격증 3개월 완주 스터디가 보관됐어요", "내 스터디의 보관함에서 다시 볼 수 있어요", "/my-study/aws"]], nick);
    }
    assertEquals((await notes(q, "도윤", "ROOM_ARCHIVED")).length, 0);
    await as(q, "철수");
    const s0 = (await one(q, "select public.me_studies() as s")).s as Row;
    assertEquals(s0.groups.map((g: Row) => g.kind), ["active", "recruit", "ended"]);
    assertEquals(s0.groups[0].items.map((i: Row) => [i.slug, i.archived]), [["spring", false]]);
    const s1 = (await one(q, "select public.me_studies(true) as s")).s as Row;
    assertEquals(s1.groups.map((g: Row) => g.kind), ["active", "recruit", "ended", "archived"]);
    assertEquals(s1.groups[3].items.map((i: Row) => [i.slug, i.membership, i.archived, i.when.kind]), [["aws", "joined", true, "end"]]);
  } },
  { name: "그룹장이 팀원 개인 목표를 보관하면 소유자에게 PERSONAL_ARCHIVED, 본인 보관은 알림 없음", run: async (q) => {
    const rid = await roomId(q, "aws");
    const round = (await one(q, "select id::text as id from public.goal_nodes where room_id = $1::bigint and label = '3주차'", [rid])).id as string;
    await as(q, "철수");
    const a = (await one(q, "select public.personal_create('aws', $1::bigint, '팀원 목표') as c", [round])).c.createdId as string;
    const b = (await one(q, "select public.personal_create('aws', $1::bigint, '내가 지울 목표') as c", [round])).c.createdId as string;
    await q("select public.personal_archive('aws', $1::bigint, true)", [b]);
    await as(q, "민수");
    await q("select public.personal_archive('aws', $1::bigint, true)", [a]);
    assertEquals((await notes(q, "철수", "PERSONAL_ARCHIVED")).map((n) => [n.title, n.link]),
      [['그룹장이 "팀원 목표" 개인 목표를 보관했어요', `/my-study/aws?task=${a}`]]);
  } },
  { name: "#13 node_create 작성자 createdBy(curriculum·task_get), 모집 중에도 지정 담당 알림", run: async (q) => {
    const x = await recruitRoom(q, "2026-10-12", "2026-10-20", "2026-11-30");
    const c = (await one(q, "select public.curriculum_get($1, true) as c", [x.slug])).c as Row;
    assertEquals(c.nodes.find((n: Row) => n.id === x.leaf).createdBy.nickname, "민수");
    assertEquals(c.nodes.find((n: Row) => n.id === x.personal).createdBy, null);
    assertEquals((await one(q, "select public.task_get($1, $2::bigint) as t", [x.slug, x.leaf])).t.node.createdBy.nickname, "민수");
    const seedNode = (await one(q, "select public.curriculum_get('aws') as c")).c.nodes[0] as Row;
    assertEquals(seedNode.createdBy, null);
    // 팀원(편집 권한)이 모집 중에 지정 과제를 만들어 담당을 주면 담당자에게 TASK_ASSIGNED
    await q("select public.member_set_curriculum_editor($1, $2::uuid, true)", [x.slug, await uidOf(q, "철수")]);
    const hana = await uidOf(q, "하나");
    await asUser(q, hana);
    await q("select public.room_join($1)", [x.slug]);
    await as(q, "철수");
    const d = (await one(q, "select public.node_create($1, $2::bigint, '지정 과제', null, 'designated') as c", [x.slug, x.round])).c as Row;
    const des = d.nodes.find((n: Row) => n.title === "지정 과제");
    assertEquals(des.createdBy.nickname, "철수");
    await q("select public.node_update($1, $2::bigint, $3::jsonb)", [x.slug, des.id, JSON.stringify({ assigneeIds: [hana] })]);
    assertEquals((await notes(q, "하나", "TASK_ASSIGNED")).map((n) => n.node_id), [des.id]);
  } },
  { name: "딥링크: TASK_ALL_SUBMITTED 는 ?task=…#submissions", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const link = (await one(q, "select public.notify_link('TASK_ALL_SUBMITTED', $1::bigint, $2::bigint, $3::uuid) as l",
      [await roomId(q, "aws"), ec2, await uidOf(q, "민수")])).l;
    assertEquals(link, `/my-study/aws?task=${ec2}#submissions`);
  } },

  // ───────── #19 탭 개수 ─────────
  { name: "#19 rooms_list tabCounts 는 범위마다 현재 상태·검색어·태그 조건을 적용한 수", run: async (q) => {
    await as(q, "철수");
    const list = async (status: string, qq: string | null, tags: string[] | null, scope = "public") =>
      (await one(q, "select public.rooms_list($1, $2, $3, $4::text[]) as r", [scope, status, qq, tags])).r as Row;
    const all = await list("all", null, null);
    assertEquals(all.tabCounts, { public: 8, mine: 4, created: 1 });
    const rec = await list("recruit", null, null);
    assertEquals(rec.tabCounts.public, rec.totalElements);
    assert(rec.tabCounts.public < 8);
    const mineActive = await list("active", null, null, "mine");
    assertEquals(mineActive.tabCounts.mine, mineActive.totalElements);
    const aws = await list("all", "aws", null);
    assertEquals([aws.tabCounts.public, aws.tabCounts.created], [1, 0]);
    const tag = await list("all", null, ["docker"]);
    assertEquals([tag.tabCounts.public, tag.tabCounts.created], [1, 1]);   // docker 방은 철수가 만든 방
  } },

  // ───────── f. 날짜 표기 ─────────
  { name: "알림 날짜 = format.ts dateShort/rangeShort (오늘과 다른 해·해 넘김은 YYYY.MM.DD)", run: async (q) => {
    const rid = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const render = async (kind: string, node: string | null, m: Record<string, string>) =>
      (await one(q, "select public.notify_render($1, $2::bigint, $3::bigint, null, $4::jsonb) as t", [kind, rid, node, JSON.stringify(m)])).t.body;
    assertEquals(await render("SCHEDULE_CHANGED", ec2, { oldStartDate: "2026-12-20", oldEndDate: "2026-12-28", startDate: "2026-12-20", endDate: "2027-01-03" }),
      '"EC2 인스턴스 유형 정리" 마감 12.28 → 2027.01.03');
    assertEquals(await render("SCHEDULE_CHANGED", ec2, { oldStartDate: "2026-12-20", oldEndDate: "2026-12-28", startDate: "2026-12-27", endDate: "2027-01-03" }),
      '"EC2 인스턴스 유형 정리" 기간 12.20 – 12.28 → 12.27 – 2027.01.03');
    assertEquals(await render("ROOM_PERIOD_CHANGED", null, { oldStartDate: "2026-10-01", oldEndDate: "2026-12-31", startDate: "2026-10-01", endDate: "2027-01-15" }),
      "10.01 – 12.31 → 10.01 – 2027.01.15");
    await setToday(q, "2027-01-02");
    assertEquals(await render("SCHEDULE_CHANGED", ec2, { startDate: "2026-10-13", endDate: "2026-10-19" }), '"EC2 인스턴스 유형 정리" 2026.10.13 – 10.19');
  } },
]);
