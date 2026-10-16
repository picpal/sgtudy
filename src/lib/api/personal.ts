import { rpc, type Db } from "./errors";
import type { Curriculum, MeTasks } from "./types";

/** 개인 목표 RPC 래퍼 (0014). 스펙 docs/superpowers/specs/2026-10-16-personal-goals-design.md */
export const personalCreate = (slug: string, roundId: string, title: string, opts?: { start?: string; end?: string; desc?: string }, client?: Db) =>
  rpc<Curriculum & { createdId: string }>("personal_create", { p_slug: slug, p_round_id: roundId, p_title: title, p_start_date: opts?.start ?? null, p_end_date: opts?.end ?? null, p_description_md: opts?.desc ?? "" }, client);

export type PersonalPatch = Partial<{ title: string; descriptionMd: string; startDate: string; endDate: string; roundId: string }>;
export const personalUpdate = (slug: string, id: string, patch: PersonalPatch, client?: Db) => rpc<Curriculum>("personal_update", { p_slug: slug, p_node_id: id, p_patch: patch }, client);
export const personalArchive = (slug: string, id: string, archived: boolean, client?: Db) => rpc<Curriculum>("personal_archive", { p_slug: slug, p_node_id: id, p_archived: archived }, client);
export const personalDelete = (slug: string, id: string, client?: Db) => rpc<Curriculum>("personal_delete", { p_slug: slug, p_node_id: id }, client);
export const personalComplete = (slug: string, id: string, done: boolean, client?: Db) => rpc<Curriculum>("personal_complete", { p_slug: slug, p_node_id: id, p_done: done }, client);
export const fetchMyTasks = (client?: Db) => rpc<MeTasks>("me_tasks", {}, client);
