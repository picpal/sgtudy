"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toApiError } from "@/lib/api/errors";
import { nodeArchive, nodeCreate, nodeDelete, nodeUpdate, patchOf } from "@/lib/api/my-study";
import type { Curriculum, NodePatch } from "@/lib/api/types";
import type { ToastMsg } from "@/components/ui/Toast";
import type { Overrides, TreeNode } from "./model";
import type { Update } from "./state";

export type CurriculumApi = {
  create: (parentId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  archive: (id: string, on: boolean) => Promise<void>;
  save: (n: TreeNode, ov: Overrides) => Promise<void>;
};

const dropKey = <T,>(rec: Record<string, T>, key: string) => {
  const { [key]: _omit, ...rest } = rec; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

/** 임시 행 하나만 뺀다 — 빠르게 두 번 추가하면 먼저 끝난 응답이 다른 요청의 임시 행까지 지우지 않게 */
const popOne = (rec: Record<string, string[]>, key: string) => {
  const list = rec[key] ?? [];
  return list.length > 1 ? { ...rec, [key]: list.slice(0, -1) } : dropKey(rec, key);
};

export function useCurriculumApi(slug: string, setCur: Dispatch<SetStateAction<Curriculum>>, update: Update, toast: (m: ToastMsg) => void): CurriculumApi {
  const router = useRouter();

  const fail = useCallback(
    (e: unknown) => {
      const err = toApiError(e);
      toast({ text: err.message, tone: "bad" });
      if (err.code === "ROOM_NOT_EDITABLE" || err.code === "NOT_LEADER") update({ curMode: "view", editSel: null });
    },
    [toast, update],
  );

  const create = useCallback(
    async (parentId: string | null) => {
      const key = parentId ?? "root";
      update((p) => ({ ov: { ...p.ov, added: { ...p.ov.added, [key]: [...(p.ov.added[key] ?? []), parentId ? "새 과제" : "새 회차"] } }, closed: parentId ? { ...p.closed, [parentId]: false } : p.closed, confirm: false, saved: "" }));
      try {
        const cur = await nodeCreate(slug, parentId);
        const created = cur.nodes.filter((n) => n.parentId === parentId).sort((a, b) => b.sortOrder - a.sortOrder)[0];
        setCur(cur);
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key) }, editSel: created?.id ?? null }));
        router.refresh(); // 개요의 회차 창·현재 회차는 room_get(detail) 에서 온다
      } catch (e) {
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key) } }));
        fail(e);
      }
    },
    [slug, setCur, update, fail, router],
  );

  const remove = useCallback(
    async (id: string) => {
      update((p) => ({ ov: { ...p.ov, removed: { ...p.ov.removed, [id]: true } }, editSel: null, confirm: false }));
      try {
        setCur(await nodeDelete(slug, id));
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) } }));
        router.refresh();
      } catch (e) {
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) }, editSel: id }));
        fail(e);
      }
    },
    [slug, setCur, update, fail, router],
  );

  const archive = useCallback(
    async (id: string, on: boolean) => {
      update((p) => ({ ov: { ...p.ov, archived: { ...p.ov.archived, [id]: on } }, confirm: false, saved: "" }));
      try {
        setCur(await nodeArchive(slug, id, on));
        update({ saved: on ? "보관했어요 · 제출물은 그대로 남아요" : "보관을 해제했어요" }); // 성공한 뒤에만
        router.refresh();
      } catch (e) {
        fail(e);
      } finally {
        update((p) => ({ ov: { ...p.ov, archived: dropKey(p.ov.archived, id) } }));
      }
    },
    [slug, setCur, update, fail, router],
  );

  const save = useCallback(
    async (n: TreeNode, ov: Overrides) => {
      const patch: NodePatch = patchOf(n, ov);
      if (Object.keys(patch).length === 0) return update({ saved: "바뀐 내용이 없어요" });
      try {
        const cur = await nodeUpdate(slug, n.id, patch);
        setCur(cur);
        update((p) => ({
          ov: { ...p.ov, titles: dropKey(p.ov.titles, n.id), descs: dropKey(p.ov.descs, n.id), dates: dropKey(p.ov.dates, n.id), typeOv: dropKey(p.ov.typeOv, n.id), assignOv: dropKey(p.ov.assignOv, n.id) },
          saved: "저장했어요 · 태그를 자동으로 다시 골랐어요",
        }));
        router.refresh(); // 자동 태그가 바뀌었을 수 있다(D9)
      } catch (e) {
        fail(e);
      }
    },
    [slug, setCur, update, fail, router],
  );

  return { create, remove, archive, save };
}
