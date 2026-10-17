import type { SupabaseClient } from "supabase-js";
import { chunk, CHUNK, cutoffIso, type FileRow, groupByBucket, type RemoveResult, splitRemoval } from "./logic.ts";

/** DB·Storage 접근 — 테스트는 가짜로, 실행은 service_role 클라이언트(supabaseStore)로 */
export interface Store {
  /** status = DELETED ∧ deleted_at < cutoff 를 오래된 순으로 limit 개. 실패는 throw */
  selectDeleted(cutoff: string, limit: number): Promise<FileRow[]>;
  removeObjects(bucket: string, paths: string[]): Promise<RemoveResult>;
  /** 아직 DELETED 인 행만 지운다(그 사이 재등록으로 READY 가 된 행은 남는다). 지운 수. 실패는 throw */
  deleteRows(ids: string[]): Promise<number>;
}

export type Summary = { selected: number; removed: number; rowsDeleted: number; failed: number; errors: string[] };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runCleanup(store: Store, opts: { now: Date; limit: number }): Promise<Summary> {
  const rows = await store.selectDeleted(cutoffIso(opts.now), opts.limit);
  const ok: string[] = [];
  let failed = 0;
  const errors: string[] = [];
  for (const [bucket, list] of groupByBucket(rows)) {
    for (const part of chunk(list, CHUNK)) {
      let res: RemoveResult;
      try {
        res = await store.removeObjects(bucket, part.map((r) => r.object_path));
      } catch (e) {
        res = { data: null, error: { message: msg(e) } };
      }
      const s = splitRemoval(part, res);
      ok.push(...s.ok);
      failed += s.failed.length;
      if (res.error) errors.push(`remove ${bucket}: ${res.error.message}`);
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
    async selectDeleted(cutoff, limit) {
      const { data, error } = await db.from("files").select("id, bucket_id, object_path")
        .eq("status", "DELETED").lt("deleted_at", cutoff)
        .order("deleted_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
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
