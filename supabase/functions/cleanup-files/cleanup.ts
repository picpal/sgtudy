import type { SupabaseClient } from "supabase-js";
import {
  chunk, CHUNK, type FileRow, groupByBucket, type ObjectRow, type OrphanSummary, type RemoveResult, type Report, splitRemoval,
  type Summary,
} from "./logic.ts";

export type { OrphanSummary, Report, Summary };

/** DB·Storage 접근 — 테스트는 가짜로, 실행은 service_role 클라이언트(supabaseStore)로 */
export interface Store {
  /** 정리 후보(유예 지난 DELETED, 오래된 순) limit 개 — DB 의 file_purge_candidates. 실패는 throw */
  selectDeleted(limit: number): Promise<FileRow[]>;
  removeObjects(bucket: string, paths: string[]): Promise<RemoveResult>;
  /** 아직 DELETED 인 행만 지운다(그 사이 READY 가 된 행은 남는다). 지운 수. 실패는 throw */
  deleteRows(ids: string[]): Promise<number>;
  /** 0031 고아 객체(files 행 없음, 유예 24h 지남, 오래된 순) limit 개 — DB 의 file_orphan_candidates. 실패는 throw */
  selectOrphans(limit: number): Promise<ObjectRow[]>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 1개씩 재시도가 이만큼 연속 실패하면 그 묶음 나머지는 건너뛴다 — Storage 가 통째로 죽었을 때 묶음마다 100회 직렬 호출로
 *  함수 실행 시간 상한에 닿지 않게. 건너뛴 행은 DELETED 로 남아 다음 실행이 다시 고른다 */
export const MAX_SINGLE_FAILS = 5;

async function tryRemove(store: Store, bucket: string, rows: FileRow[]): Promise<RemoveResult> {
  try {
    return await store.removeObjects(bucket, rows.map((r) => r.object_path));
  } catch (e) {
    return { data: null, error: { message: msg(e) } };
  }
}

type Removal = { ok: string[]; failed: number; errors: string[] };

/** 버킷별·CHUNK 단위로 remove. 묶음이 실패하면 1개씩 다시 — 영구 오류 하나가 같은 묶음의 정상 행까지 매번 붙잡지 않게
 *  (1개짜리는 그 결과 그대로). 성공한 row.id 를 돌려준다. purge·고아 정리가 같이 쓴다 */
async function removeGrouped(store: Store, rows: FileRow[]): Promise<Removal> {
  const ok: string[] = [];
  let failed = 0;
  const errors: string[] = [];
  for (const [bucket, list] of groupByBucket(rows)) {
    for (const part of chunk(list, CHUNK)) {
      const res = await tryRemove(store, bucket, part);
      const tries: [FileRow[], RemoveResult][] = [];
      let skipped: FileRow[] = [];
      if (res.error && part.length > 1) {
        let streak = 0;
        for (const [i, one] of part.entries()) {   // 순서대로(동시 100개 호출 피함)
          const r1 = await tryRemove(store, bucket, [one]);
          tries.push([[one], r1]);
          streak = r1.error ? streak + 1 : 0;
          if (streak >= MAX_SINGLE_FAILS) { skipped = part.slice(i + 1); break; }
        }
      } else {
        tries.push([part, res]);
      }
      for (const [list, r] of tries) {
        const s = splitRemoval(list, r);
        ok.push(...s.ok);
        failed += s.failed.length;
        if (r.error) errors.push(`remove ${bucket} ${list.map((x) => x.object_path).join(",")}: ${r.error.message}`);
      }
      if (skipped.length > 0) {
        failed += skipped.length;   // 지우지 못하고 남긴 행 — 응답 207/500 판단에 들어간다
        errors.push(`remove ${bucket}: 1개씩 재시도 연속 ${MAX_SINGLE_FAILS}회 실패 — 나머지 ${skipped.length}개는 다음 실행으로`);
      }
    }
  }
  return { ok, failed, errors };
}

export async function runCleanup(store: Store, opts: { limit: number }): Promise<Summary> {
  const rows = await store.selectDeleted(opts.limit);
  const { ok, failed, errors } = await removeGrouped(store, rows);
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

/**
 * 0031: files 행이 아예 없는 Storage 객체(유예 24h 지난 고아)를 지운다. 행이 없으니 지울 행도 없다.
 * 실패한 객체는 그대로 남아 다음 실행이 다시 고른다. 후보 조회 실패는 throw 하지 않고 errors 로 — purge 결과는 살린다.
 */
export async function runOrphanCleanup(store: Store, opts: { limit: number }): Promise<OrphanSummary> {
  let objs: ObjectRow[];
  try {
    objs = await store.selectOrphans(opts.limit);
  } catch (e) {
    return { selected: 0, removed: 0, failed: 0, errors: [`orphan select: ${msg(e)}`] };
  }
  const rows: FileRow[] = objs.map((o) => ({ id: `${o.bucket_id}/${o.object_path}`, bucket_id: o.bucket_id, object_path: o.object_path }));
  const { ok, failed, errors } = await removeGrouped(store, rows);
  return { selected: objs.length, removed: ok.length, failed, errors: errors.map((e) => `orphan ${e}`) };
}

/** 한 번 호출 = 기존 purge(DELETED 행) → 고아 객체. 응답·로그는 purge 요약 + orphans 요약, errors 는 합친다 */
export async function runAll(store: Store, opts: { limit: number }): Promise<Report> {
  const purge = await runCleanup(store, opts);   // 후보 조회 실패는 기존처럼 throw → 500
  const orphan = await runOrphanCleanup(store, opts);
  return {
    ...purge,
    errors: [...purge.errors, ...orphan.errors],
    orphans: { selected: orphan.selected, removed: orphan.removed, failed: orphan.failed },
  };
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
    async selectOrphans(limit) {
      const { data, error } = await db.rpc("file_orphan_candidates", { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as ObjectRow[];
    },
    async deleteRows(ids) {
      const { count, error } = await db.from("files").delete({ count: "exact" }).in("id", ids).eq("status", "DELETED");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}
