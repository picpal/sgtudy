"use client";

import { useRouter } from "next/navigation";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toApiError } from "@/lib/api/errors";
import { fetchCurriculum, recheckCurriculumEdit, nodeArchive, nodeCreate, nodeDelete, nodeMove, nodeUpdate, patchOf } from "@/lib/api/my-study";
import { personalArchive, personalComplete, personalCreate, personalDelete, personalUpdate, type PersonalPatch } from "@/lib/api/personal";
import { setNodeFiles } from "@/lib/api/nodeFiles";
import type { Curriculum, FileMeta, MeState, NodePatch } from "@/lib/api/types";
import type { ToastMsg } from "@/components/ui/Toast";
import { isUrlItem } from "./editUrl";
import { EMPTY_OVERRIDES, dropFieldOv, tempId, type Overrides, type TreeNode } from "./model";
import { saveSteps } from "./nodeFiles";
import { personalErrorText } from "./personal";
import { shiftedText, type DatePlan } from "./rounds";
import type { Update } from "./state";

export type CurriculumApi = {
  /** open: 만든 항목의 편집 화면을 연다(기본). false = 목록에 머문다(빠른 추가 — 토스트 없음). 성공하면 true */
  create: (parentId: string | null, opts?: { title?: string; open?: boolean; taskType?: "common" | "designated" }) => Promise<boolean>;
  /** from: "list" — 진행목표 목록에서 지웠다. 실패해도 편집 화면을 열지 않는다.
   *  "child" — 회차 편집 화면의 과제 섹션에서 지웠다. 열린 편집 화면(editSel)을 그대로 둔다. okText = 성공 토스트(기본 "삭제했어요") */
  remove: (id: string, from?: "edit" | "list" | "child", okText?: string) => Promise<void>;
  /** 다른 화면으로 떠나며 저장한 적 없는 빈 새 회차를 지운다 (Q2-8) — 화면 상태를 건드리지 않는다(바꾸면 주소 동기화가 history.back 으로 이동을 덮는다). 실패는 조용히 */
  discard: (id: string) => void;
  /** from: "list" — 결과를 편집 화면 문구 대신 토스트로 */
  archive: (id: string, on: boolean, from?: "edit" | "list") => Promise<void>;
  /** 성공(또는 바뀐 것 없음)이면 true */
  /** opts.shift: 회차·묶음 시작일 변경을 하위(과제·개인 목표)에도 같은 날수만큼 (D2).
   *  ov.files 가 있으면 node_files_set 을 먼저 — 성공하면 opts.onFiles(새 붙은 목록), 실패하면 ov.files 를 남기고 false.
   *  skipFiles: 붙은 목록을 못 불러왔다 — 일부 목록으로 바꿔 쓰지 않게(node_files_set 은 통째 교체) 첨부는 보내지 않는다 */
  save: (n: TreeNode, ov: Overrides, opts?: SaveOpts) => Promise<boolean>;
  /** node_move 후 dates(서브트리의 바뀌는 기간, movedPlan)를 노드마다 node_update 로 맞춘다. okText = 성공 토스트. 옮겨졌으면 true */
  move: (id: string, parentId: string, index?: number, dates?: DatePlan, okText?: string) => Promise<boolean>;
  /** 커리큘럼만 다시 받는다 — 제출 뒤 보드·간트·개요의 사람별 코드 갱신. 실패는 조용히 */
  refresh: () => Promise<void>;
  /* 개인 목표 (0014) — 낙관적 처리 없이 응답 Curriculum 으로 교체, 실패는 fail 경로(서버 문구 토스트) */
  /** 회차에 내 목표 추가(기간 = 서버 기본: 회차 기간). 성공하면 true */
  createPersonal: (roundId: string, title: string) => Promise<boolean>;
  /** 완료 표시/취소. 완료 토스트에는 "되돌리기"(→ 완료 취소) 버튼 (결정 3). 성공하면 true */
  completePersonal: (id: string, done: boolean) => Promise<boolean>;
  /** 제목·설명·기간·회차 수정. okText = 성공 토스트(기본 "저장했어요"). 성공하면 응답 Curriculum(warnings 확인용), 실패면 null */
  updatePersonal: (id: string, patch: PersonalPatch, okText?: string) => Promise<Curriculum | null>;
  archivePersonal: (id: string, on: boolean) => Promise<boolean>;
  removePersonal: (id: string) => Promise<boolean>;
  /** 편집 모드 진입 전 권한 재확인 (시나리오 QA #10) — 거뒀으면 토스트 + 보기로 두고 false */
  recheckEdit: () => Promise<boolean>;
};

