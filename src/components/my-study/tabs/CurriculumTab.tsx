"use client";

import { PillButton, Seg } from "../bits";
import { addDays } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import { allParentsClosed, findNode, isDirty, overallPct, unassignedCount, visibleNodes, type Tree } from "../model";
import type { CurMode, Leave, ScreenState, Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { EditPanel } from "./EditPanel";
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
          그룹장에게만 보이는 편집 모드 미리보기예요. 항목을 누르면 <span className="@min-[760px]:hidden">아래 편집 패널에서</span>
          <span className="hidden @min-[760px]:inline">오른쪽에서</span> 수정할 수 있어요.
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

      {/* 컨테이너 폭 760 이상이면 트리 옆 sticky 패널, 미만이면 트리 아래 (Q2-06/Q2-07/Q3-04) */}
      <div className="flex flex-col gap-4 @min-[760px]:flex-row @min-[760px]:items-start">
        {/* 모서리 행은 컨테이너 안쪽 반경(16-1px)을 따라가야 선택 링(inset)이 둥근 클립에 잘리지 않는다 */}
        <div role="tree" aria-label="커리큘럼" className="min-w-0 overflow-hidden rounded-[16px] border border-line @min-[760px]:flex-[999_1_440px] [&>div:first-child>[role=treeitem]]:rounded-t-[15px] [&>div:last-child>[role=treeitem]]:rounded-b-[15px]">
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
            <button type="button" onClick={addRound} className="flex h-[50px] w-full items-center justify-center gap-[6px] bg-surface-3 text-[14px] font-semibold text-mint first:rounded-t-[15px] last:rounded-b-[15px] focus-visible:-outline-offset-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              회차 추가
            </button>
          )}
          {isEdit && nextRoundOut && <p className="m-0 bg-surface-3 px-4 pb-3 text-center text-[12px] font-medium text-amber-text">방 종료일({mmdd(period.end)}) 이후에 만들어져요 · 추가는 할 수 있어요</p>}
        </div>

        {isEdit && !selNode && (
          <div className="rounded-[16px] border border-dashed border-line-dash px-[18px] py-6 text-center text-[13px] leading-[1.6] text-muted @min-[760px]:flex-[0_0_360px] @min-[840px]:basis-[420px] @min-[960px]:basis-[460px]">
            편집할 회차나 과제를 <span className="@min-[760px]:hidden">위 목록</span>
            <span className="hidden @min-[760px]:inline">왼쪽</span>에서 선택하세요.
            <br />
            제목·기간·과제 유형·담당자를 바꿀 수 있어요.
          </div>
        )}
        {selNode && <EditPanel key={selNode.id} n={selNode} parent={parentNode} period={period} members={tree.members} S={S} update={update} api={api} go={go} request={request} />}
      </div>
    </div>
  );
}
