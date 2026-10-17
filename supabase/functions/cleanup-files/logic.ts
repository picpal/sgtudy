// cleanup-files 의 순수 로직 — 네트워크·DB 없이 테스트한다(logic_test.ts).

export type FileRow = { id: string; bucket_id: string; object_path: string };
export type RemoveResult = { data: unknown[] | null; error: { message: string } | null };

/** 한 번 호출에서 가져오는 DELETED 행 수: 기본·상한 */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;
/** Storage remove() 한 번·행 delete 한 번에 넣는 수(실패 범위·URL 길이를 작게) */
export const CHUNK = 100;
/**
 * DELETED 후 이만큼 지난 행만 정리한다. 0007 file_register 는 같은 id 를 다시 등록하면 DELETED 행을 READY 로 되살린다
 * (on conflict (id) do update … deleted_at = null) — 방금 DELETED 된 행을 바로 지우면 그 재등록과 겹칠 수 있어 짧게 둔다.
 */
export const GRACE_MS = 60 * 60 * 1000;

export function parseLimit(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export function cutoffIso(now: Date, graceMs = GRACE_MS): string {
  return new Date(now.getTime() - graceMs).toISOString();
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