export type SaveOpts = { shift?: boolean; onFiles?: (f: FileMeta[]) => void; skipFiles?: boolean };

export const dropKey = <T,>(rec: Record<string, T>, key: string) => {
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

export function useCurriculumApi(slug: string, setCur: Dispatch<SetStateAction<Curriculum>>, update: Update, toast: (m: ToastMsg) => void, me?: MeState): CurriculumApi {
  const router = useRouter();

  const fail = useCallback(
    /** prefix: 토스트 앞에 붙일 말 (예: 첨부는 저장됐고 내용만 실패) */
    (e: unknown, prefix = "") => {
      const err = toApiError(e);
      if (err.code === "NOT_CURRICULUM_EDITOR") {
        // 편집하는 사이 그룹장이 권한을 거뒀다 — 편집 모드를 닫고(편집 스위치도 사라짐) 커리큘럼을 다시 받는다
        toast({ text: "진행목표 편집 권한이 없어요", tone: "bad" });
        setCur((c) => ({ ...c, myPermissions: { canEditCurriculum: false } }));
        update({ curMode: "view", editSel: null, confirm: false, leave: null, saved: "", ov: EMPTY_OVERRIDES });
        fetchCurriculum(slug).then(setCur, () => {});
        router.refresh();
        return;
      }
      toast({ text: prefix + personalErrorText(err), tone: "bad" });
      if (err.code === "ROOM_NOT_EDITABLE" || err.code === "NOT_LEADER") update({ curMode: "view", editSel: null });
    },
    [toast, update, setCur, slug, router],
  );

  const create = useCallback(
    async (parentId: string | null, opts: { title?: string; open?: boolean; taskType?: "common" | "designated" } = {}) => {
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
        const cur = await nodeCreate(slug, parentId, opts.title, undefined, opts.taskType);
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
    async (id: string, from: "edit" | "list" | "child" = "edit", okText = "삭제했어요") => {
      update((p) => ({ ov: { ...p.ov, removed: { ...p.ov.removed, [id]: true } }, ...(from === "child" ? {} : { editSel: null, confirm: false }) }));
      try {
        setCur(await nodeDelete(slug, id));
        update((p) => ({ ov: { ...p.ov, removed: dropKey(p.ov.removed, id) } }));
        toast({ text: okText, tone: "ok" }); // Q3-14
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
    async (n: TreeNode, ov: Overrides, opts: SaveOpts = {}) => {
      const patch: NodePatch = patchOf(n, ov);
      // 회차·묶음 시작일을 옮기면서 "하위도 함께" 를 골랐을 때 (시나리오 QA D2) — 시작일이 바뀐 패치에만
      if (opts.shift && patch.startDate && !n.leaf) patch.shiftDescendants = true;
      const files = opts.skipFiles ? undefined : ov.files[n.id];
      // 저장하는 사이 업로드가 끝나 선택이 바뀌었으면 그 새 선택은 남긴다 (보낸 목록과 같을 때만 지운다)
      const dropSent = (o: Overrides): Overrides => (o.files[n.id] === files ? { ...o, files: dropKey(o.files, n.id) } : o);
      const dropFields = (o: Overrides): Overrides => {
        const next = dropFieldOv(o, n.id);
        return n.id in o.files && o.files[n.id] !== files ? { ...next, files: { ...next.files, [n.id]: o.files[n.id] } } : next;
      };
      const steps = saveSteps(Object.keys(patch).length === 0, files);
      if (steps.length === 0) {
        // 고쳤다가 원래 값으로 되돌린 오버라이드도 지운다 — 남으면 계속 "미저장"(회차 선택 비활성·이동 확인)
        update((p) => ({ ov: dropFieldOv(p.ov, n.id), saved: "바뀐 내용이 없어요" }));
        return true;
      }
      if (steps[0] === "files") {
        try {
          const attached = await setNodeFiles(n.id, files!);
          opts.onFiles?.(attached);
          update((p) => ({ ov: dropSent(p.ov) }));
        } catch (e) {
          fail(e); // ov.files 는 남긴다 — 고쳐서 다시 저장
          return false;
        }
        if (!steps.includes("node")) {
          toast(null);
          update({ saved: "저장했어요" });
          return true;
        }
      }
      try {
        const cur = await nodeUpdate(slug, n.id, patch);
        setCur(cur);
        // 태그가 실제로 바뀌었는지 여기서는 알 수 없다 → "다시 골랐어요" 문구는 쓰지 않는다 (Q1-17). 이전 오류 토스트는 닫는다 (Q2-09)
        toast(null);
        update((p) => ({ ov: dropFields(p.ov), saved: shiftedText(cur.shifted) }));
        router.refresh(); // 자동 태그가 바뀌었을 수 있다(D9)
        return true;
      } catch (e) {
        // 실패한 수정은 되돌린다 — 트리에 저장되지 않은 값이 남지 않게 (Q2-09). 첨부는 이미 저장됐다
        update((p) => ({ ov: dropFields(p.ov), saved: "" }));
        fail(e, steps[0] === "files" ? "첨부 파일은 저장했어요 · " : "");
        return false;
      }
    },
    [slug, setCur, update, fail, router, toast],
  );

  const move = useCallback(
    async (id: string, parentId: string, index?: number, dates: DatePlan = [], okText?: string) => {
      try {
        setCur(await nodeMove(slug, id, parentId, index));
      } catch (e) {
        fail(e);
        return false;
      }
      // 묶음째 옮기면 하위 과제까지 노드마다 (마이그레이션 없이 node_update 를 여러 번). 하나라도 실패하면 토스트 하나 + 서버 값으로 새로 고침
      for (const d of dates) {
        try {
          setCur(await nodeUpdate(slug, d.id, { startDate: d.s, endDate: d.e }));
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

  const discard = useCallback((id: string) => void nodeDelete(slug, id).catch(() => {}), [slug]);

  const refresh = useCallback(() => fetchCurriculum(slug).then(setCur, () => {}), [slug, setCur]);

  // 개인 목표 RPC 공통 — 응답으로 교체 + 성공 토스트. 실패는 fail
  const personal = useCallback(
    async (call: () => Promise<Curriculum>, ok: ToastMsg): Promise<Curriculum | null> => {
      try {
        const cur = await call();
        setCur(cur);
        toast(ok);
        return cur;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [setCur, toast, fail],
  );

  const createPersonal = useCallback(
    async (roundId: string, title: string) => !!(await personal(() => personalCreate(slug, roundId, title), { text: "내 목표를 추가했어요", tone: "ok" })),
    [slug, personal],
  );

  const completePersonal = useCallback(
    async function complete(id: string, done: boolean): Promise<boolean> {
      const ok: ToastMsg = done ? { text: "완료했어요", tone: "ok", action: { label: "되돌리기", onClick: () => void complete(id, false) } } : { text: "완료를 취소했어요", tone: "ok" };
      return !!(await personal(() => personalComplete(slug, id, done), ok));
    },
    [slug, personal],
  );

  const updatePersonal = useCallback(
    (id: string, patch: PersonalPatch, okText = "저장했어요") => personal(() => personalUpdate(slug, id, patch), { text: okText, tone: "ok" }),
    [slug, personal],
  );

  const archivePersonal = useCallback(
    async (id: string, on: boolean) => !!(await personal(() => personalArchive(slug, id, on), { text: on ? "보관했어요" : "보관을 해제했어요", tone: "ok" })),
    [slug, personal],
  );

  const removePersonal = useCallback(async (id: string) => !!(await personal(() => personalDelete(slug, id), { text: "삭제했어요", tone: "ok" })), [slug, personal]);

  const recheckEdit = useCallback(async () => {
    const r = await recheckCurriculumEdit(slug, me);
    if (r.cur) setCur(r.cur);
    if (!r.allowed) {
      // 화면을 연 뒤 그룹장이 권한을 거뒀다 — 편집 스위치도 사라진다(새 myPermissions)
      toast({ text: "진행목표 편집 권한이 없어요 · 그룹장이 권한을 거뒀어요", tone: "bad" });
      update({ curMode: "view", editSel: null, confirm: false, leave: null });
      router.refresh();
    }
    return r.allowed;
  }, [slug, me, setCur, toast, update, router]);

  return { create, remove, discard, archive, save, move, refresh, createPersonal, completePersonal, updatePersonal, archivePersonal, removePersonal, recheckEdit };
}
