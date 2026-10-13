import { asAnon, asUser, expectFail, setToday } from "./_harness.ts";
import { assertEquals } from "@std/assert";

/** 사례 파일 전용 느슨한 Q (하네스 Q 와 상호 대입 가능) */
export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export const TODAY = "2026-10-12";

/** 플랜 01 seed_users 번호 → 고정 UUID */
const NAMES = ["철수","민수","서연","지훈","현우","수민","예린","태호","가은","민재","보람","도현","하은","시우","지은","소율","지성","은지","하나","다은","태윤","나연","다인","도윤","아린","유진","준서","현준","승호"] as const;
export const USERS = Object.fromEntries(
  NAMES.map((n, i) => [n, `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`]),
) as Record<(typeof NAMES)[number], string>;

/** SQL 문자열을 실행해 P0001 에러를 code(message) 로 단언한다. fail() 은 MESSAGE=code, DETAIL=문구, HINT=json.
 *  하네스의 `expectFail(promise, code)` 와 이름이 겹치지 않게 `expectFailSql` — 사례 파일은 이것만 쓴다. */
export const expectFailSql = (q: Q, sql: string, params: unknown[], code: string) => expectFail(q(sql, params), code);

/** 시드와 무관한 새 방을 leader 가 만든다(DRAFT). 반환: RoomDetail */
export async function createRoom(q: Q, leader: string, over: Partial<{
  title: string; intro: string; startDate: string; endDate: string; maxMembers: number; isPublic: boolean; joinMode: "direct" | "approval";
}> = {}) {
  await asUser(q, leader);
  const a = {
    title: "테스트 방 Test Room", intro: "소개", startDate: "2026-11-01", endDate: "2026-11-28",
    maxMembers: 4, isPublic: true, joinMode: "direct" as const, ...over,
  };
  const [row] = await q(
    `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7) as d`,
    [a.title, a.intro, a.startDate, a.endDate, a.maxMembers, a.isPublic, a.joinMode],
  );
  return row.d as Record<string, any>;
}

