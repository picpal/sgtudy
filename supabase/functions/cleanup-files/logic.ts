// cleanup-files 의 순수 로직 — 네트워크·DB 없이 테스트한다(logic_test.ts).

export type FileRow = { id: string; bucket_id: string; object_path: string };
export type RemoveResult = { data: unknown[] | null; error: { message: string } | null };

/** 한 번 호출에서 가져오는 DELETED 행 수: 기본·상한 */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;
/** Storage remove() 한 번·행 delete 한 번에 넣는 수(실패 범위·URL 길이를 작게) */
export const CHUNK = 100;
// 정리 유예(DELETED 후 1시간)는 DB 한 곳 public.file_purge_grace() 에 있다 — 후보는 file_purge_candidates RPC 가 고른다(0019).
// 고아 객체(files 행 없음) 유예 24시간은 public.file_orphan_grace() — 후보는 file_orphan_candidates RPC(0031).

export function parseLimit(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export function groupByBucket<T extends FileRow>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.bucket_id);
    if (list) list.push(r);
    else m.set(r.bucket_id, [r]);
  }
  return m;
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Storage remove() 결과 분류. remove 는 실제로 지운 객체만 data 로 돌려주고, 없는 경로는 오류 없이 빠진다
 * → 오류가 없으면 요청한 행 전부 성공(이미 없는 객체도 성공). 오류면 묶음 전부 실패 → 행을 남겨 다음 실행에 재시도.
 */
export function splitRemoval(rows: FileRow[], res: RemoveResult): { ok: string[]; failed: string[] } {
  const ids = rows.map((r) => r.id);
  return res.error ? { ok: [], failed: ids } : { ok: ids, failed: [] };
}

/** 전용 시크릿 헤더 비교. 시크릿이 설정되지 않았으면 닫힌 채로(전부 거부). 길이가 달라도 끝까지 비교한다. */
export function isAuthorized(secret: string | undefined, header: string | null): boolean {
  if (!secret || header === null) return false;
  const a = new TextEncoder().encode(secret);
  const b = new TextEncoder().encode(header);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}

export type Summary = { selected: number; removed: number; rowsDeleted: number; failed: number; errors: string[] };
/** 0031 고아 객체(files 행 없음) — DB file_orphan_candidates 의 행 */
export type ObjectRow = { bucket_id: string; object_path: string };
export type OrphanSummary = { selected: number; removed: number; failed: number; errors: string[] };
/** 응답 본문: purge 요약 + orphans(errors 는 위 errors 에 "orphan …" 으로 합친다) */
export type Report = Summary & { orphans: Omit<OrphanSummary, "errors"> };

/** 예약 잡 응답 기록(net._http_response.status_code)으로 실패가 보이게: 오류 없음 200, 일부 실패 207, 하나도 못 지움 500.
 *  orphans 가 있으면 그 실패·성공도 같이 본다 */
export function responseStatus(s: Summary & { orphans?: Omit<OrphanSummary, "errors"> }): number {
  const failed = s.failed + (s.orphans?.failed ?? 0);
  if (s.errors.length === 0 && failed === 0) return 200;
  return s.removed > 0 || s.rowsDeleted > 0 || (s.orphans?.removed ?? 0) > 0 ? 207 : 500;
}
