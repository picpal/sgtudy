import { asAnon, asUser, setToday } from "./_harness.ts";
import { assertEquals, assertNotEquals } from "@std/assert";
import { type Case, type Q, TODAY, USERS, createRoom, expectFailSql, seedLeaves } from "./_cases-rooms.ts";

/** 리프 1개(공통) + 지정 1개를 가진 RECRUIT 방. 반환: { id, slug, leafIds } */
export async function openRoom(q: Q, leader: string, over: Parameters<typeof createRoom>[2] = {}) {
  const d = await createRoom(q, leader, over);
  const { leafIds } = await seedLeaves(q, d.id, [
    { title: "공통", type: "COMMON", s: "2026-11-01", e: "2026-11-07" },
    { title: "지정", type: "DESIGNATED", s: "2026-11-01", e: "2026-11-07" },
  ]);
  await q(`select public.room_open_recruit($1)`, [d.slug]);
  return { id: String(d.id), slug: d.slug as string, leafIds };
}

const member = async (q: Q, room: string, uid: string) =>
  (await q(`select id::text as id, role, status, applied_at, joined_at, decided_at, decided_by::text as decided_by, left_at
            from public.room_members where room_id = $1 and user_id = $2`, [room, uid]))[0] ?? null;
const count = async (q: Q, room: string) => (await q(`select member_count from public.rooms where id = $1`, [room]))[0].member_count as number;
const asg = async (q: Q, node: string, uid: string) =>
  (await q(`select released_at is null as live from public.task_assignments where node_id = $1 and user_id = $2`, [node, uid]))[0]?.live ?? null;

type Step = { as: string | null; fn: string; args?: unknown[]; code?: string; note?: string };
async function runTable(q: Q, slug: string, steps: Step[]) {
  for (const s of steps) {
    if (s.as === null) await asAnon(q); else await asUser(q, s.as);
    const sql = `select public.${s.fn}($1${(s.args ?? []).map((_, i) => `, $${i + 2}`).join("")}) as r`;
    if (s.code) await expectFailSql(q, sql, [slug, ...(s.args ?? [])], s.code);
    else await q(sql, [slug, ...(s.args ?? [])]);
  }
}

