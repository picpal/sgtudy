"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRefocusOnClose } from "@/lib/useRefocusOnClose";
import { Chip, PillButton, Seg } from "../bits";
import { addDays, md } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import { allParentsClosed, findNode, isDirty, overallPct, personalStats, removePlan, unassignedCount, visibleNodes, type ItemScope, type Tree, type TreeNode } from "../model";
import { modeSwitchPatch, toggleMinePatch, toggleOthersPatch, type CurMode, type Leave, type ScreenState, type Update } from "../state";
import { dropPlan, movedPlan, roundOf, withAddRows, withEmptyRounds, withPersonalAddRows } from "../rounds";
import type { CurriculumApi } from "../useCurriculumApi";
import type { RoomStatus } from "../submission";
import type { ToastMsg } from "@/components/ui/Toast";
import { useMe } from "@/lib/me";
import { othersHeading } from "../personal";
import { DetailView } from "./DetailView";
import { EditView } from "./EditView";
import { InlineConfirm } from "./InlineConfirm";
import { AddRow, QuickAdd } from "./QuickAdd";
import { TreeRow } from "./TreeRow";
import { useRowDrag } from "./useRowDrag";

type Props = {
  tree: Tree;
  S: ScreenState;
  update: Update;
  api: CurriculumApi;
  canEdit: boolean;
  isLeader: boolean;
  period: { start: string; end: string };
  slug: string;
  roomStatus: RoomStatus;
  /** 승인 대기자 — 과제 상세에서 다른 사람 제출물을 볼 수 없다 */
  viewerPending: boolean;
  toast: (m: ToastMsg) => void;
  /** Curriculum.personal — 개인 목표 추가 자격·회차당 한도 (없으면 추가 줄 없음) */
  personal?: { canAdd: boolean; perRound: number };
};

/** 트리 안 비활성 안내 줄(한도·빈 회차·소제목) — tree 안에는 treeitem 만 둔다. 선택 대상이 아니라 aria-selected 는 두지 않는다(다른 보기 행과 같게) */
function InfoRow({ children, tone = "plain", ...rest }: { children: React.ReactNode; tone?: "plain" | "personal" | "heading" } & React.HTMLAttributes<HTMLDivElement> & { "data-limit"?: string }) {
  const item = { role: "treeitem", "aria-level": 3, "aria-disabled": true };
  // 소제목(시안 C-2): 글자는 행 제목 세로줄(68px = 여백 8 + 들여쓰기 22 + 간격 8 + 점 30)에 맞춘다. 390 은 들여쓰기 10 → 56px
  if (tone === "heading")
    return (
      <div {...item} {...rest} className="flex items-center border-b border-line-2 bg-personal-bg pb-[6px] pl-[68px] pr-[18px] pt-2 text-[12px] font-bold text-personal-ink focus-visible:-outline-offset-2 max-sm:pl-[56px]">
        {children}
      </div>
    );
  const cls = `min-h-11 py-2 text-[13px] text-muted ${tone === "personal" ? "bg-personal-bg" : "bg-surface"}`;
  return (
    <div {...item} {...rest} className={`flex items-center border-b border-line-2 pl-2 pr-3 focus-visible:-outline-offset-2 ${cls}`}>
      <span className="w-[22px] shrink-0 max-sm:w-[10px]" />
      <span className="px-2">{children}</span>
    </div>
  );
}

/** 보기 목록 개인 목표 빠른 추가의 S.quickAdd 값 — 편집 목록 팀 과제 빠른 추가(회차 id 그대로)와 겹치지 않게 */
const pKey = (roundId: string) => `p:${roundId}`;

