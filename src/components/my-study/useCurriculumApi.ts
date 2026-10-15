"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toApiError } from "@/lib/api/errors";
import { fetchCurriculum, nodeArchive, nodeCreate, nodeDelete, nodeMove, nodeUpdate, patchOf } from "@/lib/api/my-study";
import type { Curriculum, NodePatch } from "@/lib/api/types";
import type { ToastMsg } from "@/components/ui/Toast";
import { isUrlItem } from "./editUrl";
import { EMPTY_OVERRIDES, dropFieldOv, tempId, type Overrides, type TreeNode } from "./model";
import type { Update } from "./state";

export type CurriculumApi = {
  /** open: 만든 항목의 편집 화면을 연다(기본). false = 목록에 머문다(빠른 추가 — 토스트 없음). 성공하면 true */
  create: (parentId: string | null, opts?: { title?: string; open?: boolean }) => Promise<boolean>;
  /** from: "list" — 진행목표 목록에서 지웠다. 실패해도 편집 화면을 열지 않는다.
   *  "child" — 회차 편집 화면의 과제 섹션에서 지웠다. 열린 편집 화면(editSel)을 그대로 둔다 */
  remove: (id: string, from?: "edit" | "list" | "child") => Promise<void>;
  /** from: "list" — 결과를 편집 화면 문구 대신 토스트로 */
  archive: (id: string, on: boolean, from?: "edit" | "list") => Promise<void>;
  /** 성공(또는 바뀐 것 없음)이면 true */
  save: (n: TreeNode, ov: Overrides) => Promise<boolean>;
  /** node_move 후 period 가 있으면 node_update 로 기간을 맞춘다. okText = 성공 토스트. 옮겨졌으면 true */
  move: (id: string, parentId: string, index?: number, period?: { s: string; e: string } | null, okText?: string) => Promise<boolean>;
};

