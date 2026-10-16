import { ApiException, browserDb, rpc, toApiError, type Db } from "./errors";
import type { FileMeta, Submission, TaskDetail } from "./types";

/* 과제 상세·제출 어댑터 (0007_submissions.sql). 컴포넌트는 이 파일만 부른다 (D13) */
export const BUCKET = "attachments";
const num = (id: string) => Number(id);

export const fetchTask = (slug: string, nodeId: string, client?: Db) => rpc<TaskDetail>("task_get", { p_slug: slug, p_node: num(nodeId) }, client);
export const upsertSubmission = (nodeId: string, d: { body: string; links: string[]; fileIds: string[] }, client?: Db) =>
  rpc<Submission>("submission_upsert", { p_node: num(nodeId), p_body: d.body, p_links: d.links, p_file_ids: d.fileIds }, client);
export const registerFile = (nodeId: string, f: { path: string; name: string; mime: string; size: number }, client?: Db) =>
  rpc<FileMeta>("file_register", { p_node: num(nodeId), p_path: f.path, p_name: f.name, p_mime: f.mime, p_size: f.size }, client);
/** 0015 — 제출에 연결되지 않은 내 첨부를 정리(업로드 한도에서 뺀다). 연결된 파일은 FILE_ATTACHED */
export const discardFile = (fileId: string, client?: Db) => rpc<{ id: string; status: "deleted" }>("file_discard", { p_file: fileId }, client);

async function single<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiException(toApiError(error));
  if (!data) throw new ApiException({ code: "NOT_FOUND", message: "찾을 수 없어요" });
  return data as T;
}

/** Storage 키의 room 세그먼트 — DTO 에 room id 가 없어 goal_nodes 를 RLS 로 읽는다 (스펙 R8) */
export async function roomIdOfNode(nodeId: string, client?: Db): Promise<string> {
  const c = client ?? browserDb();
  const row = await single<{ room_id: number }>(c.from("goal_nodes").select("room_id").eq("id", num(nodeId)).single());
  return String(row.room_id);
}

/** 첨부 열기 — FileMeta 에 경로가 없어 files.object_path 를 RLS 로 읽고 300초 서명 URL (03-api §5) */
export async function fileUrl(f: Pick<FileMeta, "id" | "name">, client?: Db): Promise<string> {
  const c = client ?? browserDb();
  const row = await single<{ object_path: string }>(c.from("files").select("object_path").eq("id", f.id).single());
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(row.object_path, 300, { download: f.name });
  if (error || !data) throw new ApiException({ code: "UNKNOWN", message: "파일을 열 수 없어요" });
  return data.signedUrl;
}