export function CurriculumTab({ tree, S, update, api, canEdit, isLeader, period, slug, roomStatus, viewerPending, toast, personal }: Props) {
  const meId = useMe()?.id ?? null;
  // 권한을 거둬 간 직후 등 편집할 수 없는데 모드가 남아 있으면 보기로 그린다
  const isEdit = canEdit && S.curMode === "edit";
  // 보기 범위 — 편집 모드엔 개인 목표 없음·필터 없음. 보기 모드는 칩("내 것만"·"팀원 목표"; 둘은 서로 끈다)
  const scope: ItemScope = { meId, mineOnly: !isEdit && S.mineOnly, others: !isEdit && S.othersPersonal && !S.mineOnly, isEdit, isLeader };
  const rows = visibleNodes(tree.roots, S.closed, scope);
  const canAddPersonal = !isEdit && !!personal?.canAdd;
  const limit = personal?.perRound ?? 20;
  // 회차마다 내 목표(보관 제외)가 한도에 닿았나
  const atLimit = (roundId: string) => !!meId && personalStats(tree.personal, meId, roundId).total >= limit;
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
  // 목록 드래그 놓기 → 즉시 node_move (다른 회차로 가면 기간 규칙 movedPlan — 묶음은 하위까지 — 적용 + 토스트)
  const onDrop = useCallback(
    (dragId: string, overId: string, half: "top" | "bottom") => {
      const plan = dropPlan(tree.nodes, dragId, overId, half);
      const n = findNode(tree.nodes, dragId);
      const target = plan ? findNode(tree.nodes, plan.parentId) : null;
      if (!plan || !n || !target) return;
      const from = roundOf(tree.nodes, n);
      const to = roundOf(tree.nodes, target);
      const cross = !!from && !!to && from.id !== to.id;
      // 묶음이면 하위 과제까지 같은 규칙으로 (finding 6) — 토스트 기간은 끌어 온 행 자신의 것
      const dates = cross ? movedPlan(n, from, to) : [];
      const period = dates.find((d) => d.id === dragId) ?? null;
      const label = to?.label ?? to?.title;
      void api.move(dragId, plan.parentId, plan.index, dates, cross ? (period ? `${label}로 옮겼어요 · 기간 ${md(period.s)} – ${md(period.e)}` : `${label}로 옮겼어요`) : undefined);
    },
    [tree.nodes, api],
  );
  const drag = useRowDrag(onDrop);
  // 놓을 수 없는 자리(자기·하위·보관·제자리)에는 표시선을 그리지 않는다
  const hint = isEdit && drag.dragging && drag.over && dropPlan(tree.nodes, drag.dragging, drag.over.id, drag.over.half) ? drag.over : null;
  const listed = isEdit ? withAddRows(rows, tree.roots, S.closed) : withPersonalAddRows(rows, tree.roots, S.closed, canAddPersonal, meId);
  const entries = scope.mineOnly ? withEmptyRounds(listed, S.closed) : listed;
  // "＋ 내 목표 추가" → 그 자리가 빠른 추가 입력 (한 번에 하나 — S.quickAdd 를 편집 목록과 함께 쓴다)
  const openPAdd = (id: string) => update({ quickAdd: pKey(id) });
  // 닫으면 그 자리 "＋ 내 목표 추가" 로 — 버튼이 다시 그려진 뒤(effect, /tasks 와 같은 훅)
  const refocusPAdd = useRefocusOnClose(!!S.quickAdd?.startsWith("p:"));
  const closePAdd = (id: string) => {
    refocusPAdd(() => document.querySelector<HTMLButtonElement>(`[data-add-personal="${CSS.escape(id)}"]`));
    update((p) => (p.quickAdd === pKey(id) ? { quickAdd: null } : {}));
  };
  // 두 칩은 서로 끈다 — "내 것만" 은 남의 목표를 숨기므로 둘이 함께 켜져 있으면 "팀원 목표" 가 아무 일도 하지 않는다
  const toggleMine = () => update(toggleMinePatch);
  const toggleOthers = () => update(toggleOthersPatch);
  // 빠른 추가로 한도에 닿으면 입력이 안내 줄로 바뀐다 — 열림 상태를 정리하고 포커스를 안내 줄로 옮겨 읽어 준다
  const limitHit = S.quickAdd?.startsWith("p:") && atLimit(S.quickAdd.slice(2)) ? S.quickAdd.slice(2) : null;
  useEffect(() => {
    if (!limitHit) return;
    update({ quickAdd: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-limit="${CSS.escape(limitHit)}"]`)?.focus());
  }, [limitHit, update]);

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
        <EditView key={selNode.id} n={selNode} parent={parentNode} nodes={tree.nodes} roots={tree.roots} period={period} members={tree.members} S={S} update={update} api={api} go={go} request={request} />
      </div>
    );
  // 보기 모드에서 항목을 누르면 목록 대신 읽기 전용 상세 화면 (?item=, mode 없음)
  if (viewNode)
    return (
      <div className="mt-[18px] @container">
        <DetailView
          key={viewNode.id}
          n={viewNode}
          nodes={tree.nodes}
          canEdit={canEdit}
          onOpen={(id) => update({ viewSel: id, viewFocus: null })}
          onBack={() => update({ viewSel: null, viewFocus: null })}
          onEdit={() => update(modeSwitchPatch(S, "edit"))}
          slug={slug}
          roomStatus={roomStatus}
          focus={S.viewFocus}
          onFocused={() => update({ viewFocus: null })}
          onSubmitted={() => void api.refresh()}
          toast={toast}
          viewerPending={viewerPending}
          isLeader={isLeader}
          // 과제를 하지 않는 그룹장에게는 "담당 과제가 아니에요" 를 보이지 않는다
          quietNotAssigned={isLeader && !tree.members.some((m) => m.userId === meId && m.doesTasks)}
          roots={tree.roots}
          period={period}
          personal={personal}
          api={api}
        />
      </div>
    );

  return (
    <div className="mt-[18px] flex flex-col gap-[14px] @container">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-ink-3">
          전체 진척률 <b className="font-bold text-ink">{overall}%</b> · 과제 {tree.leaves.length}개
        </span>
        <span className="flex-[1_1_20px]" />
        {!isEdit && (
          <div role="group" aria-label="보기 필터" className="flex gap-[6px]">
            <Chip on={S.mineOnly} onClick={toggleMine}>
              내 것만
            </Chip>
            <Chip on={S.othersPersonal} onClick={toggleOthers}>
              팀원 목표
            </Chip>
          </div>
        )}
        <PillButton onClick={() => update({ closed: {} })}>모두 펼치기</PillButton>
        <PillButton onClick={() => update({ closed: allParentsClosed(tree.nodes) })}>모두 접기</PillButton>
        {canEdit && <Seg<CurMode> label="보기 모드" value={S.curMode} onChange={setMode} options={[["view", "보기"], ["edit", "편집"]]} />}
      </div>
      {isEdit && (
        <p className="m-0 text-[12px] text-muted">
          회차는 기간·대주제, 과제는 회차 안의 할 일이에요 · 회차나 과제를 누르면 편집 화면이 열려요.
          {isLeader ? " 개요 탭 멤버 관리에서 팀원에게 편집 권한을 줄 수 있어요." : " 그룹장이 준 편집 권한으로 고치고 있어요."}
          {" 개인 목표는 보기 모드에서 관리해요."}
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

      {/* 모서리 행은 컨테이너 안쪽 반경(16-1px)을 따라가야 선택 링(inset)이 둥근 클립에 잘리지 않는다.
          role="tree" 안에는 treeitem 만 — "회차 추가"·종료일 안내는 같은 테두리 상자 안, 트리 밖 (편집 모드에서는 그쪽이 맨 아래라 마지막 행을 둥글리지 않는다) */}
      <div className="min-w-0 overflow-hidden rounded-[16px] border border-line">
        <div role="tree" aria-label="진행목표" className={`[&>div:first-child>[role=treeitem]]:rounded-t-[15px] ${isEdit ? "" : "[&>div:last-child>[role=treeitem]]:rounded-b-[15px]"}`}>
          {entries.map((entry) => {
            if (entry.kind === "add")
              return S.quickAdd === entry.round.id ? (
                <QuickAdd key={`qa-${entry.round.id}`} round={entry.round} indent={1} onAdd={(t) => api.create(entry.round.id, { title: t, open: false })} onClose={() => closeAdd(entry.round.id)} inTree />
              ) : (
                <AddRow key={`add-${entry.round.id}`} round={entry.round} indent={1} onOpen={() => openAdd(entry.round.id)} inTree />
              );
            if (entry.kind === "padd") {
              const r = entry.round;
              // 한도 도달 — 추가 줄 대신 안내(트리 안에는 treeitem 만이라 비활성 treeitem 으로)
              if (atLimit(r.id))
                return (
                  <InfoRow key={`padd-${r.id}`} tone="personal" tabIndex={-1} data-limit={r.id}>
                    이 회차에는 개인 목표를 {limit}개까지 둘 수 있어요
                  </InfoRow>
                );
              return S.quickAdd === pKey(r.id) ? (
                <QuickAdd key={`pqa-${r.id}`} round={r} indent={1} tone="personal" onAdd={(t) => api.createPersonal(r.id, t)} onClose={() => closePAdd(r.id)} inTree />
              ) : (
                <AddRow key={`padd-${r.id}`} round={r} indent={1} tone="personal" onOpen={() => openPAdd(r.id)} inTree />
              );
            }
            if (entry.kind === "empty") return <InfoRow key={`empty-${entry.round.id}`}>이 회차에 내 항목이 없어요</InfoRow>;
            // 시안 C-2 — 남의 개인 목표 앞 소제목
            if (entry.kind === "others")
              return (
                <InfoRow key={`others-${entry.round.id}`} tone="heading">
                  {othersHeading(entry.count, entry.archived)}
                </InfoRow>
              );
            const n = entry.n;
            const open = !S.closed[n.id];
            const plan = removePlan(n);
            return (
              <div key={n.id}>
                <TreeRow
                  n={n}
                  isEdit={isEdit}
                  meId={meId}
                  open={open}
                  onToggle={() => toggle(n.id)}
                  onClick={() => {
                    if (isEdit) request({ sel: n.id });
                    else update({ viewSel: n.id, viewFocus: null });
                  }}
                  onAddChild={!n.leaf && n.d === 0 ? () => openAdd(n.id) : undefined}
                  onRemove={!n.temp && plan.kind !== "none" ? () => (asking?.id === n.id ? cancelAsk() : setAsk(n.id)) : undefined}
                  removeOff={n.temp ? "서버에 만드는 중…" : plan.kind === "none" ? plan.reason : undefined}
                  asking={asking?.id === n.id}
                  dragHandle={isEdit && n.d > 0 ? drag.handleProps(n.id) : undefined}
                  dropHint={hint?.id === n.id ? hint.half : null}
                  dragging={drag.dragging === n.id}
                  below={
                    asking?.id === n.id && plan.kind !== "none" ? (
                      <div className="border-t border-line-2 bg-surface px-3 py-2">
                        <InlineConfirm text={`‘${n.title || "제목 없는 항목"}’ — ${plan.text}`} onCancel={cancelAsk} actions={[{ label: plan.label, onClick: () => confirmRemove(n), tone: "danger" }]} />
                      </div>
                    ) : undefined
                  }
                />
              </div>
            );
          })}
        </div>
        {isEdit && (
          <button type="button" data-add-round onClick={addRound} className={`flex h-[50px] w-full items-center justify-center gap-[6px] bg-surface-3 text-[14px] font-semibold text-mint last:rounded-b-[15px] focus-visible:-outline-offset-2 ${entries.length === 0 ? "rounded-t-[15px]" : ""}`}>
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
