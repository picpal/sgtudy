// supabase/tests/extra-recruit-sql.test.ts — 0032 추가 모집 · 초대 코드(바로 참가) (스펙 2026-10-20-extra-recruit-design)
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";
import { openRoom } from "./_cases-membership.ts";   // 리프 있는 RECRUIT 방 (실제 종료일 단축 사례)
import { USERS } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** 시드 사용자로 행동 */
const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
/** select <expr> as r 의 r */
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const memberRow = async (q: Q, slug: string, uid: string) =>
  await one(q, `select m.status, to_char(m.assign_from, 'YYYY-MM-DD') as assign_from from public.room_members m
                join public.rooms r on r.id = m.room_id where r.slug = $1 and m.user_id = $2::uuid`, [slug, uid]);
/** 배정 행이 있으면 유효 여부, 없으면 null */
const live = async (q: Q, node: string, uid: string) =>
  (await one(q, "select released_at is null as v from public.task_assignments where node_id = $1::bigint and user_id = $2::uuid", [node, uid]))?.v ?? null;
const recruitOpen = async (q: Q, slug: string) =>
  (await one(q, "select public.room_recruit_open(r) as v from public.rooms r where r.slug = $1", [slug])).v as boolean;
const openExtra = (q: Q, slug: string, until: string, max: number | null = null, mode: string | null = null) =>
  rpc(q, "public.room_extra_recruit_open($1, $2::date, $3::int, $4)", [slug, until, max, mode]);
const notes = async (q: Q, nick: string, kind: string, slug: string) =>
  await q(`select n.title, n.body from public.notifications n join public.rooms r on r.id = n.room_id
           where n.user_id = $1::uuid and n.kind = $2 and r.slug = $3 order by n.id`, [await uidOf(q, nick), kind, slug]);
// (Task 1 시점에 아직 안 쓰는 import·헬퍼는 Task 2~4 묶음이 쓴다)

cases("extra recruit 0032 · schema & helpers", db, [
  { name: "invite_code_norm: upper, strip spaces/hyphens, O→0 I/L→1", run: async (q) => {
    const n = async (s: string) => (await one(q, "select public.invite_code_norm($1) as v", [s])).v;
    assertEquals(await n(" k7qm-3xpa "), "K7QM3XPA");
    assertEquals(await n("oIlL"), "0111");
    assertEquals(await n(""), "");
  } },
  { name: "invite_code_new: 8 Crockford chars, unique among 200", run: async (q) => {
    const rows = await q("select public.invite_code_new() as c from generate_series(1, 200)");
    for (const r of rows) assertMatch(r.c as string, CODE_RE);
    assertEquals(new Set(rows.map((r) => r.c)).size, 200);
  } },
  { name: "room_recruit_open: RECRUIT yes · ACTIVE only inside window · archived/ENDED no", run: async (q) => {
    assertEquals(await recruitOpen(q, "toeic"), true);
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-12' where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), true);                 // 오늘까지 포함
    await setToday(q, "2026-10-13");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20', archived_at = now() where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20' where slug = 'algo'");
    assertEquals(await recruitOpen(q, "algo"), false);               // ENDED
    // 실효 마감 = least(recruit_until, end_date) (Codex #3)
    await q("update public.rooms set archived_at = null, recruit_until = '2026-11-30', end_date = '2026-10-14' where slug = 'aws'");
    assertEquals((await one(q, "select to_char(public.room_recruit_until(r), 'YYYY-MM-DD') as v from public.rooms r where slug = 'aws'")).v, "2026-10-14");
    await setToday(q, "2026-10-15");
    assertEquals(await recruitOpen(q, "aws"), false);                // 종료일이 지나면 tick 전에도 닫힘
  } },
  { name: "assignment_resync: assign_from skips COMMON leaves that ended before it; others unchanged", run: async (q) => {
    const aws = await roomId(q, "aws");
    const late = await uidOf(q, "서연");
    const jieun = await uidOf(q, "지은");
    await q("insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from) values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now(), '2026-10-12')", [aws, late]);
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), late), null);      // 10/01~10/03
    assertEquals(await live(q, await nodeId(q, "aws", "VPC 실습"), late), null);           // 10/04~10/07
    assertEquals(await live(q, await nodeId(q, "aws", "ALB vs NLB 실습"), late), true);    // 10/15~
    assertEquals(await live(q, await nodeId(q, "aws", "RDS·Aurora 비교"), late), true);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), jieun), true);     // 기존 멤버 그대로
    // 나중에 만든 지난 날짜 공통 과제도 중간 합류자에겐 안 간다
    const r2 = (await one(q, "select n.id from public.goal_nodes n where n.room_id = $1::bigint and n.label = '2주차'", [aws])).id;
    const past = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                values ($1::bigint, $2, $2, 3, 99, '지난 공통', '2026-10-08', '2026-10-11', 'COMMON') returning id::text as id`, [aws, r2])).id;
    const today = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                 values ($1::bigint, $2, $2, 3, 100, '오늘 마감', '2026-10-08', '2026-10-12', 'COMMON') returning id::text as id`, [aws, r2])).id;
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, past, late), null);
    assertEquals(await live(q, past, jieun), true);
    assertEquals(await live(q, today, late), true);                  // 마감 = 합류일 → 배정
  } },
  { name: "invite_code_failures: closed to clients", run: async (q) => {
    const p = async (role: string, priv: string) => (await one(q, "select has_table_privilege($1, 'public.invite_code_failures', $2) as v", [role, priv])).v;
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert"]) assertEquals(await p(role, priv), false, `${role} ${priv}`);
  } },
]);

