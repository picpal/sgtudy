import { ApiException, rpc, type Db } from "./errors";
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
