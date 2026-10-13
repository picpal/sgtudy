// supabase/tests/_fixtures.ts — plan 04 테스트 공용 헬퍼. 부팅·격리·권한 흉내는 전부 plan 01 _harness.ts 의 것을 쓴다(재정의 금지).
import type { PGlite } from "pglite";
import { setToday, sqlTest, withCase } from "./_harness.ts";
import { roomId as roomIdOf, TODAY as SEED_TODAY, uid } from "./_curriculum-helpers.ts";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
/** _harness.ts 의 Q 와 같은 함수 — 반환 원소만 any 로 넓혀 단언을 짧게 쓴다 */
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type Case = { name: string; run: (q: Q) => Promise<void> };

export const TODAY = SEED_TODAY;
export const uidOf = uid;
export const roomId = roomIdOf;

export const one = async (q: Q, sql: string, p: unknown[] = []): Promise<Row> => (await q(sql, p))[0];
export const setNow = async (q: Q, iso: string) => { await q("select set_config('app.now', $1, true)", [iso]); };
export const nodeId = async (q: Q, slug: string, title: string): Promise<string> => {
  const r = await q(`select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id
                     where r.slug = $1 and n.title = $2 order by n.id`, [slug, title]);
  if (r.length !== 1) throw new Error(`node "${title}" in ${slug}: ${r.length} rows`);
  return r[0].id as string;
};
export const uuids = (xs: string[]) => "{" + xs.join(",") + "}";

/** 사례 묶음 → sqlTest(`${group}: ${name}`, withCase(...)). 각 사례는 시드 기준일로 시작한다 */
export function cases(group: string, db: PGlite, list: Case[]) {
  for (const c of list) {
    sqlTest(`${group}: ${c.name}`, withCase(db, async (q) => {
      await setToday(q, TODAY);
      await c.run(q as Q);
    }));
  }
}
