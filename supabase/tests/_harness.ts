import { PGlite } from "pglite";
import { citext } from "pglite/contrib/citext";
import { pg_trgm } from "pglite/contrib/pg_trgm";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
const SEED_FILE = new URL("../seed.sql", import.meta.url);

// pg_cron 은 PGlite 에 없다. 0010 의 확장 문장은 개요가 고정한 한 형태
// `create extension if not exists pg_cron;`(한 줄, with schema 없음)만 허용하고 그 줄만 걷어낸다.
// cron.schedule / cron.unschedule 은 스텁이 받는다. 다른 형태가 들어오면 PGlite 가 "extension not available" 로 실패 → 형태를 고칠 것.
export const PG_CRON_LINE = /^\s*create extension if not exists pg_cron\s*;\s*$/gim;
function stripUnsupported(sql: string): string {
  return sql.replace(PG_CRON_LINE, "");
}

export async function migrationFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) if (e.isFile && e.name.endsWith(".sql")) names.push(e.name);
  return names.sort();
}

/** 스텁 + supabase/migrations/*.sql 을 번호순으로 적용한 PGlite */
export async function openDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { citext, pg_trgm } });
  await db.exec(PGLITE_STUBS);
  for (const name of await migrationFiles()) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    try { await db.exec(stripUnsupported(sql)); }
    catch (e) { throw new Error(`migration ${name}: ${(e as Error).message}`); }
  }
  return db;
}

export async function applySeed(db: PGlite): Promise<void> {
  await db.exec(await Deno.readTextFile(SEED_FILE));
}

export function makeQ(db: PGlite): Q {
  return async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
}

/**
 * 사례 안의 Q: 문장마다 savepoint 로 감싼다. 실패한 문장(expectFail 로 기대한 에러)만 되감고
 * 트랜잭션은 살아 있게 한다 — 없으면 첫 에러 뒤 모든 문장이 25P02(current transaction is aborted) 로 실패한다.
 */
function caseQ(db: PGlite): Q {
  const plain = makeQ(db);
  return async (sql, params = []) => {
    await db.exec("savepoint case_stmt");
    try {
      const rows = await plain(sql, params);
      await db.exec("release savepoint case_stmt");
      return rows;
    } catch (e) {
      await db.exec("rollback to savepoint case_stmt");
      throw e;
    }
  };
}

/** 사례마다 begin … rollback. set_config(…, true) 도 함께 되돌아간다 */
export function withCase(db: PGlite, fn: (q: Q) => Promise<void>): () => Promise<void> {
  return async () => {
    await db.exec("begin");
    try { await fn(caseQ(db)); } finally { await db.exec("rollback"); }
  };
}

export const asUser = async (q: Q, uid: string) => { await q("select set_config('app.uid', $1, true)", [uid]); };
export const asAnon = async (q: Q) => { await q("select set_config('app.uid', '', true)"); };
export const setToday = async (q: Q, ymd: string) => { await q("select set_config('app.today', $1, true)", [ymd]); };

/** auth.users 에 한 명 넣고(→ profiles 트리거) id 를 돌려준다 */
export async function newUser(q: Q, email = `${crypto.randomUUID().slice(0, 8)}@example.com`): Promise<string> {
  const id = crypto.randomUUID();
  await q("insert into auth.users (id, email, email_confirmed_at) values ($1::uuid, $2, now())", [id, email]);
  return id;
}

/** public.fail() 이 던진 코드 확인 — 메시지(MESSAGE=<CODE>)에 코드가 들어 있어야 한다 */
export async function expectFail(p: Promise<unknown>, code: string): Promise<void> {
  try { await p; }
  catch (e) {
    const msg = (e as Error).message;
    if (msg.includes(code)) return;
    throw new Error(`expected ${code}, got: ${msg}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

export function sqlTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeResources: false, sanitizeOps: false });
}
