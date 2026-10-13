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
];
