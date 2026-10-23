import { ApiException, browserDb, rpc, type Db } from "./errors";
import { BUCKET } from "./submission";
import type { FileMeta } from "./types";

/* 진행목표 항목 첨부 어댑터 (0030_node_attachments.sql). 서명 URL 은 submission.fileUrl 을 그대로 쓴다 (files RLS · Storage 정책이 NODE_DOC 를 연다) */
const num = (id: string) => Number(id);

export const registerNodeFile = (nodeId: string, f: { path: string; name: string; mime: string; size: number }, client?: Db) =>
  rpc<FileMeta>("node_file_register", { p_node: num(nodeId), p_path: f.path, p_name: f.name, p_mime: f.mime, p_size: f.size }, client);
export const setNodeFiles = (nodeId: string, fileIds: string[], client?: Db) =>
  rpc<FileMeta[]>("node_files_set", { p_node: num(nodeId), p_file_ids: fileIds }, client);
export const fetchNodeFiles = (nodeId: string, client?: Db) => rpc<FileMeta[]>("node_files", { p_node: num(nodeId) }, client);
export const discardNodeFile = (fileId: string, client?: Db) => rpc<{ id: string; status: "deleted" }>("node_file_discard", { p_file: fileId }, client);

export async function discardNodeUnattached(fileId: string, client?: Db): Promise<boolean> {
  try {
    await discardNodeFile(fileId, client);
    return true;
  } catch {
    return false; // 미저장 파일은 서버가 24시간 뒤 정리(0030 job_cleanup)
  }
}

/** 볼 권한 없음(NODE_NOT_FOUND)은 빈 목록 — 보기 상세가 조용히 숨긴다 */
export async function fetchNodeFilesOrEmpty(nodeId: string, client?: Db): Promise<FileMeta[]> {
  try {
    return await fetchNodeFiles(nodeId, client);
  } catch (e) {
    if (e instanceof ApiException && e.code === "NODE_NOT_FOUND") return [];
    throw e;
  }
}

/**
 * 설명 속 그림·미리보기용 inline 서명 URL(1시간, download 없음) — files 표에서 경로를 한 번에 받고 createSignedUrls 한 번 (md-images 스펙 D14).
 * 받기 버튼은 지금처럼 fileUrl(download 300초). 서명에 실패한 id 는 결과에서 빠진다
 */
export async function nodeImageUrls(files: Pick<FileMeta, "id">[], client?: Db): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (files.length === 0) return out;
  const c = client ?? browserDb();
  const { data: rows, error } = await c.from("files").select("id, object_path").in("id", files.map((f) => f.id));
  if (error || !rows) throw new ApiException({ code: "UNKNOWN", message: "그림을 불러올 수 없어요" });
  if (rows.length === 0) return out;
  const idOf = new Map(rows.map((r) => [r.object_path, r.id]));
  const { data: signed, error: e2 } = await c.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.object_path), 3600);
  if (e2 || !signed) throw new ApiException({ code: "UNKNOWN", message: "그림을 불러올 수 없어요" });
  for (const s of signed) {
    const id = s.path ? idOf.get(s.path) : undefined;
    if (id && !s.error && s.signedUrl) out.set(id, s.signedUrl);
  }
  return out;
}