// ───────── Task 2: 추가 모집 창 · 관문 · 승인 · tick · MEMBER_JOINED ─────────
// (room_detail_json/room_get 의 `recruit` 키는 Task 4 — 여기선 rooms 열·RPC 반환의 다른 필드로 창 상태를 본다)
const until = async (q: Q, slug: string) =>
  (await one(q, "select to_char(recruit_until, 'YYYY-MM-DD') as v from public.rooms where slug = $1", [slug])).v as string | null;
const effUntil = async (q: Q, slug: string) =>
  (await one(q, "select to_char(public.room_recruit_until(r), 'YYYY-MM-DD') as v from public.rooms r where r.slug = $1", [slug])).v as string | null;

cases("extra recruit 0032 · window", db, [
  { name: "open: leader·ACTIVE only; until today..min(end, today+30); needs a free seat; sets max & joinMode atomically", run: async (q) => {
    await as(q, "지은");
    await expectFail(openExtra(q, "aws", "2026-10-19"), "NOT_LEADER");
    await as(q, "민수");
    await expectFail(openExtra(q, "aws", "2026-10-11"), "INVALID_PERIOD");
    await expectFail(openExtra(q, "aws", "2026-11-12"), "INVALID_PERIOD");          // 오늘+31
    await expectFail(openExtra(q, "aws", "2026-10-19", 4), "CAPACITY_NO_SEAT");     // 4/4
    await expectFail(openExtra(q, "aws", "2026-10-19", 101), "VALIDATION_FAILED");
    await expectFail(openExtra(q, "aws", "2026-10-19", null, "free"), "VALIDATION_FAILED");
    await q("update public.rooms set min_members = 6 where slug = 'aws'");          // 최소 6 > 새 정원 5 > 참가 4
    await expectFail(openExtra(q, "aws", "2026-10-19", 5), "VALIDATION_FAILED");     // 원시 ck_rooms_members 오류가 아니라 fail (Codex #6)
    await q("update public.rooms set min_members = 3 where slug = 'aws'");
    assertEquals(await until(q, "aws"), null);                                       // 실패한 시도는 아무것도 남기지 않는다
    const d = await openExtra(q, "aws", "2026-11-11", 7, "direct");                  // 경계 = 오늘+30
    assertEquals([d.maxMembers, d.joinMode, d.status], [7, "direct", "active"]);
    assertEquals(await until(q, "aws"), "2026-11-11");
    assertEquals(await recruitOpen(q, "aws"), true);
    await as(q, "서연");
    await expectFail(openExtra(q, "toeic", "2026-10-19"), "ROOM_STATUS_INVALID");    // RECRUIT
    await as(q, "현우");
    await expectFail(openExtra(q, "algo", "2026-10-19"), "ROOM_STATUS_INVALID");     // ENDED
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    await as(q, "민수");
    await expectFail(openExtra(q, "aws", "2026-10-19"), "ROOM_STATUS_INVALID");
  } },
  { name: "open: INVALID_PERIOD maxDate is min(end_date, today+30)", run: async (q) => {
    await as(q, "민수");
    const end = (await one(q, "select to_char(end_date, 'YYYY-MM-DD') as v from public.rooms where slug = 'aws'")).v as string;
    const hint = async (u: string, max: number | null = null) =>
      JSON.parse((await openExtra(q, "aws", u, max).then(() => null, (e) => e as Error & { hint?: string }))!.hint!);
    assertEquals(await hint("2027-12-31"), { field: "recruitUntil", maxDate: end < "2026-11-11" ? end : "2026-11-11" });
    await q("update public.rooms set end_date = '2026-10-31' where slug = 'aws'");
    assertEquals(await hint("2026-11-01"), { field: "recruitUntil", maxDate: "2026-10-31" });
    assertEquals(await hint("2026-10-19", 4), { field: "maxMembers", memberCount: 4 });
  } },
  { name: "approval window: closed → ROOM_NOT_RECRUITING; open → apply·approve; late joiner gets only future COMMON", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "서연");
    await expectFail(rpc(q, "public.room_apply('aws')"), "ROOM_NOT_RECRUITING");
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-19");
    const reqBefore = (await notes(q, "민수", "JOIN_REQUESTED", "aws")).length;
    await as(q, "서연");
    assertEquals((await rpc(q, "public.room_apply('aws', null)")).me.state, "pending");
    assertEquals((await notes(q, "민수", "JOIN_REQUESTED", "aws")).length, reqBefore + 1);
    await as(q, "민수");
    const r = await rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]);
    assertEquals(r.memberCount, 5);
    assertEquals(await memberRow(q, "aws", seoyeon), { status: "ACTIVE", assign_from: "2026-10-12" });
    assertEquals(await live(q, await nodeId(q, "aws", "VPC 실습"), seoyeon), null);
    assertEquals(await live(q, await nodeId(q, "aws", "ALB vs NLB 실습"), seoyeon), true);
    assertEquals((await notes(q, "민수", "MEMBER_JOINED", "aws")).length, 0);       // 승인은 그룹장이 한 일 — 알림 없음
  } },
  { name: "direct window: room_join works; MEMBER_JOINED to leader (via extra); RECRUIT direct join stays silent", run: async (q) => {
    await as(q, "태호");
    await openExtra(q, "react", "2026-10-20");
    await as(q, "서연");
    assertEquals((await rpc(q, "public.room_join('react')")).me.state, "active");
    assertEquals((await memberRow(q, "react", await uidOf(q, "서연"))).assign_from, "2026-10-12");
    const n = await notes(q, "태호", "MEMBER_JOINED", "react");
    assertEquals(n.length, 1);
    assertEquals(n[0].title, "서연님이 리액트 공식문서 함께 읽기에 합류했어요");
    assertEquals(n[0].body, "추가 모집으로 참가했어요 · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요");
    // 초대 경로(Task 3)의 본문 갈래
    const inv = await one(q, "select public.notify_render('MEMBER_JOINED', $1::bigint, null, $2::uuid, '{\"via\":\"invite\"}'::jsonb) as v",
      [await roomId(q, "react"), await uidOf(q, "서연")]);
    assert((inv.v.body as string).startsWith("초대로 바로 참가했어요"));
    await as(q, "예린");
    await rpc(q, "public.room_join('toeic')");
    assertEquals((await notes(q, "서연", "MEMBER_JOINED", "toeic")).length, 0);
    assertEquals((await memberRow(q, "toeic", await uidOf(q, "예린"))).assign_from, null);
  } },
  { name: "close: expires PENDING with JOIN_EXPIRED; decisions blocked after; close twice → ROOM_STATUS_INVALID; re-expiry in a later tx notifies again", run: async (q) => {
    const [seoyeon, gaeun] = [await uidOf(q, "서연"), await uidOf(q, "가은")];
    const aws = await roomId(q, "aws");
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수");
    const d = await rpc(q, "public.room_extra_recruit_close('aws')");
    assertEquals(d.pendingCount, 0);
    assertEquals(await until(q, "aws"), null);
    for (const u of [seoyeon, gaeun]) assertEquals((await memberRow(q, "aws", u)).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ROOM_NOT_RECRUITING");
    await expectFail(rpc(q, "public.room_extra_recruit_close('aws')"), "ROOM_STATUS_INVALID");
    const key = (await one(q, "select n.dedupe_key from public.notifications n where n.kind = 'JOIN_EXPIRED' and n.user_id = $1::uuid", [seoyeon])).dedupe_key as string;
    const txid = (await one(q, "select txid_current()::text as v")).v as string;
    assertEquals(key, `JOIN_EXPIRED:${aws}:extra:${txid}:${seoyeon}`);
    // 같은 트랜잭션에서 다시 만료되면 같은 키 → 중복 없음
    await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수"); await rpc(q, "public.room_extra_recruit_close('aws')");
    assertEquals((await memberRow(q, "aws", seoyeon)).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
    // 앞의 알림이 이전 트랜잭션 것이었다면(키의 txid 가 다름) 다시 만료됐을 때 새 알림이 간다.
    // 방 시작 때 만료 키(JOIN_EXPIRED:{room}:{user})도 막지 않는다
    await q("update public.notifications set dedupe_key = $1 where dedupe_key = $2", [`JOIN_EXPIRED:${aws}:extra:1:${seoyeon}`, key]);
    await q(`insert into public.notifications (user_id, kind, title, room_id, link, dedupe_key) values ($1::uuid, 'JOIN_EXPIRED', '시작 만료', $2::bigint, '/rooms/aws', $3)`,
      [seoyeon, aws, `JOIN_EXPIRED:${aws}:${seoyeon}`]);
    await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수"); await rpc(q, "public.room_extra_recruit_close('aws')");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 3);
  } },
  { name: "tick: closes past windows; return shape unchanged", run: async (q) => {
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-13");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await setToday(q, "2026-10-13");
    assertEquals((await one(q, "select public.room_tick() as r")).r, { activated: 0, ended: 0 });
    assertEquals(await recruitOpen(q, "aws"), true);                                 // 마감일 당일은 열림
    assertEquals((await memberRow(q, "aws", await uidOf(q, "서연"))).status, "PENDING");
    await setToday(q, "2026-10-14");
    assertEquals((await one(q, "select public.room_tick() as r")).r, { activated: 0, ended: 0 });
    assertEquals(await until(q, "aws"), null);
    assertEquals((await memberRow(q, "aws", await uidOf(q, "서연"))).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
  } },
  { name: "tick: archived room's window is left alone until unarchived", run: async (q) => {
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-13");
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    await setToday(q, "2026-10-14");
    await q("select public.room_tick()");
    assertEquals(await until(q, "aws"), "2026-10-13");
    await q("update public.rooms set archived_at = null where slug = 'aws'");
    await q("select public.room_tick()");
    assertEquals(await until(q, "aws"), null);
  } },
  { name: "reopen after lapse without tick: old PENDING expires first; extending a live window keeps PENDING (Codex #2)", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-13");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await setToday(q, "2026-10-15");                                                   // tick 없음
    await as(q, "민수");
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ROOM_NOT_RECRUITING");   // 지난 창은 승인 불가
    const d = await openExtra(q, "aws", "2026-10-20");
    assertEquals(d.pendingCount, 0);
    assertEquals(await until(q, "aws"), "2026-10-20");
    assertEquals((await memberRow(q, "aws", seoyeon)).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ALREADY_DECIDED");
    const gaeun = await uidOf(q, "가은");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-25");                    // 열린 창 연장 → 대기 유지
    assertEquals((await memberRow(q, "aws", gaeun)).status, "PENDING");
    assertEquals(await until(q, "aws"), "2026-10-25");
  } },
  { name: "auto_expire re-checks fresh state: a window extended after the tick picked it is left alone (Codex #1)", run: async (q) => {
    const aws = await roomId(q, "aws");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-13");
    await setToday(q, "2026-10-14");
    // tick 이 후보로 고른 뒤(옛 상태) 그룹장이 먼저 다시 열었다고 가정 — 실제 두 연결 경쟁은 Task 9
    await openExtra(q, "aws", "2026-10-20");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    assertEquals((await one(q, "select public.room_extra_recruit_auto_expire($1::bigint) as v", [aws])).v, false);
    assertEquals(await until(q, "aws"), "2026-10-20");
    assertEquals((await memberRow(q, "aws", await uidOf(q, "가은"))).status, "PENDING");
    await setToday(q, "2026-10-21");
    assertEquals((await one(q, "select public.room_extra_recruit_auto_expire($1::bigint) as v", [aws])).v, true);
    assertEquals(await until(q, "aws"), null);
    assertEquals((await memberRow(q, "aws", await uidOf(q, "가은"))).status, "EXPIRED");
  } },
  { name: "tick re-checks each candidate after locking; counts only real transitions (Codex 2-2)", run: async (q) => {
    // PGlite 는 단일 연결 — 실제 경쟁은 Task 9. 여기선 트리거로 '후보 선택 뒤·잠금 전 변경'을 흉내 낸다:
    // 첫 후보가 전이되는 순간 둘째 후보의 날짜를 바꾼다 → 재판정이 없으면 둘째도 전이·집계된다
    const a = await openRoom(q, USERS.서연, { maxMembers: 4 });
    const b = await openRoom(q, USERS.서연, { maxMembers: 4, title: "둘째 방 Second" });
    const c = await openRoom(q, USERS.서연, { maxMembers: 4, title: "셋째 방 Third" });
    const d = await openRoom(q, USERS.서연, { maxMembers: 4, title: "넷째 방 Fourth" });
    await q(`create function public.t_shift() returns trigger language plpgsql as $f$
      begin
        if old.status = 'RECRUIT' and new.status = 'ACTIVE' and new.id = ${a.id} then
          update public.rooms set start_date = '2026-11-20' where id = ${b.id};
        elsif old.status = 'ACTIVE' and new.status = 'ENDED' and new.id = ${c.id} then
          update public.rooms set end_date = '2026-12-31' where id = ${d.id};
        end if;
        return null;
      end $f$`);
    await q("create trigger t_shift after update on public.rooms for each row execute function public.t_shift()");
    // 활성화: a·b 둘 다 후보(시작 11/01 ≤ 11/02) → a 전이 중 b 시작일이 11/20 으로
    await setToday(q, "2026-11-02");
    const recruitBefore = (await one(q, "select count(*)::int as n from public.rooms where status = 'RECRUIT' and archived_at is null and start_date <= '2026-11-02'")).n;
    const t1 = (await one(q, "select public.room_tick() as r")).r;
    assertEquals(t1.activated, recruitBefore - 1);
    assertEquals((await one(q, "select status from public.rooms where id = $1", [b.id])).status, "RECRUIT");
    // 종료: c·d 를 ACTIVE 로, 종료일 11/08 → 11/09 에 둘 다 후보 → c 종료 중 d 종료일이 12/31 로
    await q("update public.rooms set start_date = '2026-11-01' where id = $1", [b.id]);
    await setToday(q, "2026-11-09");
    await q("select public.room_tick()");        // b 활성화 등 앞선 후보 정리(c·d 는 아직 종료일 11/28)
    await q("update public.rooms set end_date = '2026-11-08' where id in ($1, $2)", [c.id, d.id]);
    const activeBefore = (await one(q, "select count(*)::int as n from public.rooms where status = 'ACTIVE' and archived_at is null and end_date < '2026-11-09'")).n;
    const t2 = (await one(q, "select public.room_tick() as r")).r;
    assertEquals(t2.ended, activeBefore - 1);
    assertEquals((await one(q, "select status from public.rooms where id = $1", [c.id])).status, "ENDED");
    assertEquals((await one(q, "select status from public.rooms where id = $1", [d.id])).status, "ACTIVE");
  } },
  { name: "real end-date shortening: window capped by end_date; the ending tick expires PENDING in the same run (Codex #3)", run: async (q) => {
    const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 4 });   // 리프 11/01~11/07, 종료 11/28
    await q("select public.room_start($1)", [r.slug]);                                    // 10/12 → ACTIVE
    await openExtra(q, r.slug, "2026-11-11");
    await asUser(q, USERS.민수); await rpc(q, "public.room_apply($1)", [r.slug]);
    await asUser(q, USERS.서연);
    await rpc(q, "public.room_update($1, $2::jsonb)", [r.slug, JSON.stringify({ endDate: "2026-11-08" })]);   // 실제 단축(마지막 과제 11/07 이후)
    assertEquals(await until(q, r.slug), "2026-11-11");                                   // 저장값은 그대로
    assertEquals(await effUntil(q, r.slug), "2026-11-08");                                // 실효 마감은 종료일로 잘림
    await setToday(q, "2026-11-09");
    assertEquals(await recruitOpen(q, r.slug), false);                                    // tick 전에도 닫힘
    await asUser(q, USERS.현우);
    await expectFail(rpc(q, "public.room_apply($1)", [r.slug]), "ROOM_NOT_RECRUITING");
    await q("select public.room_tick()");                                                 // 한 번의 tick 으로 종료 + 대기 만료
    const row = await one(q, "select status, recruit_until from public.rooms where slug = $1", [r.slug]);
    assertEquals([row.status, row.recruit_until], ["ENDED", null]);
    assertEquals((await memberRow(q, r.slug, USERS.민수)).status, "EXPIRED");
  } },
  { name: "kinds & grants", run: async (q) => {
    assert((await one(q, "select 'MEMBER_JOINED' = any(public.notification_kinds()) as v")).v);
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    assertEquals(await can("authenticated", "public.room_extra_recruit_open(text, date, integer, text)"), true);
    assertEquals(await can("authenticated", "public.room_extra_recruit_close(text)"), true);
    assertEquals(await can("anon", "public.room_extra_recruit_open(text, date, integer, text)"), false);
    for (const f of ["public.room_member_activate(public.rooms, uuid, text)", "public.room_extra_recruit_expire(bigint, uuid)", "public.room_extra_recruit_auto_expire(bigint)", "public.room_recruit_open(public.rooms)", "public.room_recruit_until(public.rooms)", "public.invite_code_new()"]) {
      assertEquals(await can("authenticated", f), false, f);
    }
  } },
]);

