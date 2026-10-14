"use client";

import { useEffect, useRef } from "react";
import { PillButton, Seg } from "../bits";
import { addDays } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import { allParentsClosed, findNode, isDirty, overallPct, unassignedCount, visibleNodes, type Tree } from "../model";
import type { CurMode, Leave, ScreenState, Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { EditView } from "./EditView";
import { LeafDetail } from "./LeafDetail";
import { TreeRow } from "./TreeRow";

type Props = { tree: Tree; S: ScreenState; update: Update; api: CurriculumApi; canEdit: boolean; period: { start: string; end: string } };

export function CurriculumTab({ tree, S, update, api, canEdit, period }: Props) {
  const isEdit = S.curMode === "edit";
  const rows = visibleNodes(tree.roots, S.closed);
  const overall = overallPct(tree.roots) ?? 0;
  // 담당자 배정 안내는 그룹장에게만 (Q1-11/Q2-12)
  const warn = canEdit ? unassignedCount(tree.leaves) : 0;
  const selNode = isEdit ? findNode(tree.nodes, S.editSel) : null;
  const parentNode = selNode ? findNode(tree.nodes, selNode.parentId) : null;
  const lastRoot = tree.roots[tree.roots.length - 1];
  // 다음 회차는 마지막 회차 다음 날부터 7일 — 방 종료일을 넘기면 미리 알려 준다 (E4, Q2-21)
  const nextRoundOut = !!lastRoot && addDays(lastRoot.e, 7) > period.end;

  const toggle = (id: string) => update((p) => ({ closed: { ...p.closed, [id]: !p.closed[id] } }));
  // 목적지로 바로 이동 — 미저장 수정 확인(leave)을 거친 뒤에도 여기로 온다
  const go = (to: Leave) => {
    if ("mode" in to) update({ curMode: to.mode, editSel: null, openLeaf: null, confirm: false, leave: null, saved: "" });
    else if ("add" in to) {
      update({ leave: null });
      // 구조 변경은 즉시 RPC (낙관적 임시 노드 → 응답 Curriculum 으로 교체)
      void api.create(to.add);
    } else update({ editSel: to.sel, confirm: false, leave: null, saved: "" });
  };
  // 저장하지 않은 수정이 있으면 먼저 묻는다 (Q2-05)
  const request = (to: Leave) => {
    if (isDirty(S.ov, S.editSel) && !("sel" in to && to.sel === S.editSel)) update({ leave: to, confirm: false });
    else go(to);
  };
  const setMode = (m: CurMode) => request({ mode: m });
  const addChild = (id: string) => request({ add: id });
  const addRound = () => request({ add: null });

  // 편집 화면에서 목록으로 돌아오면 열었던 행으로 포커스·스크롤을 돌려준다
  // (삭제해서 행이 없으면 상위 행, 그것도 없으면 "회차 추가")
  const lastOpen = useRef<string[] | null>(null);
  useEffect(() => {
    if (selNode) {
      lastOpen.current = [selNode.id, selNode.parentId ?? ""];
      return;
    }
    const ids = lastOpen.current;
    lastOpen.current = null;
    if (!ids) return;
    const row = (id: string) => (id ? document.querySelector<HTMLButtonElement>(`[data-node="${CSS.escape(id)}"] [data-row-main]`) : null);
    const btn = row(ids[0]) ?? row(ids[1]) ?? document.querySelector<HTMLButtonElement>("[data-add-round]");
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView({ block: "center" });
  }, [selNode]);

  // 편집할 항목이 열리면 목록 대신 전용 편집 화면 (?item=)
  if (selNode)
    return (
      <div className="mt-[18px] @container">
        <EditView key={selNode.id} n={selNode} parent={parentNode} period={period} members={tree.members} S={S} update={update} api={api} go={go} request={request} />
      </div>
    );

  return (
    <div className="mt-[18px] flex flex-col gap-[14px] @container">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-ink-3">
          전체 진척률 <b className="font-bold text-ink">{overall}%</b> · 과제 {tree.leaves.length}개
        </span>
        <span className="flex-[1_1_20px]" />
        <PillButton onClick={() => update({ closed: {} })}>모두 펼치기</PillButton>
        <PillButton onClick={() => update({ closed: allParentsClosed(tree.nodes) })}>모두 접기</PillButton>
        {canEdit && <Seg<CurMode> label="보기 모드" value={S.curMode} onChange={setMode} options={[["view", "참가자 보기"], ["edit", "그룹장 편집 미리보기"]]} />}
      </div>
      {isEdit && (
        <p className="m-0 text-[12px] text-muted">
          그룹장에게만 보이는 편집 모드 미리보기예요. 회차나 과제를 누르면 편집 화면이 열려요 · 추가하면 바로 편집 화면으로 이동해요.
        </p>
      )}
      {warn > 0 && (
        <div role="status" className="flex items-center gap-[10px] rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-3 text-[13px] font-medium text-[#6B4700]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3 2 20h20z" />
            <path d="M12 10v4" />
            <circle cx="12" cy="17" r=".6" />
          </svg>
          담당자가 지정되지 않은 과제 {warn}개 · 스터디 시작 전에 배정해 주세요
        </div>
      )}

      {/* 모서리 행은 컨테이너 안쪽 반경(16-1px)을 따라가야 선택 링(inset)이 둥근 클립에 잘리지 않는다 */}
      <div role="tree" aria-label="커리큘럼" className="min-w-0 overflow-hidden rounded-[16px] border border-line [&>div:first-child>[role=treeitem]]:rounded-t-[15px] [&>div:last-child>[role=treeitem]]:rounded-b-[15px]">
        {rows.map((n) => {
          const open = !S.closed[n.id];
          return (
            <div key={n.id}>
              <TreeRow
                n={n}
                isEdit={isEdit}
                open={open}
                onToggle={() => toggle(n.id)}
                onClick={() => {
                  if (isEdit) request({ sel: n.id });
                  else if (n.leaf) update((p) => ({ openLeaf: p.openLeaf === n.id ? null : n.id }));
                  else toggle(n.id);
                }}
                onAddChild={!n.leaf ? () => addChild(n.id) : undefined}
              />
              {!isEdit && n.leaf && S.openLeaf === n.id && <LeafDetail n={n} />}
            </div>
          );
        })}
        {isEdit && (
          <button type="button" data-add-round onClick={addRound} className="flex h-[50px] w-full items-center justify-center gap-[6px] bg-surface-3 text-[14px] font-semibold text-mint first:rounded-t-[15px] last:rounded-b-[15px] focus-visible:-outline-offset-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            회차 추가
          </button>
        )}
        {isEdit && nextRoundOut && <p className="m-0 bg-surface-3 px-4 pb-3 text-center text-[12px] font-medium text-amber-text">방 종료일({mmdd(period.end)}) 이후에 만들어져요 · 추가는 할 수 있어요</p>}
      </div>
    </div>
  );
}