/** 회차 1개 + 리프 N개를 직접 INSERT 한다(Phase 3 node_create 전까지 테스트 전용). round_id 는 회차 자신. */
export async function seedLeaves(q: Q, roomId: string, leaves: { title: string; type: "COMMON" | "DESIGNATED"; s: string; e: string }[], round = { label: "1주차", title: "회차", s: "2026-11-01", e: "2026-11-07" }) {
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
     values ($1, null, 2, 0, $2, $3, $4::date, $5::date) returning id`,
    [roomId, round.label, round.title, round.s, round.e],
  );
  await q(`update public.goal_nodes set round_id = id where id = $1`, [r.id]);
  const ids: string[] = [];
  for (const [i, l] of leaves.entries()) {
    const [n] = await q(
      `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
       values ($1, $2, $2, 3, $3, $4, $5::date, $6::date, $7) returning id`,
      [roomId, r.id, i, l.title, l.s, l.e, l.type],
    );
    ids.push(String(n.id));
  }
  await q(`select public.assignment_resync($1)`, [roomId]);
  return { roundId: String(r.id), leafIds: ids };
}

export type Case = { name: string; run: (q: Q) => Promise<void> };

export const ROOM_CASES: Case[] = [
  {
    name: "room_create: DRAFT 방 + 그룹장 ACTIVE 행 + member_count 1 + 초대 토큰 + 알림 설정",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      assertEquals(d.status, "draft");
      assertEquals(d.memberCount, 1);
      assertEquals(d.me, { state: "leader" });
      assertEquals(d.leader.nickname, "서연");
      assertEquals(d.members.length, 1);
      assertEquals(d.members[0].role, "leader");
      assertEquals(typeof d.invite.url, "string");
      assertEquals(d.invite.url.startsWith("/invite/"), true);
      assertEquals(d.pendingCount, 0);
      assertEquals(d.today, TODAY);
      const [m] = await q(`select role, status from public.room_members where room_id = $1 and user_id = $2`, [d.id, USERS.서연]);
      assertEquals([m.role, m.status], ["LEADER", "ACTIVE"]);
      const [s] = await q(`select count(*)::int as n from public.room_notification_settings where room_id = $1`, [d.id]);
      assertEquals(s.n, 1);
      const [i] = await q(`select count(*)::int as n from public.room_invites where room_id = $1 and revoked_at is null`, [d.id]);
      assertEquals(i.n, 1);
    },
  },
  {
    name: "room_create: slug 는 slugify 결과이고 충돌 시 -2",
    run: async (q) => {
      await setToday(q, TODAY);
      // 라틴 문자 제목 → slugify 결과가 id 와 무관하므로 같은 제목 두 번이면 충돌한다
      const a = await createRoom(q, USERS.서연, { title: "Docker Basics" });
      const b = await createRoom(q, USERS.서연, { title: "Docker Basics" });
      const [{ base }] = await q(`select public.slugify($1, $2::bigint) as base`, ["Docker Basics", a.id]);
      assertEquals(a.slug, base);
      assertEquals(b.slug, `${base}-2`);
    },
  },
  {
    name: "room_create: 검증 실패 코드",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.서연);
      const call = `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7)`;
      await expectFailSql(q, call, ["   ", "소개", "2026-11-01", "2026-11-28", 4, true, "direct"], "INVALID_TITLE");
      await expectFailSql(q, call, ["제목", "소개", "2026-11-28", "2026-11-01", 4, true, "direct"], "INVALID_PERIOD");
      await expectFailSql(q, call, ["제목", "소개", "2026-10-11", "2026-11-01", 4, true, "direct"], "INVALID_PERIOD"); // 과거 시작일
      await expectFailSql(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 1, true, "direct"], "VALIDATION_FAILED");
      await expectFailSql(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, "open"], "VALIDATION_FAILED");
      await expectFailSql(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, null], "VALIDATION_FAILED");   // D11: NOT NULL 위반 대신
      await expectFailSql(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, null, "direct"], "VALIDATION_FAILED");
      await expectFailSql(q, `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7, p_cover_file_id => $8::uuid)`,
        ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, "direct", crypto.randomUUID()], "VALIDATION_FAILED");   // A8: 내 COVER 파일 아님
      await asAnon(q);
      await expectFailSql(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, "direct"], "AUTH_REQUIRED");
    },
  },
  {
    name: "privileges (T1): 테이블 쓰기 GRANT 없음 · 헬퍼 EXECUTE 없음 · room_create 는 authenticated 만",
    run: async (q) => {
      const fnCan = async (role: string, fn: string) =>
        (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
      const RC = "public.room_create(text,text,date,date,int,boolean,text,text,text,int,boolean,uuid,text[])";
      assertEquals(await fnCan("authenticated", RC), true);
      assertEquals(await fnCan("anon", RC), false);
      const priv = [
        "notify_publish(text,bigint,bigint,uuid,uuid[],text,jsonb)", "room_lock(text)", "room_readable(bigint,uuid,text)",
        "room_leaf_stats(bigint)", "room_round_stats(bigint)", "room_current_round_id(bigint,date)", "room_tags_json(bigint)",
        "room_detail_json(bigint,uuid)", "room_me_json(bigint,uuid)", "room_members_json(bigint,uuid)", "invite_ensure(bigint,uuid)",
        "room_take_seat(bigint)", "room_release_seat(bigint)", "assignment_resync(bigint)",
      ];
      for (const f of priv) for (const role of ["anon", "authenticated"]) {
        assertEquals(await fnCan(role, `public.${f}`), false, `${role} ${f}`);
      }
      // 실제 실행: authenticated 는 되고 anon 은 42501 (GRANT 계층)
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const args = ["역할 테스트", "소개", "2026-11-01", "2026-11-28", 4, true, "direct"];
      const call = `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7) as d`;
      await q("set local role authenticated");
      const [row] = await q(call, args);
      assertEquals(row.d.status, "draft");
      await q("set local role anon");
      await expectFailSql(q, call, args, "permission denied");
      await q("reset role");
      // 테이블 쓰기 권한(D4/D7)은 reset role 뒤에 확인
      const tables = ["rooms", "room_members", "room_invites", "goal_nodes", "task_assignments", "submissions", "profiles", "notifications"];
      for (const t of tables) for (const p of ["insert", "update", "delete"]) for (const role of ["anon", "authenticated"]) {
        const [{ ok }] = await q("select has_table_privilege($1, $2, $3) as ok", [role, `public.${t}`, p]);
        assertEquals(ok, false, `${role} ${p} ${t}`);
      }
    },
  },
  {
    name: "room_open_recruit: 리프 없으면 ROOM_NO_LEAF_TASK, 있으면 RECRUIT",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      await expectFailSql(q, `select public.room_open_recruit($1)`, [d.slug], "ROOM_NO_LEAF_TASK");
      await seedLeaves(q, d.id, [{ title: "과제 1", type: "COMMON", s: "2026-11-01", e: "2026-11-07" }]);
      const [{ r }] = await q(`select public.room_open_recruit($1) as r`, [d.slug]);
      assertEquals(r.status, "recruit");
      // 그룹장은 leader_does_tasks 기본 true → 공통 리프 1건 배정됨. 10/12 에는 11/01 시작 과제가 planned → nextDue 없음(OPEN 만, D14)
      assertEquals(r.myProgress, { submitted: 0, assigned: 1, nextDue: null });
      const [{ id: leafId }] = await q(`select id::text as id from public.goal_nodes where room_id = $1 and task_type is not null`, [d.id]);
      await setToday(q, "2026-11-02");                                   // 과제 기간 안 → OPEN
      const [{ j }] = await q(`select public.room_detail_json($1, $2) as j`, [d.id, USERS.서연]);
      assertEquals(j.myProgress.nextDue, { nodeId: leafId, title: "과제 1", roundLabel: "1주차", dueDate: "2026-11-07" });
      await setToday(q, TODAY);
      // 두 번 열면 ROOM_STATUS_INVALID, 다른 사람은 NOT_LEADER
      await expectFailSql(q, `select public.room_open_recruit($1)`, [d.slug], "ROOM_STATUS_INVALID");
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_open_recruit($1)`, [d.slug], "NOT_LEADER");
    },
  },
  {
    name: "room_start: RECRUIT → ACTIVE, start_date=today, PENDING→EXPIRED, 담당자 없는 지정 과제는 warnings",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { joinMode: "approval" });
      await seedLeaves(q, d.id, [
        { title: "공통", type: "COMMON", s: "2026-11-01", e: "2026-11-07" },
        { title: "지정", type: "DESIGNATED", s: "2026-11-01", e: "2026-11-07" },
      ]);
      await q(`select public.room_open_recruit($1)`, [d.slug]);
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [d.slug]);
      await asUser(q, USERS.서연);
      const [{ r }] = await q(`select public.room_start($1) as r`, [d.slug]);
      assertEquals(r.status, "active");
      assertEquals(r.startDate, TODAY);
      assertEquals(r.warnings.length, 1);
      assertEquals(r.warnings[0].code, "UNASSIGNED_TASK");
      const [m] = await q(`select status from public.room_members where room_id = $1 and user_id = $2`, [d.id, USERS.민수]);
      assertEquals(m.status, "EXPIRED");
      const [row] = await q(`select started_at is not null as s from public.rooms where id = $1`, [d.id]);
      assertEquals(row.s, true);
      await expectFailSql(q, `select public.room_start($1)`, [d.slug], "ROOM_STATUS_INVALID");
    },
  },
  {
    name: "room_tick: start_date 지난 RECRUIT 전부 ACTIVE(이틀 누락 포함), PENDING→EXPIRED, 재실행은 0건, DRAFT·보관은 무시",
    run: async (q) => {
      await setToday(q, TODAY);
      const a = await createRoom(q, USERS.서연, { title: "Tick A", startDate: "2026-10-13", endDate: "2026-10-17", joinMode: "approval" });
      const b = await createRoom(q, USERS.서연, { title: "Tick B", startDate: "2026-10-14", endDate: "2026-10-17" });
      const c = await createRoom(q, USERS.서연, { title: "Tick C draft", startDate: "2026-10-13", endDate: "2026-10-17" });
      for (const d of [a, b]) {
        await asUser(q, USERS.서연);
        await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-10-13", e: "2026-10-17" }]);
        await q(`select public.room_open_recruit($1)`, [d.slug]);
      }
      await seedLeaves(q, c.id, [{ title: "t", type: "COMMON", s: "2026-10-13", e: "2026-10-17" }]); // c 는 DRAFT 그대로
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [a.slug]);
      // 보관된 RECRUIT(손상 데이터) — tick 이 건드리지 않아야 한다
      await q(`update public.rooms set archived_at = now() where id = $1`, [b.id]);
      const [{ r: before }] = await q(`select public.room_tick() as r`);
      assertEquals(before, { activated: 0, ended: 0 });           // 10/12: 아직 시작일 전
      await setToday(q, "2026-10-15");                              // 이틀 건너뜀
      const [{ r: t1 }] = await q(`select public.room_tick() as r`);
      assertEquals(t1, { activated: 1, ended: 0 });                 // a 만 (b 보관, c DRAFT)
      const rows = await q(`select slug, status from public.rooms where id = any($1::bigint[]) order by id`, [[a.id, b.id, c.id]]);
      assertEquals(rows.map((x) => x.status), ["ACTIVE", "RECRUIT", "DRAFT"]);
      const [m] = await q(`select status from public.room_members where room_id = $1 and user_id = $2`, [a.id, USERS.민수]);
      assertEquals(m.status, "EXPIRED");
      const [{ r: t2 }] = await q(`select public.room_tick() as r`);
      assertEquals(t2, { activated: 0, ended: 0 });                 // 멱등
      await setToday(q, "2026-10-18");                              // end_date 다음날, 시드 RECRUIT cs·jcg 시작일 10-19 이전
      const [{ r: t3 }] = await q(`select public.room_tick() as r`);
      assertEquals(t3, { activated: 0, ended: 1 });
      const [e] = await q(`select status, ended_at is not null as x from public.rooms where id = $1`, [a.id]);
      assertEquals([e.status, e.x], ["ENDED", true]);
    },
  },
  {
    name: "room_update: 상태별 필드 잠금 (DRAFT/RECRUIT 전부 가능, ACTIVE 는 startDate 등 FIELD_LOCKED, ENDED 전부 잠금)",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { startDate: "2026-10-13", endDate: "2026-10-31" });
      const upd = `select public.room_update($1, $2::jsonb) as r`;
      // RECRUIT 단계(DRAFT 동일): startDate 변경 가능(≥ today), 과거는 INVALID_PERIOD
      let [{ r }] = await q(upd, [d.slug, JSON.stringify({ startDate: "2026-10-14", minMembers: 2, isPublic: false, joinMode: "approval", leaderDoesTasks: false })]);
      assertEquals([r.startDate, r.minMembers, r.isPublic, r.joinMode, r.leaderDoesTasks], ["2026-10-14", 2, false, "approval", false]);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ startDate: "2026-10-11" })], "INVALID_PERIOD");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-13" })], "INVALID_PERIOD");   // end < start
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ maxMembers: 1 })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ slug: "x" })], "FIELD_LOCKED");               // I11
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ title: "" })], "INVALID_TITLE");
      // D11: 형식 오류는 22007/22008/22P02 원문이 아니라 VALIDATION_FAILED, joinMode null 은 NOT NULL 위반 대신 VALIDATION_FAILED
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ startDate: "2026-13-01" })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ endDate: 20261101 })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ isPublic: "yes" })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ maxMembers: "many" })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ joinMode: null })], "VALIDATION_FAILED");
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ coverFileId: "not-a-uuid" })], "VALIDATION_FAILED");   // A8
      // 정원 축소 < member_count → CAPACITY_BELOW_CURRENT (리프 만들고 모집 열어 민수 참가 후 2명)
      await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-10-14", e: "2026-10-20" }], { label: "1주차", title: "회차", s: "2026-10-14", e: "2026-10-20" });
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ joinMode: "direct", isPublic: true })]);
      await q(`select public.room_open_recruit($1)`, [d.slug]);
      await asUser(q, USERS.민수);
      await q(`select public.room_join($1)`, [d.slug]);
      await asUser(q, USERS.서연);
      await q(upd, [d.slug, JSON.stringify({ maxMembers: 2 })]);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ maxMembers: 1 })], "VALIDATION_FAILED");      // 범위(2~100) 먼저
      await q(upd, [d.slug, JSON.stringify({ maxMembers: 3 })]);
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1)`, [d.slug]);                                                 // 3/3
      await asUser(q, USERS.서연);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ maxMembers: 2 })], "CAPACITY_BELOW_CURRENT");
      // ACTIVE 단계
      await q(`select public.room_start($1)`, [d.slug]);
      for (const k of ["startDate", "minMembers", "isPublic", "joinMode", "leaderDoesTasks"]) {
        await expectFailSql(q, upd, [d.slug, JSON.stringify({ [k]: k === "startDate" ? "2026-10-20" : k === "minMembers" ? 1 : k === "joinMode" ? "direct" : true })], "FIELD_LOCKED");
      }
      [{ r }] = await q(upd, [d.slug, JSON.stringify({ title: "바뀐 제목", endDate: "2026-11-15", maxMembers: 5 })]);
      assertEquals([r.title, r.endDate, r.maxMembers], ["바뀐 제목", "2026-11-15", 5]);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-19" })], "INVALID_PERIOD");  // 노드 e(10/20) 보다 앞
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-11" })], "INVALID_PERIOD");  // today 보다 앞
      // ENDED 단계: 전부 잠금
      await setToday(q, "2026-11-16");
      await q(`select public.room_tick()`);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ title: "x" })], "FIELD_LOCKED");
      // 보관: ROOM_NOT_EDITABLE
      await q(`select public.room_archive($1)`, [d.slug]);
      await expectFailSql(q, upd, [d.slug, JSON.stringify({ title: "x" })], "ROOM_NOT_EDITABLE");
      await expectFailSql(q, `select public.room_update($1, $2::jsonb)`, ["no-such-room", "{}"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "room_update: leaderDoesTasks 변경은 배정을 재동기화하고 기간 밖 노드는 warnings",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { startDate: "2026-11-01", endDate: "2026-11-30" });
      const { leafIds } = await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-11-01", e: "2026-11-07" }]);
      const cnt = async () => (await q(`select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null`, [leafIds[0]]))[0].n;
      assertEquals(await cnt(), 1);
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ leaderDoesTasks: false })]);
      assertEquals(await cnt(), 0);
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ leaderDoesTasks: true })]);
      assertEquals(await cnt(), 1);
      const [{ r }] = await q(`select public.room_update($1, $2::jsonb) as r`, [d.slug, JSON.stringify({ startDate: "2026-11-03" })]);
      assertEquals(r.warnings, [{ code: "PERIOD_OUTSIDE_ROOM", nodeId: leafIds[0] }, { code: "PERIOD_OUTSIDE_ROOM", nodeId: r.rounds[0].id }].sort((x, y) => Number(x.nodeId) - Number(y.nodeId)));
    },
  },
  {
    name: "room_archive/unarchive/delete: 상태 제약",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      await expectFailSql(q, `select public.room_archive($1)`, [d.slug], "ROOM_STATUS_INVALID");   // DRAFT 는 보관 불가
      await expectFailSql(q, `select public.room_unarchive($1)`, [d.slug], "ROOM_STATUS_INVALID"); // 보관 아님
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_delete($1)`, [d.slug], "NOT_LEADER");
      await asUser(q, USERS.서연);
      await q(`select public.room_delete($1)`, [d.slug]);
      const [{ n }] = await q(`select count(*)::int as n from public.rooms where id = $1`, [d.id]);
      assertEquals(n, 0);
      // ACTIVE 방은 삭제 불가, 보관 가능, 해제 시 상태 복귀
      await expectFailSql(q, `select public.room_delete($1)`, ["aws"], "NOT_LEADER");
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_delete($1)`, ["aws"], "ROOM_STATUS_INVALID");
      const [{ r }] = await q(`select public.room_archive($1) as r`, ["aws"]);
      assertEquals([r.archived, r.status], [true, "active"]);
      const [{ r: r2 }] = await q(`select public.room_unarchive($1) as r`, ["aws"]);
      assertEquals([r2.archived, r2.status], [false, "active"]);
    },
  },
  {
    name: "privileges (T2): 그룹장 RPC 6개만 authenticated, tick·전환·patch 헬퍼는 EXECUTE 없음",
    run: async (q) => {
      const fnCan = async (role: string, fn: string) =>
        (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
      for (const f of ["room_open_recruit(text)", "room_start(text)", "room_archive(text)", "room_unarchive(text)", "room_delete(text)", "room_update(text,jsonb)"]) {
        assertEquals(await fnCan("authenticated", `public.${f}`), true, `authenticated ${f}`);
        assertEquals(await fnCan("anon", `public.${f}`), false, `anon ${f}`);
      }
      for (const f of ["room_tick()", "room_transition_active(bigint,uuid)", "room_transition_ended(bigint)",
        "patch_date(jsonb,text)", "patch_bool(jsonb,text)", "patch_int(jsonb,text)"]) {
        for (const role of ["anon", "authenticated"]) assertEquals(await fnCan(role, `public.${f}`), false, `${role} ${f}`);
      }
      // 실제 실행: 슈퍼유저로 DRAFT 방 + 리프를 만든 뒤 역할을 바꿔 호출
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.철수);
      await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-11-01", e: "2026-11-07" }]);
      await asUser(q, USERS.철수);
      await q("set local role authenticated");
      const [{ r }] = await q(`select public.room_update($1, $2::jsonb) as r`, [d.slug, JSON.stringify({ title: "권한 확인" })]);
      assertEquals(r.title, "권한 확인");
      const [{ r: o }] = await q(`select public.room_open_recruit($1) as r`, [d.slug]);
      assertEquals(o.status, "recruit");
      await q("set local role anon");
      await expectFailSql(q, `select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ title: "x" })], "permission denied");
      await q("reset role");
    },
  },
];