export const MEMBERSHIP_CASES: Case[] = [
  {
    name: "direct room: join/leave/rejoin state table, same row reused, assignments follow",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { maxMembers: 3 });
      await runTable(q, r.slug, [
        { as: null, fn: "room_join", code: "AUTH_REQUIRED" },
        { as: USERS.서연, fn: "room_join", code: "OWNER_CANNOT_JOIN" },
        { as: USERS.서연, fn: "room_leave", code: "OWNER_CANNOT_LEAVE" },
        { as: USERS.현우, fn: "room_leave", code: "NOT_MEMBER" },
        { as: USERS.민수, fn: "room_apply", code: "JOIN_MODE_MISMATCH" },
        { as: USERS.민수, fn: "room_join" },
        { as: USERS.민수, fn: "room_join", code: "ALREADY_MEMBER" },
        { as: USERS.민수, fn: "room_cancel_application", code: "ALREADY_DECIDED" },
      ]);
      const m1 = await member(q, r.id, USERS.민수);
      assertEquals([m1.role, m1.status, m1.joined_at !== null], ["MEMBER", "ACTIVE", true]);
      assertEquals(await count(q, r.id), 2);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);          // 공통 리프 배정
      // MembershipResult 모양
      await asUser(q, USERS.민수);
      await q(`select public.room_leave($1)`, [r.slug]);
      const [{ res }] = await q(`select public.room_join($1) as res`, [r.slug]);
      assertEquals(res.me, { state: "active" });
      assertEquals([res.memberCount, res.pendingCount, res.today], [2, 0, TODAY]);
      assertEquals(res.members.map((x: any) => [x.nickname, x.role, x.status]), [["서연", "leader", "active"], ["민수", "member", "active"]]);
      // leave → CANCELED, 자리 반납, 배정 해제. 재참가는 같은 행
      await q(`select public.room_leave($1)`, [r.slug]);
      const m2 = await member(q, r.id, USERS.민수);
      assertEquals([m2.id, m2.status, m2.left_at !== null], [m1.id, "CANCELED", true]);
      assertEquals(await count(q, r.id), 1);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), false);
      await expectFailSql(q, `select public.room_leave($1)`, [r.slug], "NOT_MEMBER");
      await expectFailSql(q, `select public.room_cancel_application($1)`, [r.slug], "NOT_FOUND");
      await q(`select public.room_join($1)`, [r.slug]);
      const m3 = await member(q, r.id, USERS.민수);
      assertEquals([m3.id, m3.status, m3.left_at], [m1.id, "ACTIVE", null]);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);
      // INACTIVE 는 재참가 거부 (member_deactivate 는 플랜 04 — 여기선 행을 직접 바꾼다)
      await q(`update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2`, [r.id, USERS.민수]);
      await q(`select public.room_release_seat($1)`, [r.id]);
      await expectFailSql(q, `select public.room_join($1)`, [r.slug], "MEMBER_NOT_ACTIVE");
      // ACTIVE 방에서는 참가·취소 불가
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_start($1)`, [r.slug]);
      await asUser(q, USERS.현우);
      await expectFailSql(q, `select public.room_leave($1)`, [r.slug], "ROOM_NOT_RECRUITING");
      await asUser(q, USERS.지훈);
      await expectFailSql(q, `select public.room_join($1)`, [r.slug], "ROOM_NOT_RECRUITING");
      // DRAFT 방도 모집중이 아니다
      const d = await createRoom(q, USERS.서연, { title: "Draft" });
      await asUser(q, USERS.지훈);
      await expectFailSql(q, `select public.room_join($1)`, [d.slug], "ROOM_NOT_FOUND");   // 못 읽는 DRAFT 는 존재 자체를 숨긴다(03-api §0)
      await expectFailSql(q, `select public.room_join($1)`, ["no-such-room"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "approval room: apply/reject/re-apply/cancel/approve table — same row, applied_at refreshed (Review Focus 2)",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 3 });
      await runTable(q, r.slug, [
        { as: USERS.민수, fn: "room_join", code: "JOIN_MODE_MISMATCH" },
        { as: USERS.민수, fn: "room_apply" },
        { as: USERS.민수, fn: "room_apply", code: "ALREADY_PENDING" },
        { as: USERS.현우, fn: "room_approve", args: [USERS.민수], code: "NOT_LEADER" },
        { as: USERS.현우, fn: "room_applications", code: "NOT_LEADER" },
        { as: USERS.현우, fn: "room_members_get", code: "NOT_LEADER" },
      ]);
      const m1 = await member(q, r.id, USERS.민수);
      assertEquals([m1.status, m1.applied_at !== null, m1.joined_at], ["PENDING", true, null]);
      assertEquals(await count(q, r.id), 1);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), null);         // PENDING 은 배정 없음
      // 신청자 시점 결과: 내 PENDING 행이 members 에 보임
      await asUser(q, USERS.민수);
      const [{ res }] = await q(`select public.membership_result($1, $2) as res`, [r.id, USERS.민수]);
      assertEquals(res.me, { state: "pending" });
      assertEquals(res.members.map((x: any) => [x.nickname, x.status]), [["서연", "active"], ["민수", "pending"]]);
      assertEquals(res.pendingCount, 0);
      // 그룹장 읽기
      await asUser(q, USERS.서연);
      const [{ apps }] = await q(`select public.room_applications($1) as apps`, [r.slug]);
      assertEquals(apps.items.map((x: any) => x.nickname), ["민수"]);
      assertEquals(typeof apps.items[0].appliedAt, "string");
      const [{ all }] = await q(`select public.room_members_get($1) as all`, [r.slug]);
      assertEquals(all.items.map((x: any) => [x.nickname, x.role, x.status]), [["서연", "leader", "active"], ["민수", "member", "pending"]]);
      // 거절 → 같은 행 REJECTED, decided_by 서연
      const [{ rej }] = await q(`select public.room_reject($1, $2) as rej`, [r.slug, USERS.민수]);
      assertEquals([rej.me, rej.pendingCount, rej.memberCount], [{ state: "leader" }, 0, 1]);
      const m2 = await member(q, r.id, USERS.민수);
      assertEquals([m2.id, m2.status, m2.decided_by], [m1.id, "REJECTED", USERS.서연]);
      await runTable(q, r.slug, [
        { as: USERS.서연, fn: "room_reject", args: [USERS.민수], code: "ALREADY_DECIDED" },
        { as: USERS.서연, fn: "room_approve", args: [USERS.민수], code: "ALREADY_DECIDED" },
        { as: USERS.서연, fn: "room_approve", args: [USERS.현우], code: "NOT_FOUND" },
        { as: USERS.민수, fn: "room_cancel_application", code: "ALREADY_DECIDED" },
      ]);
      // 재신청: 같은 행, applied_at 갱신, decided_* 초기화
      await q(`update public.room_members set applied_at = applied_at - interval '1 day' where id = $1`, [m1.id]);
      const before = (await member(q, r.id, USERS.민수)).applied_at;
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [r.slug]);
      const m3 = await member(q, r.id, USERS.민수);
      assertEquals([m3.id, m3.status, m3.decided_at, m3.decided_by], [m1.id, "PENDING", null, null]);
      assertNotEquals(m3.applied_at, before);
      // 신청 취소 → CANCELED, 두 번째는 NOT_FOUND
      await q(`select public.room_cancel_application($1)`, [r.slug]);
      assertEquals((await member(q, r.id, USERS.민수)).status, "CANCELED");
      await expectFailSql(q, `select public.room_cancel_application($1)`, [r.slug], "NOT_FOUND");
      // 세 번째 신청 → 승인 → ACTIVE, joined_at, 자리 +1, 배정 생성
      await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      const [{ ok }] = await q(`select public.room_approve($1, $2) as ok`, [r.slug, USERS.민수]);
      assertEquals([ok.me, ok.memberCount, ok.pendingCount], [{ state: "leader" }, 2, 0]);
      assertEquals(ok.members.map((x: any) => x.nickname), ["서연", "민수"]);
      const m4 = await member(q, r.id, USERS.민수);
      assertEquals([m4.id, m4.status, m4.joined_at !== null, m4.decided_by], [m1.id, "ACTIVE", true, USERS.서연]);
      assertEquals(await count(q, r.id), 2);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_cancel_application($1)`, [r.slug], "ALREADY_DECIDED");
      await expectFailSql(q, `select public.room_apply($1)`, [r.slug], "ALREADY_MEMBER");
      // 승인은 RECRUIT 에서만
      await asUser(q, USERS.현우);
      await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_start($1)`, [r.slug]);                       // 현우 PENDING → EXPIRED
      assertEquals((await member(q, r.id, USERS.현우)).status, "EXPIRED");
      await expectFailSql(q, `select public.room_approve($1, $2)`, [r.slug, USERS.현우], "ROOM_NOT_RECRUITING");
      await asUser(q, USERS.현우);
      await expectFailSql(q, `select public.room_cancel_application($1)`, [r.slug], "ALREADY_DECIDED");
    },
  },
  {
    name: "capacity: jcg 4/4 join→ROOM_FULL, apply→ROOM_FULL; approve beyond capacity → ROOM_FULL keeps PENDING; sqld approve 철수",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      await expectFailSql(q, `select public.room_apply($1)`, ["jcg"], "ROOM_FULL");
      await q(`update public.rooms set join_mode = 'DIRECT' where slug = 'jcg'`);
      await expectFailSql(q, `select public.room_join($1)`, ["jcg"], "ROOM_FULL");
      assertEquals(await member(q, "5", USERS.철수), null);
      assertEquals(await count(q, "5"), 4);
      // 승인 초과
      const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 2 });
      await asUser(q, USERS.민수); await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.현우); await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_approve($1, $2)`, [r.slug, USERS.민수]);
      await expectFailSql(q, `select public.room_approve($1, $2)`, [r.slug, USERS.현우], "ROOM_FULL");
      assertEquals((await member(q, r.id, USERS.현우)).status, "PENDING");
      assertEquals(await count(q, r.id), 2);
      // 시드: 가은이 철수 승인 → sqld 2/5
      await asUser(q, USERS.가은);
      const [{ res }] = await q(`select public.room_approve($1, $2) as res`, ["sqld", USERS.철수]);
      assertEquals([res.memberCount, res.pendingCount], [2, 0]);
      assertEquals((await member(q, "3", USERS.철수)).status, "ACTIVE");
    },
  },
  {
    name: "private room: join needs a valid invite token (ROOM_NOT_FOUND without, INVITE_REVOKED with rotated)",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { isPublic: false });
      const [{ token }] = await q(`select token from public.room_invites where room_id = $1 and revoked_at is null`, [r.id]);
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.room_join($1)`, [r.slug], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_join($1, $2)`, [r.slug, "bogus"], "ROOM_NOT_FOUND");
      await q(`update public.room_invites set revoked_at = now() where token = $1`, [token]);
      await expectFailSql(q, `select public.room_join($1, $2)`, [r.slug, token], "INVITE_REVOKED");
      await q(`update public.room_invites set revoked_at = null where token = $1`, [token]);
      const [{ res }] = await q(`select public.room_join($1, $2) as res`, [r.slug, token]);
      assertEquals(res.me, { state: "active" });
      // 공개 방은 토큰이 없어도, 엉뚱해도 된다
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1, $2)`, ["toeic", "bogus"]);
      assertEquals(await count(q, "1"), 3);
    },
  },
  {
    name: "existence oracle (I-1/I-2): outsider on unreadable room → ROOM_NOT_FOUND; readable room → NOT_LEADER/NOT_MEMBER",
    run: async (q) => {
      await setToday(q, TODAY);
      // 비공개 spring(ACTIVE): 승호는 멤버 행이 없다 — 그룹장·멤버 RPC 모두 존재를 숨긴다
      await runTable(q, "spring", [
        { as: USERS.승호, fn: "room_open_recruit", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_start", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_archive", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_unarchive", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_delete", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_update", args: [JSON.stringify({ title: "x" })], code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_applications", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_members_get", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "invite_get", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "invite_rotate", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_approve", args: [USERS.철수], code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_reject", args: [USERS.철수], code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_join", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_apply", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_leave", code: "ROOM_NOT_FOUND" },
        { as: USERS.승호, fn: "room_cancel_application", code: "ROOM_NOT_FOUND" },
        // 멤버(철수)는 읽을 수 있으니 NOT_LEADER
        { as: USERS.철수, fn: "room_update", args: [JSON.stringify({ title: "x" })], code: "NOT_LEADER" },
        { as: USERS.철수, fn: "invite_get", code: "NOT_LEADER" },
      ]);
      // 공개 aws: 비멤버(서연)·멤버(철수) 모두 읽을 수 있다 → NOT_LEADER / NOT_MEMBER
      await runTable(q, "aws", [
        { as: USERS.서연, fn: "room_update", args: [JSON.stringify({ title: "x" })], code: "NOT_LEADER" },
        { as: USERS.서연, fn: "room_applications", code: "NOT_LEADER" },
        { as: USERS.서연, fn: "invite_get", code: "NOT_LEADER" },
        { as: USERS.철수, fn: "room_applications", code: "NOT_LEADER" },
        { as: USERS.서연, fn: "room_leave", code: "NOT_MEMBER" },
      ]);
      // 서연의 DRAFT: 외부인은 참가도, 유효 토큰으로 읽기도 ROOM_NOT_FOUND
      const d = await createRoom(q, USERS.서연, { title: "Oracle Draft" });
      const [{ token }] = await q(`select token from public.room_invites where room_id = $1 and revoked_at is null`, [d.id]);
      await asUser(q, USERS.승호);
      await expectFailSql(q, `select public.room_join($1)`, [d.slug], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_join($1, $2)`, [d.slug, token], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_get($1, $2)`, [d.slug, token], "ROOM_NOT_FOUND");
      await expectFailSql(q, `select public.room_open_recruit($1)`, [d.slug], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "privileges (T5): 8 public RPCs authenticated-only, helpers private, real execution under roles (D7)",
    run: async (q) => {
      const can = async (role: string, fn: string) =>
        (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
      for (const fn of [
        "public.room_join(text,text)", "public.room_apply(text,text,text)", "public.room_leave(text)",
        "public.room_cancel_application(text)", "public.room_approve(text,uuid)", "public.room_reject(text,uuid)",
        "public.room_applications(text)", "public.room_members_get(text)",
      ]) {
        assertEquals(await can("authenticated", fn), true, fn);
        assertEquals(await can("anon", fn), false, fn);
      }
      for (const fn of [
        "public.room_transition_active(bigint,uuid)", "public.room_transition_ended(bigint)",
        "public.membership_result(bigint,uuid)", "public.assignment_resync(bigint)", "public.invite_check(bigint,text)",
        "public.room_join_precheck(public.rooms,uuid,text,text)", "public.room_decide_precheck(public.rooms,uuid,uuid)",
        "public.require_leader(public.rooms,uuid,text)", "public.room_hide_unless_known(public.rooms,uuid,text)",
      ]) {
        assertEquals(await can("authenticated", fn), false, fn);
        assertEquals(await can("anon", fn), false, fn);
      }
      await setToday(q, TODAY);
      await asUser(q, USERS.승호);
      await q("set local role authenticated");
      const [{ res }] = await q(`select public.room_join($1) as res`, ["toeic"]);
      assertEquals(res.me, { state: "active" });
      await asUser(q, USERS.민수);                                           // aws 그룹장 — 역할 전환 전에 uid 교체
      await q("set local role authenticated");
      const [{ apps }] = await q(`select public.room_applications($1) as apps`, ["aws"]);
      assertEquals(Array.isArray(apps.items), true);
      await q("set local role anon");
      await expectFailSql(q, `select public.room_join($1)`, ["toeic"], "permission denied");
      await q("reset role");
    },
  },
  {
    name: "invite_get/rotate: leader only, seed token, rotation revokes old (Review Focus 5)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await expectFailSql(q, `select public.invite_get($1)`, ["docker"], "NOT_LEADER");
      await expectFailSql(q, `select public.invite_rotate($1)`, ["docker"], "NOT_LEADER");
      await asUser(q, USERS.철수);
      const [{ g }] = await q(`select public.invite_get($1) as g`, ["docker"]);
      assertEquals(g, { today: TODAY, token: "seed-docker", url: "/invite/seed-docker" });
      const [{ n }] = await q(`select public.invite_rotate($1) as n`, ["docker"]);
      assertNotEquals(n.token, "seed-docker");
      assertEquals([n.url, n.token.length], [`/invite/${n.token}`, 32]);
      const [{ cnt }] = await q(`select count(*)::int as cnt from public.room_invites where room_id = 4 and revoked_at is null`);
      assertEquals(cnt, 1);
      await asAnon(q);
      await expectFailSql(q, `select public.invite_preview($1)`, ["seed-docker"], "INVITE_REVOKED");
      await expectFailSql(q, `select public.invite_preview($1)`, ["no-such-token"], "INVITE_NOT_FOUND");
      const [{ p }] = await q(`select public.invite_preview($1) as p`, [n.token]);
      assertEquals(p.room.slug, "docker");
      // 토큰이 없던 방(초대 행 삭제)도 invite_get 이 만들어 준다
      await asUser(q, USERS.철수);
      await q(`delete from public.room_invites where room_id = 4`);
      const [{ g2 }] = await q(`select public.invite_get($1) as g2`, ["docker"]);
      assertEquals(g2.token.length, 32);
      await expectFailSql(q, `select public.invite_get($1)`, ["no-such-room"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "invite_preview: anon OK with me null, member state, DRAFT hidden, private room visible via token",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ p }] = await q(`select public.invite_preview($1) as p`, ["seed-toeic"]);
      assertEquals(p.today, TODAY);
      assertEquals(p.me, null);
      assertEquals(p.room, {
        slug: "toeic", title: "토익 900 8주 챌린지", intro: "매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.",
        startDate: "2026-11-02", endDate: "2026-12-27", memberCount: 2, maxMembers: 8, status: "recruit", isPublic: true, joinMode: "direct",
        tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }, { slug: "toeic", label: "토익", tone: "peach", auto: true }],
      });
      assertEquals(p.leader, { userId: USERS.서연, nickname: "서연", tone: "blue" });
      await asUser(q, USERS.철수);
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-toeic"]))[0].p.me, { state: "none" });
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-sqld"]))[0].p.me, { state: "pending" });
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-docker"]))[0].p.me, { state: "leader" });
      // 비공개 spring 도 토큰으로 미리보기 가능(비멤버·비로그인)
      await asAnon(q);
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-spring"]))[0].p.room.isPublic, false);
      // DRAFT 방은 토큰이 있어도 숨김
      const d = await createRoom(q, USERS.서연);
      const [{ token }] = await q(`select token from public.room_invites where room_id = $1`, [d.id]);
      await asAnon(q);
      await expectFailSql(q, `select public.invite_preview($1)`, [token], "INVITE_NOT_FOUND");
      // 보관된 방도 숨김
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      await asAnon(q);
      await expectFailSql(q, `select public.invite_preview($1)`, ["seed-aws"], "INVITE_NOT_FOUND");
    },
  },
  {
    name: "invite_join: join_mode-aware, private bypass, owner/anon/revoked errors",
    run: async (q) => {
      await setToday(q, TODAY);
      const direct = await openRoom(q, USERS.서연, { isPublic: false, title: "Private Direct" });
      const appr = await openRoom(q, USERS.서연, { isPublic: false, joinMode: "approval", title: "Private Approval" });
      const tok = async (id: string) => (await q(`select token from public.room_invites where room_id = $1 and revoked_at is null`, [id]))[0].token as string;
      const td = await tok(direct.id), ta = await tok(appr.id);
      await asAnon(q);
      await expectFailSql(q, `select public.invite_join($1)`, [td], "AUTH_REQUIRED");
      await asUser(q, USERS.서연);
      await expectFailSql(q, `select public.invite_join($1)`, [td], "OWNER_CANNOT_JOIN");
      await asUser(q, USERS.민수);
      const [{ a }] = await q(`select public.invite_join($1) as a`, [td]);
      assertEquals([a.me, a.memberCount], [{ state: "active" }, 2]);
      const [{ b }] = await q(`select public.invite_join($1) as b`, [ta]);
      assertEquals([b.me, b.memberCount], [{ state: "pending" }, 1]);
      await expectFailSql(q, `select public.invite_join($1)`, [ta], "ALREADY_PENDING");
      await expectFailSql(q, `select public.invite_join($1)`, [td], "ALREADY_MEMBER");
      // 회전 뒤 옛 토큰
      await asUser(q, USERS.서연);
      await q(`select public.invite_rotate($1)`, [direct.slug]);
      await asUser(q, USERS.현우);
      await expectFailSql(q, `select public.invite_join($1)`, [td], "INVITE_REVOKED");
      await expectFailSql(q, `select public.invite_join($1)`, ["no-such-token"], "INVITE_NOT_FOUND");
      const [{ c }] = await q(`select public.invite_join($1) as c`, [await tok(direct.id)]);
      assertEquals(c.me, { state: "active" });
      // 공개 승인제(jcg, 4/4) 는 토큰으로 와도 ROOM_FULL
      await expectFailSql(q, `select public.invite_join($1)`, ["seed-jcg"], "ROOM_FULL");
    },
  },
  {
    name: "privileges (T6): invite_preview public, get/rotate/join authenticated-only, helpers private (D7)",
    run: async (q) => {
      const can = async (role: string, fn: string) =>
        (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
      assertEquals(await can("anon", "public.invite_preview(text)"), true);
      assertEquals(await can("authenticated", "public.invite_preview(text)"), true);
      for (const fn of ["public.invite_get(text)", "public.invite_rotate(text)", "public.invite_join(text,text)"]) {
        assertEquals(await can("authenticated", fn), true, fn);
        assertEquals(await can("anon", fn), false, fn);
      }
      for (const fn of ["public.invite_resolve(text)", "public.invite_check(bigint,text)", "public.invite_ensure(bigint,uuid)"]) {
        assertEquals(await can("authenticated", fn), false, fn);
        assertEquals(await can("anon", fn), false, fn);
      }
      await setToday(q, TODAY);
      await asAnon(q);
      await q("set local role anon");
      const [{ p }] = await q(`select public.invite_preview($1) as p`, ["seed-toeic"]);
      assertEquals(p.room.slug, "toeic");
      await expectFailSql(q, `select public.invite_join($1)`, ["seed-toeic"], "permission denied");
      await q("reset role");
      await asUser(q, USERS.철수);
      await q("set local role authenticated");
      const [{ g }] = await q(`select public.invite_get($1) as g`, ["docker"]);
      assertEquals(g.token, "seed-docker");
      const [{ n }] = await q(`select public.invite_rotate($1) as n`, ["docker"]);
      assertEquals(n.token.length, 32);
      await q("reset role");
      await asUser(q, USERS.현우);                                           // toeic 비멤버
      await q("set local role authenticated");
      const [{ j }] = await q(`select public.invite_join($1) as j`, ["seed-toeic"]);
      assertEquals(j.me, { state: "active" });
      await q("reset role");
    },
  },
];
