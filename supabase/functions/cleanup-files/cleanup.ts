import type { SupabaseClient } from "supabase-js";
import { chunk, CHUNK, type FileRow, groupByBucket, type RemoveResult, splitRemoval, type Summary } from "./logic.ts";

export type { Summary };

/** DB·Storage 접근 — 테스트는 가짜로, 실행은 service_role 클라이언트(supabaseStore)로 */
export interface Store {
  /** 정리 후보(유예 지난 DELETED, 오래된 순) limit 개 — DB 의 file_purge_candidates. 실패는 throw */
  selectDeleted(limit: number): Promise<FileRow[]>;
  removeObjects(bucket: string, paths: string[]): Promise<RemoveResult>;
  /** 아직 DELETED 인 행만 지운다(그 사이 READY 가 된 행은 남는다). 지운 수. 실패는 throw */
  deleteRows(ids: string[]): Promise<number>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function tryRemove(store: Store, bucket: string, rows: FileRow[]): Promise<RemoveResult> {
  try {
    return await store.removeObjects(bucket, rows.map((r) => r.object_path));
  } catch (e) {
    return { data: null, error: { message: msg(e) } };
  }
}

export async function runCleanup(store: Store, opts: { limit: number }): Promise<Summary> {
  const rows = await store.selectDeleted(opts.limit);
  const ok: string[] = [];
  let failed = 0;
  const errors: string[] = [];
  for (const [bucket, list] of groupByBucket(rows)) {
    for (const part of chunk(list, CHUNK)) {
      const res = await tryRemove(store, bucket, part);
      // 묶음이 실패하면 1개씩 다시 — 영구 오류 하나가 같은 묶음의 정상 행까지 매번 붙잡지 않게(1개짜리는 그 결과 그대로)
      const tries: [FileRow[], RemoveResult][] = [];
      if (res.error && part.length > 1) {
        for (const one of part) tries.push([[one], await tryRemove(store, bucket, [one])]);   // 순서대로(동시 100개 호출 피함)
      } else {
        tries.push([part, res]);
      }
      for (const [list, r] of tries) {
        const s = splitRemoval(list, r);
        ok.push(...s.ok);
        failed += s.failed.length;
        if (r.error) errors.push(`remove ${bucket} ${list.map((x) => x.object_path).join(",")}: ${r.error.message}`);
      }
    }
  }
  let rowsDeleted = 0;
  for (const ids of chunk(ok, CHUNK)) {
    try {
      rowsDeleted += await store.deleteRows(ids);
    } catch (e) {
      errors.push(`delete rows: ${msg(e)}`);
    }
  }
  return { selected: rows.length, removed: ok.length, rowsDeleted, failed, errors };
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async selectDeleted(limit) {
      const { data, error } = await db.rpc("file_purge_candidates", { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as FileRow[];
    },
    async removeObjects(bucket, paths) {
      const { data, error } = await db.storage.from(bucket).remove(paths);
      return { data, error: error ? { message: error.message } : null };
    },
    async deleteRows(ids) {
      const { count, error } = await db.from("files").delete({ count: "exact" }).in("id", ids).eq("status", "DELETED");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}
