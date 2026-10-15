"use client";

import { useEffect, useRef, useState } from "react";
import { PillButton, Seg } from "../bits";
import { addDays } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import { allParentsClosed, findNode, isDirty, overallPct, removePlan, unassignedCount, visibleNodes, type Tree, type TreeNode } from "../model";
import { modeSwitchPatch, type CurMode, type Leave, type ScreenState, type Update } from "../state";
import { withAddRows } from "../rounds";
import type { CurriculumApi } from "../useCurriculumApi";
import { DetailView } from "./DetailView";
import { EditView } from "./EditView";
import { InlineConfirm } from "./InlineConfirm";
import { AddRow, QuickAdd } from "./QuickAdd";
import { TreeRow } from "./TreeRow";

type Props = { tree: Tree; S: ScreenState; update: Update; api: CurriculumApi; canEdit: boolean; isLeader: boolean; period: { start: string; end: string } };

export function CurriculumTab({ tree, S, update, api, canEdit, isLeader, period }: Props) {
  // 권한을 거둬 간 직후 등 편집할 수 없는데 모드가 남아 있으면 보기로 그린다
  const isEdit = canEdit && S.curMode === "edit";
  const rows = visibleNodes(tree.roots, S.closed);
  const overall = overallPct(tree.roots) ?? 0;
  // 담당자 배정 안내는 편집할 수 있는 사람에게만 (Q1-11/Q2-12 — 그룹장 + 편집 권한을 받은 팀원)
  const warn = canEdit ? unassignedCount(tree.leaves) : 0;
  const selNode = isEdit ? findNode(tree.nodes, S.editSel) : null;
  const viewNode = !isEdit ? findNode(tree.nodes, S.viewSel) : null;
  const parentNode = selNode ? findNode(tree.nodes, selNode.parentId) : null;
  const lastRoot = tree.roots[tree.roots.length - 1];
  // 다음 회차는 마지막 회차 다음 날부터 7일 — 방 종료일을 넘기면 미리 알려 준다 (E4, Q2-21)
  const nextRoundOut = !!lastRoot && addDays(lastRoot.e, 7) > period.end;

  // 목록 행의 삭제 확인이 열린 항목 (아래 목록 삭제)
  const [ask, setAsk] = useState<string | null>(null);
  const toggle = (id: string) => update((p) => ({ closed: { ...p.closed, [id]: !p.closed[id] } }));
  // 목적지로 바로 이동 — 미저장 수정 확인(leave)을 거친 뒤에도 여기로 온다
  const go = (to: Leave) => {
    setAsk(null);
    if ("mode" in to) update({ ...modeSwitchPatch(S, to.mode) });
    else if ("add" in to) {
      update({ leave: null });
      // 구조 변경은 즉시 RPC (낙관적 임시 노드 → 응답 Curriculum 으로 교체)
      void api.create(to.add);
    } else update({ editSel: to.sel, quickAdd: null, confirm: false, leave: null, saved: "" });
  };
  // 저장하지 않은 수정이 있으면 먼저 묻는다 (Q2-05)
  const request = (to: Leave) => {
    if (isDirty(S.ov, S.editSel) && !("sel" in to && to.sel === S.editSel)) update({ leave: to, confirm: false });
    else go(to);
  };
  const setMode = (m: CurMode) => request({ mode: m });
  const addRound = () => request({ add: null });
  // 회차 "+"·"과제 추가" 줄 → 목록에 머문 채 그 회차를 펼치고 끝에 빠른 추가 입력 (한 번에 하나)
  const openAdd = (id: string) => update((p) => ({ quickAdd: id, closed: { ...p.closed, [id]: false } }));
  const closeAdd = (id: string) => {
    update((p) => (p.quickAdd === id ? { quickAdd: null } : {}));
    // Esc 로 닫았을 때만(포커스가 갈 곳이 없을 때) "과제 추가" 줄로 — 다른 회차 "+" 를 눌러 닫힌 거면 그쪽 입력을 뺏지 않는다
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLButtonElement>(`[data-add-task="${CSS.escape(id)}"]`)?.focus();
    });
  };
  const entries = isEdit ? withAddRows(rows, tree.roots, S.closed) : rows.map((n) => ({ kind: "node" as const, n }));

  // 편집·상세 화면에서 목록으로 돌아오면 열었던 행으로 포커스·스크롤을 돌려준다
  // (삭제해서 행이 없으면 상위 행, 그것도 없으면 "회차 추가")
  const openNode = selNode ?? viewNode;
  const lastOpen = useRef<string[] | null>(null);
  useEffect(() => {
    if (openNode) {
      lastOpen.current = [openNode.id, openNode.parentId ?? ""];
      return;
    }
    const ids = lastOpen.current;
    lastOpen.current = null;
    if (!ids) return;
    const row = (id: string) => (id ? document.querySelector<HTMLButtonElement>(`[data-node="${CSS.escape(id)}"] [data-row-main]`) : null);
    const btn = row(ids[0]) ?? row(ids[1]) ?? document.querySelector<HTMLButtonElement>("[data-add-round]");
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView({ block: "center" });
  }, [openNode]);

  // 목록에서 바로 삭제 — 행 아래 확인 상자(편집 화면과 같은 문구) → 즉시 RPC(낙관적 + 실패 시 되돌림·토스트)
  const asking = isEdit && !selNode ? (rows.find((n) => n.id === ask) ?? null) : null;
  const rowBtn = (id: string | undefined, sel: string) => (id ? document.querySelector<HTMLButtonElement>(`[data-node="${CSS.escape(id)}"] ${sel}`) : null);
  const cancelAsk = () => {
    const id = ask;
    setAsk(null);
    // 확인 상자가 사라지면 누른 삭제 버튼으로 포커스를 돌린다
    requestAnimationFrame(() => rowBtn(id ?? undefined, "[data-row-del]")?.focus());
  };
  const confirmRemove = (n: TreeNode) => {
    const plan = removePlan(n);
    setAsk(null);
    if (plan.kind === "archive") {
      void api.archive(n.id, true, "list");
      requestAnimationFrame(() => rowBtn(n.id, "[data-row-del]")?.focus());
      return;
    }
    if (plan.kind !== "delete") return;
    // 지운 행(과 하위 행)이 사라지므로 포커스는 다음 행 → 이전 행 → "회차 추가"
    const i = rows.indexOf(n);
    const next = rows.slice(i + 1).find((r) => r.d <= n.d) ?? rows[i - 1];
    void api.remove(n.id, "list");
    requestAnimationFrame(() => (rowBtn(next?.id, "[data-row-main]") ?? document.querySelector<HTMLButtonElement>("[data-add-round]"))?.focus());
  };

  // 편집할 항목이 열리면 목록 대신 전용 편집 화면 (?item=)
  if (selNode)
    return (
      <div className="mt-[18px] @container">
        <EditView key={selNode.id} n={selNode} parent={parentNode} period={period} members={tree.members} S={S} update={update} api={api} go={go} request={request} />
      </div>
    );
  // 보기 모드에서 항목을 누르면 목록 대신 읽기 전용 상세 화면 (?item=, mode 없음)
  if (viewNode)
    return (
      <div className="mt-[18px] @container">
        <DetailView key={viewNode.id} n={viewNode} nodes={tree.nodes} canEdit={canEdit} onOpen={(id) => update({ viewSel: id })} onBack={() => update({ viewSel: null })} onEdit={() => update(modeSwitchPatch(S, "edit"))} />
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
        {canEdit && <Seg<CurMode> label="보기 모드" value={S.curMode} onChange={setMode} options={[["view", "보기"], ["edit", "편집"]]} />}
      </div>
      {isEdit && (
        <p className="m-0 text-[12px] text-muted">
          회차는 기간·대주제, 과제는 회차 안의 할 일이에요 · 회차나 과제를 누르면 편집 화면이 열려요.
          {isLeader ? " 개요 탭 멤버 관리에서 팀원에게 편집 권한을 줄 수 있어요." : " 그룹장이 준 편집 권한으로 고치고 있어요."}
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
      <div role="tree" aria-label="진행목표" className="min-w-0 overflow-hidden rounded-[16px] border border-line [&>div:first-child>[role=treeitem]]:rounded-t-[15px] [&>div:last-child>[role=treeitem]]:rounded-b-[15px]">
        {entries.map((entry) => {
          if (entry.kind === "add")
            return S.quickAdd === entry.round.id ? (
              <QuickAdd key={`qa-${entry.round.id}`} round={entry.round} indent={1} onAdd={(t) => api.create(entry.round.id, { title: t, open: false })} onClose={() => closeAdd(entry.round.id)} />
            ) : (
              <AddRow key={`add-${entry.round.id}`} round={entry.round} indent={1} onOpen={() => openAdd(entry.round.id)} />
            );
          const n = entry.n;
          const open = !S.closed[n.id];
          const plan = removePlan(n);
          return (
            <div key={n.id}>
              <TreeRow
                n={n}
                isEdit={isEdit}
                open={open}
                onToggle={() => toggle(n.id)}
                onClick={() => {
                  if (isEdit) request({ sel: n.id });
                  else update({ viewSel: n.id });
                }}
                onAddChild={!n.leaf && n.d === 0 ? () => openAdd(n.id) : undefined}
                onRemove={!n.temp && plan.kind !== "none" ? () => (asking?.id === n.id ? cancelAsk() : setAsk(n.id)) : undefined}
                removeOff={n.temp ? "서버에 만드는 중…" : plan.kind === "none" ? plan.reason : undefined}
                asking={asking?.id === n.id}
              />
              {asking?.id === n.id && plan.kind !== "none" && (
                <div className="border-b border-line-2 bg-surface px-3 py-2">
                  <InlineConfirm text={`‘${n.title || "제목 없는 항목"}’ — ${plan.text}`} onCancel={cancelAsk} actions={[{ label: plan.label, onClick: () => confirmRemove(n), tone: "danger" }]} />
                </div>
              )}
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
