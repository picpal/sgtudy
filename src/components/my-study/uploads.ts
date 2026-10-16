import type { FileMeta } from "@/lib/api/types";
import { SUB_LIMITS } from "./submission";

/* 작성 화면 첨부 목록 상태 (스펙 §2.3·§3 "빼기"). React 무관 리듀서 */

export type UploadRow = {
  /** 목록 안 식별자 — 저장된 파일은 `saved:{id}`, 새 업로드는 호출자가 정한다 */
  key: string;
  fileId: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  meta?: FileMeta;
};

export type UploadAction =
  | { type: "add"; row: UploadRow }
  | { type: "progress"; key: string; progress: number }
  | { type: "ready"; key: string; meta: FileMeta }
  | { type: "fail"; key: string; error: string }
  | { type: "markError"; fileId: string; error: string }
  | { type: "remove"; key: string };

/** 서버(또는 임시본)의 FileMeta → 올림 완료 줄 */
export const fromSaved = (files: FileMeta[]): UploadRow[] =>
  files.map((f) => ({ key: `saved:${f.id}`, fileId: f.id, name: f.name, size: f.size, status: "ready", progress: 100, meta: f }));

const patch = (rows: UploadRow[], hit: (r: UploadRow) => boolean, p: Partial<UploadRow>) =>
  rows.some(hit) ? rows.map((r) => (hit(r) ? { ...r, ...p } : r)) : rows;

export function uploadsReducer(rows: UploadRow[], a: UploadAction): UploadRow[] {
  switch (a.type) {
    case "add":
      return [...rows, a.row];
    case "progress":
      // 빼거나 취소한 줄에 늦게 온 진행률은 무시 (abort 경합)
      return patch(rows, (r) => r.key === a.key && r.status === "uploading", { progress: a.progress });
    case "ready":
      return patch(rows, (r) => r.key === a.key, { status: "ready", progress: 100, meta: a.meta, fileId: a.meta.id, error: undefined });
    case "fail":
      return patch(rows, (r) => r.key === a.key, { status: "error", error: a.error });
    case "markError":
      return patch(rows, (r) => r.fileId === a.fileId, { status: "error", error: a.error });
    case "remove":
      return rows.filter((r) => r.key !== a.key);
  }
}

/** 남은 자리 — 올리는 중·실패 줄도 자리를 차지한다 */
export const slotsLeft = (rows: UploadRow[]) => SUB_LIMITS.files - rows.length;

/** 제출에 실을 파일 id (순서 유지) */
export const readyIds = (rows: UploadRow[]) => rows.filter((r) => r.status === "ready").map((r) => r.fileId);

/**
 * 빼기 의미 (Review Focus 5):
 * - 올리는 중 → abort(요청 취소)
 * - 저장된 제출에 붙은 파일 → drop(목록에서만, 다음 저장이 soft delete)
 * - 미연결 READY 파일 → discard(서버 file_discard 로 한도에서 뺀다 — 0015, 어댑터가 없으면 drop 처럼 동작)
 * - 실패 줄 → drop
 */
export function removePlanOf(row: UploadRow, savedIds: ReadonlySet<string>): "drop" | "discard" | "abort" {
  if (row.status === "uploading") return "abort";
  if (row.status === "error") return "drop";
  return savedIds.has(row.fileId) ? "drop" : "discard";
}