const dropKey = <T,>(rec: Record<string, T>, key: string) => {
  const { [key]: _omit, ...rest } = rec; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

/** 임시 행 하나만 뺀다 — 빠르게 두 번 추가하면 먼저 끝난 응답이 다른 요청의 임시 행까지 지우지 않게.
 *  label: 그 제목의 임시 행을 뺀다 (빠른 추가는 제목이 제각각이라 끝 행을 빼면 엉뚱한 제목이 남는다) */
const popOne = (rec: Record<string, string[]>, key: string, label?: string) => {
  const list = rec[key] ?? [];
  if (list.length <= 1) return dropKey(rec, key);
  const at = label === undefined ? -1 : list.lastIndexOf(label);
  const i = at < 0 ? list.length - 1 : at;
  return { ...rec, [key]: [...list.slice(0, i), ...list.slice(i + 1)] };
};

export function useCurriculumApi(slug: string, setCur: Dispatch<SetStateAction<Curriculum>>, update: Update, toast: (m: ToastMsg) => void): CurriculumApi {
  const router = useRouter();

  const fail = useCallback(
    (e: unknown) => {
      const err = toApiError(e);
      if (err.code === "NOT_CURRICULUM_EDITOR") {
        // 편집하는 사이 그룹장이 권한을 거뒀다 — 편집 모드를 닫고(편집 스위치도 사라짐) 커리큘럼을 다시 받는다
        toast({ text: "커리큘럼 편집 권한이 없어요", tone: "bad" });
        setCur((c) => ({ ...c, myPermissions: { canEditCurriculum: false } }));
        update({ curMode: "view", editSel: null, confirm: false, leave: null, saved: "", ov: EMPTY_OVERRIDES });
        fetchCurriculum(slug).then(setCur, () => {});
        router.refresh();
        return;
      }
      toast({ text: err.message, tone: "bad" });
      if (err.code === "ROOM_NOT_EDITABLE" || err.code === "NOT_LEADER") update({ curMode: "view", editSel: null });
    },
    [toast, update, setCur, slug, router],
  );

  const create = useCallback(
    async (parentId: string | null, opts: { title?: string; open?: boolean } = {}) => {
      const key = parentId ?? "root";
      const open = opts.open ?? true;
      const label = opts.title ?? (parentId ? "새 과제" : "새 회차");
      // open: 응답을 기다리지 않고 임시 노드의 편집 화면을 연다(서버 id 가 오면 그 항목으로). 빠른 추가(open:false)는 목록에 임시 행만
      update((p) => {
        const list = p.ov.added[key] ?? [];
        return {
          ov: { ...p.ov, added: { ...p.ov.added, [key]: [...list, label] } },
          closed: parentId ? { ...p.closed, [parentId]: false } : p.closed,
          ...(open ? { editSel: tempId(key, list.length), confirm: false, saved: "" } : {}),
        };
      });
      try {
        const cur = await nodeCreate(slug, parentId, opts.title);
        const created = cur.nodes.filter((n) => n.parentId === parentId).sort((a, b) => b.sortOrder - a.sortOrder)[0];
        setCur(cur);
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key, label) }, ...(open ? { editSel: created?.id ?? null, justAdded: created?.id ?? null } : {}) }));
        if (open) toast({ text: parentId ? "새 과제를 추가했어요" : "새 회차를 추가했어요", tone: "ok" }); // Q3-14 — 빠른 추가는 행이 나타나는 것으로 충분
        router.refresh(); // 개요의 회차 창·현재 회차는 room_get(detail) 에서 온다
        return true;
      } catch (e) {
        // 만들지 못한 임시 노드의 편집 화면은 닫는다 (목록으로)
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key, label) }, ...(open ? { editSel: p.editSel && !isUrlItem(p.editSel) ? null : p.editSel } : {}) }));
        fail(e);
        return false;
      }
    },
    [slug, setCur, update, fail, router, toast],
  );

  const remove = useCallback(
    async (id: string, from: "edit" | "list" | "child" = "edit") => {
      update((p) => ({ ov: { ...p.ov, removed: { ...p.ov.removed, [id]: true } }, ...(from === "child" ? {} : { editSel: null, confirm: false }) }));
      try {
        setCur(await nodeDelete(slug, id));
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) } }));
        toast({ text: "삭제했어요", tone: "ok" }); // Q3-14
        router.refresh();
      } catch (e) {
        // 되돌림 — 편집 화면에서 지웠으면 그 화면을 다시 연다, 목록에서 지웠으면 행만 돌아온다
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) }, ...(from === "edit" ? { editSel: id } : {}) }));
        fail(e);
      }
    },
    [slug, setCur, update, fail, router, toast],
  );

  const archive = useCallback(
    async (id: string, on: boolean, from: "edit" | "list" = "edit") => {
      update((p) => ({ ov: { ...p.ov, archived: { ...p.ov.archived, [id]: on } }, confirm: false, saved: "" }));
      try {
        setCur(await nodeArchive(slug, id, on));
        const text = on ? "보관했어요 · 제출물은 그대로 남아요" : "보관을 해제했어요";
        if (from === "list") toast({ text, tone: "ok" });
        else update({ saved: text }); // 성공한 뒤에만
        router.refresh();
      } catch (e) {
        fail(e);
      } finally {
        update((p) => ({ ov: { ...p.ov, archived: dropKey(p.ov.archived, id) } }));
      }
    },
    [slug, setCur, update, fail, router, toast],
  );

  const save = useCallback(
    async (n: TreeNode, ov: Overrides) => {
      const patch: NodePatch = patchOf(n, ov);
      if (Object.keys(patch).length === 0) {
        // 고쳤다가 원래 값으로 되돌린 오버라이드도 지운다 — 남으면 계속 "미저장"(회차 선택 비활성·이동 확인)
        update((p) => ({ ov: dropFieldOv(p.ov, n.id), saved: "바뀐 내용이 없어요" }));
        return true;
      }
      try {
        const cur = await nodeUpdate(slug, n.id, patch);
        setCur(cur);
        // 태그가 실제로 바뀌었는지 여기서는 알 수 없다 → "다시 골랐어요" 문구는 쓰지 않는다 (Q1-17). 이전 오류 토스트는 닫는다 (Q2-09)
        toast(null);
        update((p) => ({ ov: dropFieldOv(p.ov, n.id), saved: "저장했어요" }));
        router.refresh(); // 자동 태그가 바뀌었을 수 있다(D9)
        return true;
      } catch (e) {
        // 실패한 수정은 되돌린다 — 트리에 저장되지 않은 값이 남지 않게 (Q2-09)
        update((p) => ({ ov: dropFieldOv(p.ov, n.id), saved: "" }));
        fail(e);
        return false;
      }
    },
    [slug, setCur, update, fail, router, toast],
  );

  const move = useCallback(
    async (id: string, parentId: string, index?: number, period?: { s: string; e: string } | null, okText?: string) => {
      try {
        setCur(await nodeMove(slug, id, parentId, index));
      } catch (e) {
        fail(e);
        return false;
      }
      if (period) {
        try {
          setCur(await nodeUpdate(slug, id, { startDate: period.s, endDate: period.e }));
        } catch (e) {
          // 이동은 됐다 — 기간만 옛 값 (마이그레이션 없이 두 번 부르는 대가)
          toast({ text: `옮겼지만 기간은 바꾸지 못했어요 · ${toApiError(e).message}`, tone: "bad" });
          router.refresh();
          return true;
        }
      }
      if (okText) toast({ text: okText, tone: "ok" });
      router.refresh();
      return true;
    },
    [slug, setCur, fail, router, toast],
  );

  return { create, remove, archive, save, move };
}
