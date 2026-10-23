import type { FileMeta } from "@/lib/api/types";
import { isImageMime } from "@/lib/files/imageMime";
import { ACCEPT, extOf, mimeOf, SUB_LIMITS, type FileCheck } from "./submission";
import { fromSaved, removePlanOf, type UploadRow } from "./uploads";

/* 항목(노드) 첨부 순수 로직 — 0030·0045 DB 규칙과 같은 값·모양 */

/** 0045 node_image_limit()=20 · node_file_limit()=5(그림 아닌 것) · node_svg_max_bytes() (md-images 스펙 D18) */
export const NODE_FILE_LIMITS = { images: 20, files: 5, svgBytes: 2_097_152 } as const;
export const NODE_FILE_HINT = "그림(PNG·JPG·GIF·WEBP·SVG) 20개 · 파일(PDF·ZIP·TXT·MD) 5개 · 파일당 10MB(SVG 2MB)";
/** 노드 첨부 고르기 accept — 제출 ACCEPT + SVG(노드 첨부만, D19) */
export const NODE_ACCEPT = `${ACCEPT},image/svg+xml,.svg`;

/** 제출 mimeOf + SVG (0045 node_doc_mime_types) */
export function nodeMimeOf(f: { name: string; type: string }): string | null {
  if (f.type === "image/svg+xml" || (f.type === "" && extOf(f.name) === "svg")) return "image/svg+xml";
  return mimeOf(f);
}

/** 줄이 그림 자리를 쓰는가 — 올린 줄은 메타, 올리는 중·실패 줄은 이름의 확장자로 */
export const isImageRow = (r: UploadRow) => isImageMime(r.meta?.contentType ?? nodeMimeOf({ name: r.name, type: "" }) ?? "");

/** 올리기 전 거절(노드 첨부) — 순서: 형식 → 자리(종류별) → 빈 파일 → 크기(SVG 2MB). 실패 줄도 그 종류 자리를 차지한다 */
export function checkNodeFile(f: { name: string; type: string; size: number }, rows: readonly UploadRow[]): FileCheck {
  const mime = nodeMimeOf(f);
  if (!mime) return { ok: false, error: "올릴 수 없는 형식이에요" };
  const img = isImageMime(mime);
  const used = rows.filter((r) => isImageRow(r) === img).length;
  if (img && used >= NODE_FILE_LIMITS.images) return { ok: false, error: `그림은 항목당 ${NODE_FILE_LIMITS.images}개까지예요` };
  if (!img && used >= NODE_FILE_LIMITS.files) return { ok: false, error: `파일은 항목당 ${NODE_FILE_LIMITS.files}개까지예요` };
  if (f.size <= 0) return { ok: false, error: "빈 파일은 올릴 수 없어요" };
  if (f.size > SUB_LIMITS.fileBytes) return { ok: false, error: "10MB를 넘는 파일이에요" };
  if (mime === "image/svg+xml" && f.size > NODE_FILE_LIMITS.svgBytes) return { ok: false, error: "SVG 는 2MB까지예요" };
  return { ok: true, mime };
}

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

/** 팀 항목 저장 순서 — 첨부(node_files_set)를 먼저, 그다음 내용(node_update). 둘 다 없으면 [] ("바뀐 내용이 없어요") */
export const saveSteps = (patchEmpty: boolean, files: string[] | undefined): ("files" | "node")[] => [...(files ? (["files"] as const) : []), ...(patchEmpty ? [] : (["node"] as const))];
