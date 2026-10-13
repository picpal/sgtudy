import type { Q } from "./_harness.ts";
import { asUser, setToday } from "./_harness.ts";

export const TODAY = "2026-10-12";

/** 시드 사용자 id 를 닉네임으로 찾는다(번호 규칙에 의존하지 않는다) */
export async function uid(q: Q, nickname: string): Promise<string> {
  const r = await q("select id::text as id from public.profiles where nickname = $1", [nickname]);
  if (r.length !== 1) throw new Error(`seed user ${nickname} not found`);
  return r[0].id as string;
}

export async function roomId(q: Q, slug: string): Promise<string> {
  const r = await q("select id::text as id from public.rooms where slug = $1", [slug]);
  if (r.length !== 1) throw new Error(`seed room ${slug} not found`);
  return r[0].id as string;
}

/** 시드와 무관한 DRAFT 방을 leader 가 만든다. 기간 2026-11-01 ~ 2026-11-28, 정원 6, 공개, direct */
export async function mkRoom(q: Q, leaderNick: string, over: Partial<{ s: string; e: string; title: string }> = {}) {
  await setToday(q, TODAY);
  const leader = await uid(q, leaderNick);
  await asUser(q, leader);
  const [row] = await q(
    `select public.room_create($1, $2, $3::date, $4::date, 6, true, 'direct') as d`,
    [over.title ?? "커리큘럼 테스트 Curriculum Test", "소개", over.s ?? "2026-11-01", over.e ?? "2026-11-28"],
  );
  const d = row.d as Record<string, unknown>;
  return { id: d.id as string, slug: d.slug as string, leader };
}

/** 회차(depth 2) 직접 INSERT — node_create 가 생기기 전(Task 1~3) 과 시드 검증용 */
export async function mkRound(q: Q, room: string, label: string, title: string, s: string, e: string): Promise<string> {
  const [{ n }] = await q("select count(*)::int as n from public.goal_nodes where room_id = $1 and parent_id is null", [room]);
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
     values ($1, null, 2, $2, $3, $4, $5::date, $6::date) returning id::text as id`,
    [room, n, label, title, s, e],
  );
  await q("update public.goal_nodes set round_id = id where id = $1", [r.id]);
  return r.id as string;
}

/** 리프 직접 INSERT (부모 depth+1, round_id 상속). type: COMMON|DESIGNATED, null 이면 중간 노드 */
export async function mkLeaf(q: Q, parent: string, title: string, type: "COMMON" | "DESIGNATED" | null, s: string, e: string): Promise<string> {
  const [p] = await q("select room_id::text as room_id, round_id::text as round_id, depth from public.goal_nodes where id = $1", [parent]);
  const [{ n }] = await q("select count(*)::int as n from public.goal_nodes where parent_id = $1", [parent]);
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9) returning id::text as id`,
    [p.room_id, parent, p.round_id, (p.depth as number) + 1, n, title, s, e, type],
  );
  return r.id as string;
}

/** 제출물 직접 INSERT. late=false → end_date 18:00 KST, true → 다음날 09:00 KST */
export async function submit(q: Q, node: string, nick: string, late = false): Promise<void> {
  const u = await uid(q, nick);
  await q(
    `insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
     select $1, $2::uuid, '테스트 제출',
            case when $3 then ((n.end_date + 1)::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
                 else (n.end_date::timestamp + interval '18 hours') at time zone 'Asia/Seoul' end, $3
     from public.goal_nodes n where n.id = $1`,
    [node, u, late],
  );
}

export type Prog = { asg: number; sub: number; pct: number | null };
/** room_progress 를 node_id → {asg, sub, pct} 맵으로 */
export async function progress(q: Q, room: string): Promise<Record<string, Prog>> {
  const rows = await q("select node_id::text as id, asg, sub, pct from public.room_progress($1)", [room]);
  const out: Record<string, Prog> = {};
  for (const r of rows) out[r.id as string] = { asg: r.asg as number, sub: r.sub as number, pct: (r.pct as number | null) ?? null };
  return out;
}

export async function nodeByTitle(q: Q, room: string, title: string): Promise<string> {
  const r = await q("select id::text as id from public.goal_nodes where room_id = $1 and title = $2 order by id", [room, title]);
  if (r.length !== 1) throw new Error(`node "${title}" in room ${room}: ${r.length} rows`);
  return r[0].id as string;
}

export const sortIds = (a: string[]) => [...a].sort((x, y) => Number(x) - Number(y));