const bypassSet = (q: Q, slug: string, until: string | null, max: number | null = null) =>
  rpc(q, "public.invite_bypass_set($1, $2::date, $3::int)", [slug, until, max]);

cases("extra recruit 0032 · invite", db, [
  { name: "invite_get fills code lazily for seed rows; bypass_set; rotate → new token+code, bypass off", run: async (q) => {
    await as(q, "민수");
    const g = await rpc(q, "public.invite_get('aws')");
    assertEquals([g.token, g.url, g.bypass], ["seed-aws", "/invite/seed-aws", null]);
    assertMatch(g.code, CODE_RE);
    assertEquals((await rpc(q, "public.invite_get('aws')")).code, g.code);          // 한 번 정하면 그대로
    const b = await bypassSet(q, "aws", "2026-10-19", 2);
    assertEquals(b.bypass, { until: "2026-10-19", max: 2, used: 0, active: true });
    const n = await rpc(q, "public.invite_rotate('aws')");
    assertNotEquals(n.token, "seed-aws");
    assertNotEquals(n.code, g.code);
    assertEquals(n.bypass, null);
    assertEquals((await bypassSet(q, "aws", null)).bypass, null);                   // 끄기
  } },
  { name: "bypass_set validation", run: async (q) => {
    await as(q, "지은");
    await expectFail(bypassSet(q, "aws", "2026-10-19"), "NOT_LEADER");
    await as(q, "현우");
    await expectFail(bypassSet(q, "algo", "2026-10-19"), "ROOM_STATUS_INVALID");    // ENDED
    await as(q, "민수");
    await expectFail(bypassSet(q, "aws", "2026-10-11"), "INVALID_PERIOD");
    await expectFail(bypassSet(q, "aws", "2026-11-12"), "INVALID_PERIOD");           // 오늘+31
    await expectFail(bypassSet(q, "aws", "2026-10-19", 0), "VALIDATION_FAILED");
    await as(q, "수민");
    await expectFail(bypassSet(q, "jcg", "2026-11-05"), "INVALID_PERIOD");           // jcg 종료 11/01 넘김
    assertEquals((await bypassSet(q, "jcg", "2026-10-19")).bypass.active, true);    // 모집중 방에서도 켤 수 있다
    // 실효 기한 = least(bypass_until, end_date): 종료일이 당겨지면 기한도 따라 줄어든다 (Codex #3)
    await q("update public.rooms set start_date = '2026-10-12', end_date = '2026-10-15' where slug = 'jcg'");   // ck_rooms_period(시작 ≤ 종료)
    assertEquals((await rpc(q, "public.invite_get('jcg')")).bypass.until, "2026-10-15");
    await setToday(q, "2026-10-16");
    assertEquals((await rpc(q, "public.invite_get('jcg')")).bypass.active, false);
  } },
  { name: "old invites stay closed for ACTIVE rooms (no bypass) — preview join.mode null", run: async (q) => {
    await as(q, "서연");
    const p = await rpc(q, "public.invite_preview('seed-aws')");
    assertEquals(p.join, { mode: null, via: null, until: null });
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
    const t = await rpc(q, "public.invite_preview('seed-toeic')");
    assertEquals(t.join, { mode: "direct", via: "recruit", until: null });
  } },
  { name: "bypass join on closed ACTIVE approval room: direct ACTIVE, assign_from, used+1, MEMBER_JOINED; limit → falls back", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19", 1);
    await as(q, "서연");
    assertEquals((await rpc(q, "public.invite_preview('seed-aws')")).join, { mode: "direct", via: "invite", until: "2026-10-19" });
    const r = await rpc(q, "public.invite_join('seed-aws')");
    assertEquals([r.me.state, r.memberCount], ["active", 5]);
    assertEquals(await memberRow(q, "aws", seoyeon), { status: "ACTIVE", assign_from: "2026-10-12" });
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), seoyeon), null);
    assertEquals((await one(q, "select bypass_used from public.room_invites where token = 'seed-aws'")).bypass_used, 1);
    const n = await notes(q, "민수", "MEMBER_JOINED", "aws");
    assertEquals(n.length, 1);
    assert((n[0].body as string).startsWith("초대로 바로 참가했어요"));
    await as(q, "가은");
    assertEquals((await rpc(q, "public.invite_preview('seed-aws')")).join.mode, null);   // 한도 소진
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
    // 기한 지남
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19", null);
    await setToday(q, "2026-10-20");
    await as(q, "가은");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
  } },
  { name: "bypass edges: INACTIVE, leader, PENDING promoted, full, RECRUIT approval room direct, archived hidden", run: async (q) => {
    const aws = await roomId(q, "aws");
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19");
    await as(q, "도윤");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "MEMBER_NOT_ACTIVE");
    await as(q, "민수");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "OWNER_CANNOT_JOIN");
    const gaeun = await uidOf(q, "가은");
    await q("insert into public.room_members (room_id, user_id, role, status, applied_at) values ($1::bigint, $2::uuid, 'MEMBER', 'PENDING', now())", [aws, gaeun]);
    await as(q, "가은");
    assertEquals((await rpc(q, "public.invite_join('seed-aws')")).me.state, "active");
    // 꽉 찬 비공개 진행중 방
    await as(q, "지훈");
    await bypassSet(q, "spring", "2026-10-19");
    await as(q, "서연");
    await expectFail(rpc(q, "public.invite_join('seed-spring')"), "ROOM_FULL");
    // 모집중 승인제 방에서도 바로 참가 초대면 승인 없이
    await as(q, "가은");
    await bypassSet(q, "sqld", "2026-10-19");
    await as(q, "서연");
    assertEquals((await rpc(q, "public.invite_join('seed-sqld')")).me.state, "active");
    assertEquals((await memberRow(q, "sqld", await uidOf(q, "서연"))).assign_from, null);
    // 보관 방은 초대 자체가 숨겨진다
    await q("update public.rooms set archived_at = now() where id = $1::bigint", [aws]);
    await as(q, "예린");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "INVITE_NOT_FOUND");
  } },
  { name: "invite_code_lookup: normalized hit; misses are recorded & limited (10/h); rotated code still routes; anon blocked", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await as(q, "민수");
    const code = (await rpc(q, "public.invite_get('aws')")).code as string;
    await as(q, "서연");
    const messy = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    assertEquals(await rpc(q, "public.invite_code_lookup($1)", [messy]), { found: true, url: "/invite/seed-aws" });
    const miss = code === "ZZZZZZZZ" ? "YYYYYYYY" : "ZZZZZZZZ";
    for (let i = 9; i >= 0; i--) assertEquals(await rpc(q, "public.invite_code_lookup($1)", [miss]), { found: false, remaining: i });
    await expectFail(rpc(q, "public.invite_code_lookup($1)", [code]), "RATE_LIMITED");   // 맞는 코드도 막힌다
    const fails = async () => (await one(q, "select count(*)::int as n from public.invite_code_failures where user_id = $1::uuid", [await uidOf(q, "서연")])).n;
    assertEquals(await fails(), 10);                                                       // 성공(첫 조회)은 저장 안 함 (Codex #7)
    await setNow(q, "2026-10-12T04:01:00Z");
    assertEquals((await rpc(q, "public.invite_code_lookup('abc')")).found, false);         // 모양이 틀려도 실패로 센다
    // tick 이 1일 지난 실패를 지운다 (요청 사이 커밋 지속성은 Task 9 실 DB 에서)
    await setNow(q, "2026-10-13T05:00:00Z");
    await q("select public.room_tick()");
    assertEquals(await fails(), 0);
    // 회전된 코드 → 옛 링크로 보낸다(랜딩이 INVITE_REVOKED 를 보여 줌), 실패로 세지 않음
    await as(q, "민수");
    await rpc(q, "public.invite_rotate('aws')");
    await as(q, "예린");
    assertEquals(await rpc(q, "public.invite_code_lookup($1)", [code]), { found: true, url: "/invite/seed-aws" });
    await expectFail(rpc(q, "public.invite_preview('seed-aws')"), "INVITE_REVOKED");
    await asAnon(q);
    await expectFail(rpc(q, "public.invite_code_lookup($1)", [code]), "AUTH_REQUIRED");
  } },
  { name: "invite grants", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    assertEquals(await can("authenticated", "public.invite_bypass_set(text, date, integer)"), true);
    assertEquals(await can("authenticated", "public.invite_code_lookup(text)"), true);
    assertEquals(await can("anon", "public.invite_code_lookup(text)"), false);
    assertEquals(await can("anon", "public.invite_preview(text)"), true);                   // 기존 그대로
    for (const f of ["public.room_join_by_invite(text, text)", "public.invite_json(public.room_invites, public.rooms)", "public.invite_bypass_ok(public.room_invites, public.rooms)"]) {
      assertEquals(await can("authenticated", f), false, f);
    }
  } },
]);
