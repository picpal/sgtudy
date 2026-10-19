import type { FileMeta } from "@/lib/api/types";
import { extOf } from "./submission";
import { fromSaved, removePlanOf, type UploadRow } from "./uploads";

/* 항목(노드) 첨부 순수 로직 — 0030 DB 규칙과 같은 값·모양 */

export const NODE_FILE_LIMITS = { files: 5 } as const; // 0030 node_file_limit() 와 같은 값 (D1)
export const NODE_FILE_HINT = "PNG·JPG·GIF·WEBP·PDF·ZIP·TXT·MD · 파일당 10MB · 5개까지";

/** `n/{room}/{node}/{uuid}[.ext]` */
export const nodeObjectKey = (roomId: string, nodeId: string, uuid: string, name: string) => {
  const ext = extOf(name);
  return `n/${roomId}/${nodeId}/${uuid}${ext ? `.${ext}` : ""}`;
};

export const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 보이는 줄 = 선택된 id(저장본 또는 ov) 의 메타 + 올리는 중/실패 줄 */
export function nodeRows(selected: readonly string[], metas: ReadonlyMap<string, FileMeta>, pending: readonly UploadRow[]): UploadRow[] {
  const ready = selected.flatMap((id) => {
    const m = metas.get(id);
    return m ? [fromSaved([m])[0]] : [];
  });
  return [...ready, ...pending.filter((r) => r.status === "uploading" || r.status === "error")];
}

export const nodeRemovePlan = (row: UploadRow, savedIds: ReadonlySet<string>): "abort" | "drop" | "discard" => removePlanOf(row, savedIds);

export const fileBadge = (contentType: string): "PDF" | "ZIP" | "IMG" | "TXT" => {
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("zip")) return "ZIP";
  if (contentType.startsWith("image/")) return "IMG";
  return "TXT";
};
