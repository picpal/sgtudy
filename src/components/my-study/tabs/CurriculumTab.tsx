"use client";

import { PillButton, Seg } from "../bits";
import { allParentsClosed, findNode, overallPct, unassignedCount, visibleNodes, type Tree } from "../model";
import type { CurMode, ScreenState, Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { EditPanel } from "./EditPanel";
import { LeafDetail } from "./LeafDetail";
import { TreeRow } from "./TreeRow";

type Props = { tree: Tree; S: ScreenState; update: Update; api: CurriculumApi; canEdit: boolean };

export function CurriculumTab({ tree, S, update, api, canEdit }: Props) {
  const isEdit = S.curMode === "edit";
  const rows = visibleNodes(tree.roots, S.closed);
  const overall = overallPct(tree.roots) ?? 0;
  const warn = unassignedCount(tree.leaves);
  const selNode = isEdit ? findNode(tree.nodes, S.editSel) : null;

  const toggle = (id: string) => update((p) => ({ closed: { ...p.closed, [id]: !p.closed[id] } }));
  const setMode = (m: CurMode) => update({ curMode: m, editSel: null, openLeaf: null, confirm: false, saved: "" });
  // 구조 변경은 즉시 RPC (낙관적 임시 노드 → 응답 Curriculum 으로 교체)
  const addChild = (id: string) => api.create(id);
  const addRound = () => api.create(null);

  return (
    <div className="mt-[18px] flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-ink-3">
          전체 진척률 <b className="font-bold text-ink">{overall}%</b> · 과제 {tree.leaves.length}개
        </span>
        <span className="flex-[1_1_20px]" />
        <PillButton onClick={() => update({ closed: {} })}>모두 펼치기</PillButton>
        <PillButton onClick={() => update({ closed: allParentsClosed(tree.nodes) })}>모두 접기</PillButton>
        {canEdit && <Seg<CurMode> label="보기 모드" value={S.curMode} onChange={setMode} options={[["view", "참가자 보기"], ["edit", "그룹장 편집 미리보기"]]} />}
      </div>
      {isEdit && <p className="m-0 text-[12px] text-muted">그룹장에게만 보이는 편집 모드 미리보기예요. 항목을 누르면 오른쪽에서 수정할 수 있어요.</p>}
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

      <div className="flex flex-wrap items-start gap-4">
        <div role="tree" aria-label="커리큘럼" className="min-w-0 flex-[999_1_440px] overflow-hidden rounded-[16px] border border-line">
          {rows.map((n) => {
            const open = !S.closed[n.id];
            return (
              <div key={n.id}>
                <TreeRow
                  n={n}
                  isEdit={isEdit}
                  selected={isEdit && S.editSel === n.id}
                  open={open}
                  onToggle={() => toggle(n.id)}
                  onClick={() => {
                    if (isEdit) update({ editSel: n.id, confirm: false, saved: "" });
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
            <button type="button" onClick={addRound} className="flex h-[50px] w-full items-center justify-center gap-[6px] bg-surface-3 text-[14px] font-semibold text-mint">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              회차 추가
            </button>
          )}
        </div>

        {isEdit && !selNode && (
          <div className="max-w-[340px] flex-[1_1_260px] rounded-[16px] border border-dashed border-line-dash px-[18px] py-6 text-center text-[13px] leading-[1.6] text-muted">
            편집할 회차나 과제를 왼쪽에서 선택하세요.
            <br />
            제목·기간·과제 유형·담당자를 바꿀 수 있어요.
          </div>
        )}
        {selNode && <EditPanel n={selNode} members={tree.members} S={S} update={update} api={api} />}
      </div>
    </div>
  );
}
