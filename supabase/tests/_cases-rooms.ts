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

/** rooms_list 호출 → 응답 JSON */
export async function listRooms(q: Q, a: Partial<{ scope: string; status: string; q: string; tags: string[]; page: number; size: number; sort: string }> = {}) {
  const [{ r }] = await q(
    `select public.rooms_list($1, $2, $3, $4::text[], $5, $6, $7) as r`,
    [a.scope ?? "public", a.status ?? "all", a.q ?? null, a.tags ?? null, a.page ?? 0, a.size ?? 24, a.sort ?? "default"],
  );
  return r as Record<string, any>;
}

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
    name: "room_create: 중복 태그 slug 는 첫 등장 순서로 하나만 (23505 원문 금지)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.서연);
      const [{ d }] = await q(`select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7, p_tag_slugs => $8::text[]) as d`,
        ["태그 중복", "소개", "2026-11-01", "2026-11-28", 4, true, "direct", ["cloud", "aws", "cloud", "aws"]]);
      assertEquals(d.tags.map((t: any) => t.slug), ["cloud", "aws"]);
      const rows = await q(`select tag_slug, sort_order from public.room_tags where room_id = $1 order by sort_order`, [d.id]);
      assertEquals(rows.map((r) => [r.tag_slug, r.sort_order]), [["cloud", 0], ["aws", 1]]);
    },
  },
  {
    name: "room_get (M-1): 읽기 전용 — 활성 토큰이 없는 그룹장은 invite null, room_invites 행을 만들지 않는다",
    run: async (q) => {
      await setToday(q, TODAY);
      await q(`update public.room_invites set revoked_at = now() where room_id = 4 and revoked_at is null`);
      const n = async () => (await q(`select count(*)::int as n from public.room_invites where room_id = 4`))[0].n as number;
      const before = await n();
      await asUser(q, USERS.철수);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["docker"]);
      assertEquals([r.me, r.invite], [{ state: "leader" }, null]);
      assertEquals(await n(), before);
      // invite_get 이 만들면 다시 보인다
      const [{ g }] = await q(`select public.invite_get($1) as g`, ["docker"]);
      assertEquals((await q(`select public.room_get($1) as r`, ["docker"]))[0].r.invite, { token: g.token, url: g.url, code: g.code, bypass: g.bypass });   // 0032: invite_json − today
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
    // Task 2 리뷰 ruling: tick 은 보관 방을 두 루프 모두에서 건너뛴다(보관 방은 알림·집계 제외, D-spec). 보관 해제하면 다음 tick 이 끝낸다.
    name: "room_tick: 보관된 ACTIVE 방은 end_date 가 지나도 ENDED 로 바꾸지 않고, 보관 해제 뒤 tick 이 끝낸다",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { title: "Tick Archived", startDate: "2026-10-13", endDate: "2026-10-17" });
      await asUser(q, USERS.서연);
      await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-10-13", e: "2026-10-17" }]);
      await q(`select public.room_open_recruit($1)`, [d.slug]);
      await setToday(q, "2026-10-15");
      await q(`select public.room_tick()`);
      assertEquals((await q(`select status from public.rooms where id = $1`, [d.id]))[0].status, "ACTIVE");
      await q(`update public.rooms set archived_at = now() where id = $1`, [d.id]);
      await setToday(q, "2026-10-18");                              // end_date 다음날, 시드 RECRUIT 시작일(10-19) 이전
      const [{ r: t1 }] = await q(`select public.room_tick() as r`);
      assertEquals(t1, { activated: 0, ended: 0 });
      assertEquals((await q(`select status from public.rooms where id = $1`, [d.id]))[0].status, "ACTIVE");
      await q(`update public.rooms set archived_at = null where id = $1`, [d.id]);
      const [{ r: t2 }] = await q(`select public.room_tick() as r`);
      assertEquals(t2, { activated: 0, ended: 1 });
      assertEquals((await q(`select status from public.rooms where id = $1`, [d.id]))[0].status, "ENDED");
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
      await expectFailSql(q, `select public.room_delete($1)`, [d.slug], "ROOM_NOT_FOUND");   // 남의 DRAFT 는 못 읽으니 존재를 숨긴다(require_leader)
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
      for (const f of ["room_open_recruit(text)", "room_start(text,boolean)", "room_archive(text)", "room_unarchive(text)", "room_delete(text)", "room_update(text,jsonb)"]) {
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
  {
    name: "seed: 9 rooms with fixed ids, mock capacity/status, 19 tags, invites, settings",
    run: async (q) => {
      const rows = await q(`select id::text as id, slug, status, visibility, join_mode, member_count, max_members, min_members,
                                   to_char(start_date,'YYYY-MM-DD') as s, to_char(end_date,'YYYY-MM-DD') as e
                            from public.rooms where id <= 9 order by id`);
      assertEquals(rows.map((r) => [r.id, r.slug]), [
        ["1","toeic"],["2","cs"],["3","sqld"],["4","docker"],["5","jcg"],["6","aws"],["7","react"],["8","algo"],["9","spring"]]);
      const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
      assertEquals([by.toeic.status, by.toeic.member_count, by.toeic.max_members, by.toeic.s, by.toeic.e], ["RECRUIT", 2, 8, "2026-11-02", "2026-12-27"]);
      assertEquals([by.cs.member_count, by.cs.max_members, by.cs.s], [3, 6, "2026-10-19"]);
      assertEquals([by.sqld.status, by.sqld.join_mode, by.sqld.member_count, by.sqld.max_members], ["RECRUIT", "APPROVAL", 1, 5]);
      assertEquals([by.docker.member_count, by.docker.max_members, by.docker.s], [1, 6, "2026-11-09"]);
      assertEquals([by.jcg.join_mode, by.jcg.member_count, by.jcg.max_members], ["APPROVAL", 4, 4]);
      assertEquals([by.aws.status, by.aws.join_mode, by.aws.member_count, by.aws.max_members, by.aws.s, by.aws.e], ["ACTIVE", "APPROVAL", 4, 6, "2026-10-01", "2026-12-31"]);
      assertEquals([by.react.status, by.react.member_count, by.react.max_members, by.react.s, by.react.e], ["ACTIVE", 5, 8, "2026-09-21", "2026-11-15"]);
      assertEquals([by.algo.status, by.algo.member_count, by.algo.max_members, by.algo.s, by.algo.e], ["ENDED", 6, 6, "2026-07-01", "2026-09-30"]);
      assertEquals([by.spring.status, by.spring.visibility, by.spring.join_mode, by.spring.member_count, by.spring.max_members, by.spring.e], ["ACTIVE", "PRIVATE", "APPROVAL", 5, 5, "2027-01-31"]);
      // A13: spec 02 §8 — sqld 그룹장은 과제를 하지 않는다
      const ldt = await q(`select slug, leader_does_tasks from public.rooms where slug in ('sqld','aws') order by slug`);
      assertEquals(ldt.map((r) => [r.slug, r.leader_does_tasks]), [["aws", true], ["sqld", false]]);
      // I7: member_count = ACTIVE 행 수
      const bad = await q(`select r.slug from public.rooms r where r.id <= 9
                           and r.member_count <> (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'ACTIVE')`);
      assertEquals(bad, []);
      const [aws] = await q(`select string_agg(p.nickname || ':' || m.role || ':' || m.status, ',' order by (m.role = 'LEADER') desc, m.joined_at, m.id) as x
                             from public.room_members m join public.profiles p on p.id = m.user_id where m.room_id = 6`);
      assertEquals(aws.x, "민수:LEADER:ACTIVE,지은:MEMBER:ACTIVE,철수:MEMBER:ACTIVE,하나:MEMBER:ACTIVE,도윤:MEMBER:INACTIVE");
      const [sq] = await q(`select status, applied_at is not null as a from public.room_members where room_id = 3 and user_id = $1`, [USERS.철수]);
      assertEquals([sq.status, sq.a], ["PENDING", true]);
      assertEquals((await q(`select count(*)::int as n from public.tags`))[0].n, 19);
      assertEquals((await q(`select count(*)::int as n from public.room_tags where room_id <= 9`))[0].n, 22);
      assertEquals((await q(`select string_agg(t.label, ',' order by rt.sort_order) as x from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = 6`))[0].x, "AWS,클라우드,자격증");
      assertEquals((await q(`select count(*)::int as n from public.room_invites where token like 'seed-%' and revoked_at is null`))[0].n, 9);
      assertEquals((await q(`select count(*)::int as n from public.room_notification_settings where room_id <= 9`))[0].n, 9);
      // 시퀀스가 9 뒤로 옮겨져 새 방을 만들 수 있다
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      assertEquals(Number(d.id) > 9, true);
    },
  },
  {
    name: "rooms_list: 철수 public — 8장 정렬, tabCounts 8/5/1(mine 에 그룹장 docker 포함, 0029), jcg isFull, docker 1/6, facets 자격증3·클라우드2",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const r = await listRooms(q);
      assertEquals(r.today, TODAY);
      assertEquals([r.page, r.size, r.totalElements], [0, 24, 8]);
      assertEquals(r.items.map((x: any) => x.slug), ["react", "aws", "jcg", "cs", "sqld", "toeic", "docker", "algo"]);
      assertEquals(r.tabCounts, { public: 8, mine: 5, created: 1 });
      const by = Object.fromEntries(r.items.map((x: any) => [x.slug, x]));
      assertEquals([by.jcg.status, by.jcg.isFull, by.jcg.memberCount, by.jcg.maxMembers, by.jcg.joinMode], ["recruit", true, 4, 4, "approval"]);
      assertEquals([by.toeic.isFull, by.toeic.memberCount], [false, 2]);
      assertEquals([by.docker.memberCount, by.docker.membership, by.docker.progress], [1, { role: "leader", status: "active" }, { kind: "recruit" }]);
      assertEquals([by.sqld.membership, by.sqld.progress], [{ role: "member", status: "pending" }, { kind: "recruit" }]);
      assertEquals(by.toeic.membership, null);
      assertEquals(by.aws.leader, { userId: USERS.민수, nickname: "민수", tone: "mint" });
      assertEquals(by.aws.tags.map((t: any) => [t.slug, t.auto]), [["aws", true], ["cloud", true], ["certificate", false]]);
      assertEquals([by.aws.startDate, by.aws.endDate, by.aws.isPublic, by.aws.id], ["2026-10-01", "2026-12-31", true, "6"]);
      assertEquals(r.tagFacets.length, 16);
      assertEquals(r.tagFacets[0], { slug: "certificate", label: "자격증", count: 3 });
      assertEquals(r.tagFacets[1], { slug: "cloud", label: "클라우드", count: 2 });
      assertEquals(r.tagFacets.slice(2).every((f: any) => f.count === 1), true);
    },
  },
  {
    name: "rooms_list: mine 5(sqld pending·그룹장 docker 포함, 0029), created 1, facets 는 scope 기준",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const mine = await listRooms(q, { scope: "mine" });
      assertEquals(mine.items.map((x: any) => x.slug), ["aws", "spring", "sqld", "docker", "algo"]);   // active(start asc) → recruit → ended
      assertEquals(mine.totalElements, 5);
      assertEquals(mine.items.find((x: any) => x.slug === "docker").membership, { role: "leader", status: "active" });
      assertEquals(mine.items.find((x: any) => x.slug === "spring").isPublic, false);
      assertEquals(mine.tagFacets.length, 12);   // docker 방 태그 2개가 더해짐 (0029)
      assertEquals(mine.tagFacets[0], { slug: "certificate", label: "자격증", count: 2 });
      const created = await listRooms(q, { scope: "created" });
      assertEquals(created.items.map((x: any) => x.slug), ["docker"]);
      assertEquals(created.tabCounts, { public: 8, mine: 5, created: 1 });
    },
  },
  {
    name: "rooms_list (0029): mine 은 그룹장 방(DRAFT 포함)을 담는다 — created ⊂ mine, 태그·상태 필터·tabCounts·facets 일치, 보관하면 빠진다",
    run: async (q) => {
      await setToday(q, TODAY);
      // 보람: 시드에서 멤버·그룹장 방이 없는 사용자라고 가정하지 않고 지금 상태를 기준으로 증가분을 본다
      await asUser(q, USERS.보람);
      const before = await listRooms(q, { scope: "mine" });
      const d = await createRoom(q, USERS.보람, { title: "Led Draft" });   // DRAFT(준비중) 방
      await asUser(q, USERS.보람);
      const mine = await listRooms(q, { scope: "mine" });
      assertEquals(mine.totalElements, before.totalElements + 1);
      assertEquals(mine.tabCounts.mine, before.tabCounts.mine + 1);
      const led = mine.items.find((x: any) => x.slug === d.slug);
      assertEquals([led.status, led.membership], ["draft", { role: "leader", status: "active" }]);
      // created ⊂ mine
      const created = await listRooms(q, { scope: "created" });
      const mineSlugs = new Set(mine.items.map((x: any) => x.slug));
      assertEquals(created.items.every((x: any) => mineSlugs.has(x.slug)), true);
      // 공개 목록에는 여전히 DRAFT 가 안 보인다
      assertEquals((await listRooms(q)).items.some((x: any) => x.slug === d.slug), false);

      // 철수: docker(그룹장, RECRUIT) — 태그 필터·상태 필터 모두 mine 에서 잡힌다
      await asUser(q, USERS.철수);
      const tagged = await listRooms(q, { scope: "mine", tags: ["docker"] });
      assertEquals(tagged.items.map((x: any) => x.slug), ["docker"]);
      assertEquals([tagged.tabCounts.mine, tagged.tabCounts.created], [1, 1]);
      assertEquals((await listRooms(q, { scope: "mine" })).tagFacets.some((f: any) => f.slug === "docker"), true);
      assertEquals((await listRooms(q, { scope: "mine", status: "recruit" })).items.some((x: any) => x.slug === "docker"), true);
      // 보관된 그룹장 방은 mine·created 모두에서 빠진다(보관 규칙 불변). room_archive 는 RECRUIT 를 거절하므로 컬럼을 직접 세운다
      await q(`update public.rooms set archived_at = now() where slug = 'docker'`);
      const archived = await listRooms(q, { scope: "mine" });
      assertEquals(archived.items.some((x: any) => x.slug === "docker"), false);
      assertEquals([archived.tabCounts.mine, archived.tabCounts.created], [4, 0]);
    },
  },
  {
    name: "rooms_list: anon — public 8, mine/created 0, membership null, mine scope → AUTH_REQUIRED; 비공개·DRAFT 숨김",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const r = await listRooms(q);
      assertEquals(r.totalElements, 8);
      assertEquals(r.tabCounts, { public: 8, mine: 0, created: 0 });
      assertEquals(r.items.every((x: any) => x.membership === null), true);
      assertEquals(r.items.some((x: any) => x.slug === "spring"), false);
      await expectFailSql(q, `select public.rooms_list('mine','all',null,null,0,24,'default')`, [], "AUTH_REQUIRED");
      await expectFailSql(q, `select public.rooms_list('created','all',null,null,0,24,'default')`, [], "AUTH_REQUIRED");
      // DRAFT 는 public 에 안 보이고 created 에만 status draft 로
      const d = await createRoom(q, USERS.보람, { title: "Draft Only" });
      await asAnon(q);
      assertEquals((await listRooms(q)).totalElements, 8);
      await asUser(q, USERS.보람);
      assertEquals((await listRooms(q)).totalElements, 8);
      const c = await listRooms(q, { scope: "created" });
      assertEquals(c.items.map((x: any) => [x.slug, x.status, x.progress.kind]), [[d.slug, "draft", "recruit"]]);
      assertEquals(c.tabCounts.created, 1);
    },
  },
  {
    name: "rooms_list: progress (시드 §3) — 철수 aws mine 2/6 next EC2 10/14, 민수 mine 2/5 next null, 서연 team 2/5, react team 4/8, algo final 68/78·3회차",
    run: async (q) => {
      await setToday(q, TODAY);
      const [{ ec2, alb }] = await q(`select (select id::text from public.goal_nodes where room_id = 6 and title = 'EC2 인스턴스 유형 정리') as ec2,
                                             (select id::text from public.goal_nodes where room_id = 6 and title = 'ALB vs NLB 실습') as alb`);
      await asUser(q, USERS.철수);
      let by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      // 철수 aws: IAM D·VPC D·EC2 O·ALB·AutoScaling·RDS = 2/6 = 33% (목업 50% 폐기, D5)
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 6, nextTask: { nodeId: ec2, title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } });
      assertEquals(by.aws.membership, { role: "member", status: "active" });
      assertEquals(by.react.progress, { kind: "team", currentRound: { index: 4, label: "4주차", title: "상태 관리하기" }, totalRounds: 8 });
      assertEquals(by.algo.progress, { kind: "final", submitted: 68, assigned: 78, totalRounds: 3 });
      assertEquals(by.algo.membership, { role: "member", status: "active" });
      // 민수(그룹장·담당): IAM·VPC·ALB·AutoScaling·RDS = 2/5. 10/12 에 OPEN 인 미제출 없음(ALB 10/15 시작) → null
      await asUser(q, USERS.민수);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 5, nextTask: null });
      // 그룹장이 과제를 안 하면 team
      await q(`update public.rooms set leader_does_tasks = false where id = 6`);
      await q(`select public.assignment_resync(6)`);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 5 });
      await asUser(q, USERS.서연);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 5 });
      // 철수가 EC2 를 제출하면 10/12 엔 OPEN 미제출이 없어 null, 10/15 에 ALB(10/21)
      await asUser(q, USERS.철수);
      await q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late) values ($1, $2, 'x', now(), false)`, [ec2, USERS.철수]);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals([by.aws.progress.submitted, by.aws.progress.assigned, by.aws.progress.nextTask], [3, 6, null]);
      await setToday(q, "2026-10-15");
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.nextTask, { nodeId: alb, title: "ALB vs NLB 실습", dueDate: "2026-10-21" });
      await setToday(q, TODAY);
      // 도윤(INACTIVE) 은 mine 이 아니고 team
      await asUser(q, USERS.도윤);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.kind, "team");
      assertEquals(by.aws.membership, { role: "member", status: "inactive" });
    },
  },
  {
    name: "rooms_list: 상태 칩·검색·태그 OR·페이지·정렬",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const slugs = async (a: Parameters<typeof listRooms>[1]) => (await listRooms(q, a)).items.map((x: any) => x.slug);
      assertEquals(await slugs({ status: "recruit" }), ["jcg", "cs", "sqld", "toeic", "docker"]);
      assertEquals(await slugs({ status: "active" }), ["react", "aws"]);
      assertEquals(await slugs({ status: "ended" }), ["algo"]);
      assertEquals(await slugs({ q: "토익" }), ["toeic"]);
      assertEquals(await slugs({ q: "AWS" }), ["aws"]);            // 태그 label
      assertEquals(await slugs({ q: "aws" }), ["aws"]);            // ILIKE
      assertEquals(await slugs({ q: "k8s" }), ["docker"]);         // 태그 alias
      assertEquals(await slugs({ q: "  " }), ["react", "aws", "jcg", "cs", "sqld", "toeic", "docker", "algo"]);   // 공백은 무시
      assertEquals(await slugs({ q: "없는검색어" }), []);
      assertEquals(await slugs({ q: "%" }), []);                   // D10: 와일드카드가 아니라 글자 그대로
      assertEquals(await slugs({ q: "_" }), []);
      assertEquals(await slugs({ tags: ["cloud", "certificate"] }), ["aws", "jcg", "sqld", "docker"]);          // OR
      assertEquals(await slugs({ tags: ["cloud"], status: "recruit" }), ["docker"]);
      // 0024(#19): tabCounts 는 상태·검색·태그 조건을 적용한 수(현재 scope 의 totalElements 와 같다). facets 는 영향 없음
      const f = await listRooms(q, { tags: ["cloud"], status: "recruit", q: "Docker" });
      assertEquals([f.totalElements, f.tabCounts.public, f.tagFacets.length], [1, 1, 16]);
      // 페이지
      const p1 = await listRooms(q, { size: 3, page: 1 });
      assertEquals([p1.page, p1.size, p1.totalElements, p1.items.map((x: any) => x.slug)], [1, 3, 8, ["cs", "sqld", "toeic"]]);
      assertEquals((await listRooms(q, { size: 3, page: 5 })).items, []);
      // 정렬
      assertEquals(await slugs({ sort: "latest" }), ["jcg", "docker", "sqld", "cs", "toeic", "aws", "react", "algo"]);   // created_at desc
      assertEquals(await slugs({ sort: "startDate" }), ["algo", "react", "aws", "jcg", "cs", "sqld", "toeic", "docker"]); // start_date asc, id desc — 같은 10/19 면 jcg(5) 가 cs(2) 앞
      // startDate 정렬은 created_at 을 보지 않는다: cs 를 가장 최근 생성으로 바꿔도 jcg 가 앞
      await q(`update public.rooms set created_at = now() + interval '1 day' where slug = 'cs'`);
      assertEquals(await slugs({ sort: "startDate" }), ["algo", "react", "aws", "jcg", "cs", "sqld", "toeic", "docker"]);
      assertEquals((await slugs({ sort: "latest" }))[0], "cs");
      // 페이지 클램프: size 1~100, 아주 큰 page 도 22003 없이 빈 페이지
      const big = await listRooms(q, { page: 30000000, size: 100 });
      assertEquals([big.page, big.size, big.items], [30000000, 100, []]);
      assertEquals((await listRooms(q, { size: 500 })).size, 100);
      const one = await listRooms(q, { size: 0 });
      assertEquals([one.size, one.items.length], [1, 1]);
      assertEquals((await listRooms(q, { page: -3 })).page, 0);
      // 검증
      await expectFailSql(q, `select public.rooms_list('everyone','all',null,null,0,24,'default')`, [], "VALIDATION_FAILED");
      await expectFailSql(q, `select public.rooms_list('public','full',null,null,0,24,'default')`, [], "VALIDATION_FAILED");
      await expectFailSql(q, `select public.rooms_list('public','all',null,null,0,24,'popular')`, [], "VALIDATION_FAILED");
    },
  },
  {
    name: "rooms_list: 보관된 방은 모든 scope·tabCounts·facets 에서 빠진다 (Review Focus 3)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      await asUser(q, USERS.철수);
      const pub = await listRooms(q);
      assertEquals(pub.items.some((x: any) => x.slug === "aws"), false);
      assertEquals(pub.tabCounts, { public: 7, mine: 4, created: 1 });
      assertEquals(pub.tagFacets.find((f: any) => f.slug === "certificate").count, 2);
      assertEquals((await listRooms(q, { scope: "mine" })).items.some((x: any) => x.slug === "aws"), false);
      await asUser(q, USERS.민수);
      assertEquals((await listRooms(q, { scope: "created" })).items, []);
      await q(`select public.room_unarchive('aws')`);
      assertEquals((await listRooms(q, { scope: "created" })).items.map((x: any) => x.slug), ["aws"]);
    },
  },
  {
    name: "privileges (T4): rooms_list 만 anon·authenticated, 헬퍼는 EXECUTE 없음",
    run: async (q) => {
      const fnCan = async (role: string, fn: string) =>
        (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
      for (const role of ["anon", "authenticated"]) {
        assertEquals(await fnCan(role, "public.rooms_list(text,text,text,text[],int,int,text)"), true, `${role} rooms_list`);
        for (const f of ["room_in_scope(bigint,text,uuid)", "room_matches(bigint,text,text,text[])", "like_escape(text)"]) {
          assertEquals(await fnCan(role, `public.${f}`), false, `${role} ${f}`);
        }
      }
      await setToday(q, TODAY);
      await asAnon(q);
      await q("set local role anon");
      const [{ r }] = await q(`select public.rooms_list('public','all',null,null,0,24,'default') as r`);
      assertEquals(r.totalElements, 8);
      await q("reset role");
      await asUser(q, USERS.철수);
      await q("set local role authenticated");
      const [{ r: m }] = await q(`select public.rooms_list('mine','all',null,null,0,24,'default') as r`);
      assertEquals(m.totalElements, 5);                                    // aws·spring·sqld(PENDING)·algo(MEMBER ∧ ACTIVE|PENDING) + docker(그룹장, 0029)
      await q("reset role");
    },
  },
  {
    name: "room_get: me.state matrix for 철수 (toeic none, sqld pending, docker leader, jcg none, aws active, react none, algo active)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const st = async (slug: string) => (await q(`select public.room_get($1) as r`, [slug]))[0].r.me.state;
      const states: string[] = [];
      for (const s of ["toeic", "sqld", "docker", "jcg", "aws", "react", "algo"]) states.push(await st(s));   // 한 연결에서 순차 실행 (savepoint 겹침 방지)
      assertEquals(states, ["none", "pending", "leader", "none", "active", "none", "active"]);
      assertEquals(await st("spring"), "active");                      // 비공개지만 멤버
      await asUser(q, USERS.도윤);
      assertEquals(await st("aws"), "inactive");
      await asUser(q, USERS.철수);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["toeic"]);
      assertEquals([r.today, r.id, r.slug, r.status, r.archived, r.isPublic, r.joinMode], [TODAY, "1", "toeic", "recruit", false, true, "direct"]);
      assertEquals([r.memberCount, r.maxMembers, r.minMembers, r.leader.nickname, r.leaderDoesTasks], [2, 8, 4, "서연", true]);
      assertEquals(r.members.map((m: any) => [m.nickname, m.role, m.status]), [["서연", "leader", "active"], ["도현", "member", "active"]]);
      assertEquals(r.tags.map((t: any) => t.label), ["영어", "토익"]);
      // toeic(RECRUIT, 시드 §3: 8회차 × 공통 2) — 모집중에도 배정 실체화(D4): 서연(그룹장)·도현 × 16 = 32
      assertEquals([r.currentRound, r.rounds.length, r.myProgress, r.invite, r.pendingCount], [null, 8, null, null, 0]);
      assertEquals(r.rounds[0], { id: r.rounds[0].id, label: "1주차", title: "LC Part 1·2", startDate: "2026-11-02", endDate: "2026-11-08", leafCount: 2, assigned: 4, submitted: 0, pct: 0 });
      assertEquals(r.stats, { roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 32, totalSubmissions: 0, overallPct: 0, unassignedCount: 0, startWeekdays: [1] });
    },
  },
  {
    name: "room_get: anon sees public rooms with me null; private/DRAFT/missing → ROOM_NOT_FOUND",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["toeic"]);
      assertEquals([r.me, r.myProgress, r.invite, r.pendingCount], [null, null, null, 0]);
      await expectFailSql(q, `select public.room_get($1)`, ["spring"], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_get($1)`, ["nope"], "ROOM_NOT_FOUND");
      const d = await createRoom(q, USERS.서연, { title: "Draft Hidden" });
      await asAnon(q);
      await expectFailSql(q, `select public.room_get($1)`, [d.slug], "ROOM_NOT_FOUND");
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_get($1)`, [d.slug], "ROOM_NOT_FOUND");   // 비멤버 로그인도 DRAFT 는 못 본다
      await expectFailSql(q, `select public.room_get($1)`, ["spring"], "ROOM_NOT_FOUND"); // 비공개 비멤버
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get($1) as r`, [d.slug]))[0].r.status, "draft");
    },
  },
  {
    name: "room_get: invite/pendingCount only for leader; my PENDING row visible only to me",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.가은);
      const [{ a }] = await q(`select public.room_get($1) as a`, ["sqld"]);
      assertEquals([a.me, a.pendingCount, a.invite], [{ state: "leader" }, 1, { token: "seed-sqld", url: "/invite/seed-sqld", code: null, bypass: null }]);   // 0032: seed 행은 invite_get 전까지 code null
      assertEquals(a.members.map((m: any) => m.nickname), ["가은"]);                 // 타인의 PENDING 은 members 에 없음
      await asUser(q, USERS.철수);
      const [{ b }] = await q(`select public.room_get($1) as b`, ["sqld"]);
      assertEquals([b.me, b.pendingCount, b.invite], [{ state: "pending" }, 0, null]);
      assertEquals(b.members.map((m: any) => [m.nickname, m.status]), [["가은", "active"], ["철수", "pending"]]);
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get($1) as c`, ["sqld"]))[0].c.members.map((m: any) => m.nickname), ["가은"]);
    },
  },
  {
    name: "room_get: aws (시드 §3) — currentRound 2주차 tasks/people, rounds 5/8·1/3·0/4·0/4·0/6, stats 24%, myProgress 2/6 next EC2, 도윤 inactive listed",
    run: async (q) => {
      await setToday(q, TODAY);
      const [{ ec2, s3 }] = await q(`select (select id::text from public.goal_nodes where room_id = 6 and title = 'EC2 인스턴스 유형 정리') as ec2,
                                            (select id::text from public.goal_nodes where room_id = 6 and title = 'S3 스토리지 클래스 발표자료') as s3`);
      await asUser(q, USERS.철수);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["aws"]);
      assertEquals(r.members.map((m: any) => [m.nickname, m.status]),
        [["민수", "active"], ["지은", "active"], ["철수", "active"], ["하나", "active"], ["도윤", "inactive"]]);
      assertEquals(r.rounds.map((x: any) => [x.label, x.leafCount, x.assigned, x.submitted, x.pct]),
        [["1주차", 2, 8, 5, 63], ["2주차", 2, 3, 1, 33], ["3주차", 1, 4, 0, 0], ["4주차", 1, 4, 0, 0], ["5주차", 2, 6, 0, 0]]);
      assertEquals([r.currentRound.label, r.currentRound.title, r.currentRound.startDate, r.currentRound.endDate], ["2주차", "EC2·S3", "2026-10-08", "2026-10-14"]);
      assertEquals(r.currentRound.tasks.map((x: any) => [x.id, x.title, x.type, x.startDate, x.endDate, x.people.map((p: any) => `${p.nickname}:${p.status}`).sort()]), [
        [ec2, "EC2 인스턴스 유형 정리", "designated", "2026-10-08", "2026-10-14", ["지은:done", "철수:open"]],
        [s3, "S3 스토리지 클래스 발표자료", "designated", "2026-10-10", "2026-10-14", ["하나:open"]],
      ]);
      assertEquals(r.stats, { roundCount: 5, leafCount: 8, commonCount: 5, designatedCount: 3, totalAssignments: 25, totalSubmissions: 6, overallPct: 24, unassignedCount: 0, startWeekdays: [4] });
      // 철수 2/6 = 33% (방 목록 슬롯과 같은 값, D5), 다음 마감은 OPEN 인 EC2
      assertEquals(r.myProgress, { submitted: 2, assigned: 6, nextDue: { nodeId: ec2, title: "EC2 인스턴스 유형 정리", roundLabel: "2주차", dueDate: "2026-10-14" } });
      // 1주차 안(10/05)에서 보면 current 가 1주차 — IAM(10/01–10/03) 은 이미 마감: 하나 missed
      await setToday(q, "2026-10-05");
      const [{ r2 }] = await q(`select public.room_get($1) as r2`, ["aws"]);
      assertEquals(r2.currentRound.label, "1주차");
      assertEquals(r2.currentRound.tasks[0].people.map((p: any) => `${p.nickname}:${p.status}`).sort(), ["민수:done", "지은:late", "철수:done", "하나:missed"].sort());
      // 시작 전이면 null
      await setToday(q, "2026-09-30");
      assertEquals((await q(`select public.room_get($1) as r3`, ["aws"]))[0].r3.currentRound, null);
      // 비로그인은 집계는 보되 myProgress 없음
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ an }] = await q(`select public.room_get($1) as an`, ["aws"]);
      assertEquals([an.me, an.myProgress, an.rounds.length, an.currentRound.tasks.length], [null, null, 5, 2]);
    },
  },
  {
    name: "room_get: archived room readable by leader/members only; invite token opens private room; rotated token → ROOM_NOT_FOUND",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      assertEquals((await q(`select public.room_get('aws') as r`))[0].r.archived, true);
      await asUser(q, USERS.철수);
      assertEquals((await q(`select public.room_get('aws') as r`))[0].r.archived, true);
      await asUser(q, USERS.서연);
      await expectFailSql(q, `select public.room_get('aws')`, [], "ROOM_NOT_FOUND");
      await asAnon(q);
      await expectFailSql(q, `select public.room_get('aws')`, [], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_get('aws', 'seed-aws')`, [], "ROOM_NOT_FOUND");   // 토큰도 보관 방은 못 연다
      // 비공개 spring: 토큰으로 비멤버·비로그인 읽기
      const [{ r }] = await q(`select public.room_get('spring', 'seed-spring') as r`);
      assertEquals([r.slug, r.me], ["spring", null]);
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get('spring', 'seed-spring') as r`))[0].r.me, { state: "none" });
      await asUser(q, USERS.지훈);
      await q(`select public.invite_rotate('spring')`);
      await asUser(q, USERS.서연);
      await expectFailSql(q, `select public.room_get('spring', 'seed-spring')`, [], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "privileges (T7): catalog sweep — anon/authenticated EXECUTE allowlist (D7); public RPCs run under real roles",
    run: async (q) => {
      const can = async (role: string, fn: string) =>
        (await q(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]))[0].ok as boolean;
      // 카탈로그 sweep: 확장 함수·0001 트리거 함수(handle_new_auth_user)를 뺀 public 함수 중 역할이 EXECUTE 가능한 전부
      const sweep = async (role: string) => (await q(
        `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute')
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
            and p.proname <> 'handle_new_auth_user' order by 1`, [role])).map((x) => x.f as string);
      // 출처: 0002(me_get·me_update·nickname_check·meta_get·current_user_id 의 GRANT), 0003(can_read_*·is_room_*·is_my_task),
      // 0004(room_create·room_open_recruit…room_update·rooms_list·room_get), 0005(room_join…room_members_get·invite_preview/get/rotate/join), 0006(curriculum_get·node_create/delete/archive/unarchive/update/move·me_studies·me_schedule), 0007(task_get·submission_upsert·file_register), 0008(notifications_list/unread_count/read/read_all·settings_get/put·member_deactivate_preview/member_deactivate), 0009(tags_search·room_tags_get·room_tags_put·room_tags_suggest), 0015(file_discard), 0014(personal_create/update/archive/delete/complete·me_tasks)
      const ANON = [
        "can_read_room(bigint)", "can_read_submission(bigint,uuid)", "can_read_submissions(bigint)", "current_user_id()",
        "invite_preview(text)", "curriculum_get(text,boolean)", "is_room_leader(bigint)", "is_room_member(bigint)", "meta_get()", "node_doc_readable_me(bigint)",
        "room_get(text,text)", "room_tags_get(text)", "rooms_list(text,text,text,text[],integer,integer,text)", "task_get(text,bigint)", "tags_search(text)",
        // 0035: AI 연동 게이트웨이(PAT 는 anon 키로 부른다 — 내부 api_*·personal_*_many 는 GRANT 없음)
        "api_invoke(text,text,jsonb)",
      ];
      const AUTH = [
        ...ANON,
        "invite_get(text)", "invite_join(text,text)", "invite_rotate(text)", "is_my_task(bigint)",
        "me_get()", "me_schedule(date,date)", "me_studies(boolean)", "me_update(text,boolean)", "nickname_check(text)",
        "node_archive(text,bigint)", "node_create(text,bigint,text,text,text,date,date,integer)", "node_delete(text,bigint)", "node_move(text,bigint,bigint,integer)", "node_unarchive(text,bigint)", "node_update(text,bigint,jsonb)",
        "room_apply(text,text,text)", "room_approve(text,uuid)", "room_applications(text)", "room_archive(text)",
        "room_cancel_application(text)", "room_create(text,text,date,date,integer,boolean,text,text,text,integer,boolean,uuid,text[])",
        "room_delete(text)", "room_join(text,text)", "room_leave(text)", "room_members_get(text)",
        "room_open_recruit(text)", "room_reject(text,uuid)", "room_start(text,boolean)", "room_unarchive(text)", "room_update(text,jsonb)",
        "submission_upsert(bigint,text,text[],uuid[])", "file_register(bigint,text,text,text,bigint)", "file_discard(uuid)",
        "notifications_list(text,integer)", "notifications_unread_count()", "notifications_read(bigint)", "notifications_read_all()",
        "settings_get(text)", "settings_put(text,jsonb)",
        "member_deactivate_preview(text,uuid)", "member_deactivate(text,uuid,jsonb)", "member_set_curriculum_editor(text,uuid,boolean)",
        "room_tags_put(text,text[],text[])", "room_tags_suggest(text)",
        "personal_create(text,bigint,text,date,date,text)", "personal_update(text,bigint,jsonb)", "personal_archive(text,bigint,boolean)",
        "personal_delete(text,bigint)", "personal_complete(text,bigint,boolean)", "me_tasks()",
        // 0024: 탈퇴 요청
        "member_leave_request(text,text)", "member_leave_request_cancel(text)", "member_leave_request_dismiss(text,uuid)", "room_leave_requests(text)",
        // 0030: 진행목표 항목 첨부 — Storage 정책 래퍼(node_doc_readable_me 는 ANON 에서 상속) · RPC 4개
        "node_doc_object_readable(text)", "node_doc_object_writable(text)",
        "node_file_register(bigint,text,text,text,bigint)", "node_files_set(bigint,uuid[])", "node_file_discard(uuid)", "node_files(bigint)",
        // 0032: 추가 모집 열기·닫기
        "room_extra_recruit_open(text,date,integer,text)", "room_extra_recruit_close(text)",
        // 0032: 바로 참가 설정 · 코드 조회
        "invite_bypass_set(text,date,integer)", "invite_code_lookup(text)",
        // 0033: AI 연동 개인 액세스 토큰(내부 api_* 헬퍼는 GRANT 없음)
        "pat_create(text,text[],integer)", "pat_list()", "pat_revoke(uuid)",
        // 0034: 진행목표 계획 미리보기·적용(내부 plan_* 는 GRANT 없음)
        "curriculum_plan_preview(text,jsonb,text)", "curriculum_plan_apply(text,text)",
        // 0037: 회차 시험 출제(내부 exam_* 헬퍼는 GRANT 없음)
        "exam_put(text,bigint,jsonb)", "exam_publish(text,bigint)", "exam_unpublish(text,bigint)", "exam_brief_put(text,bigint,jsonb)",
      ].sort();
      assertEquals(await sweep("anon"), ANON.sort());
      assertEquals(await sweep("authenticated"), AUTH);
      // 명시 양성 단언
      for (const fn of ["public.rooms_list(text,text,text,text[],integer,integer,text)", "public.room_get(text,text)", "public.invite_preview(text)"]) {
        assertEquals(await can("anon", fn), true, fn);
      }
      for (const fn of ["public.room_join(text,text)", "public.room_update(text,jsonb)", "public.invite_join(text,text)"]) {
        assertEquals(await can("anon", fn), false, fn);
        assertEquals(await can("authenticated", fn), true, fn);
      }
      // D3: 실제 역할로 실행
      await setToday(q, TODAY);
      await asAnon(q);
      await q("set local role anon");
      const [{ r }] = await q(`select public.room_get('aws') as r`);
      assertEquals([r.slug, r.me], ["aws", null]);
      await expectFailSql(q, `select public.room_get('spring')`, [], "ROOM_NOT_FOUND");
      await q("reset role");
      await asUser(q, USERS.철수);
      await q("set local role authenticated");
      const [{ r: s }] = await q(`select public.room_get('spring') as r`);
      assertEquals([s.slug, s.me], ["spring", { state: "active" }]);
      await q("reset role");
    },
  },
];
