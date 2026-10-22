"use client";

import { useEffect, useRef } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { fileUrl } from "@/lib/api/submission";
import type { FileMeta, Submission } from "@/lib/api/types";
import { useHashTarget } from "@/lib/hashTarget";
import { useMe } from "@/lib/me";
import { CODE_STATUS, type LeafNode } from "../model";
import { focusTargetOf, myBadgeOf, myCardStateOf, notAssignedText, panelSubOf, showAllSubmitted, statusRows, type RoomStatus, type StatusRow } from "../submission";
import { useTaskDetail } from "../useTaskDetail";
import { useRoomArchived } from "../roomArchived";
import { MySubmissionCard } from "./MySubmissionCard";
import { SubmissionStatusList } from "./SubmissionStatusList";
import { SubmitPanel } from "./SubmitPanel";

export type SubmissionSectionProps = {
  n: LeafNode;
  slug: string;
  roomStatus: RoomStatus;
  /** "submission" = 보드·캘린더·간트·알림 진입 — 응답이 오면 제출 영역으로 한 번 포커스 */
  focus: "submission" | null;
  onFocused: () => void;
  /** 제출 성공 — 커리큘럼(보드·간트·개요의 사람별 코드) 재조회 */
  onSubmitted: () => void;
  toast: (m: ToastMsg) => void;
  /** 승인 대기자 — 다른 사람 제출물을 볼 수 없다 */
  viewerPending: boolean;
  onUploadingChange: (uploading: boolean) => void;
  isLeader?: boolean;
  /** 과제를 하지 않는 그룹장 — "담당 과제가 아니에요" 안내 생략 */
  quietNotAssigned?: boolean;
};

/** 과제 상세의 제출 영역 — 전원 제출 배너 · 내 제출 카드 · 제출 현황 (스펙 §2.1) */
export function SubmissionSection({ n, slug, roomStatus, focus, onFocused, onSubmitted, toast, viewerPending, onUploadingChange, isLeader = false, quietNotAssigned = false }: SubmissionSectionProps) {
  const meId = useMe()?.id ?? null;
  const { detail, error, loading, refetch, setMine } = useTaskDetail(slug, n.id);
  const mineRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);

  const roomArchived = useRoomArchived();
  const card = detail ? myCardStateOf(detail, roomStatus, roomArchived) : null;
  // 응답이 오면(또는 실패하면) 한 번만 제출 영역으로 — 그 뒤 viewFocus 를 지운다 (Review Focus 6)
  const settled = !!detail || !!error;
  // 알림 딥링크 #submissions(전원 제출·제출 요약): 내 카드가 아니라 제출 현황으로 (시나리오 QA D4)
  const toStatus = useHashTarget("submissions", settled);
  useEffect(() => {
    if (focus !== "submission" || !settled) return;
    const target = !toStatus && card && focusTargetOf(card) === "mine" ? mineRef.current : statusRef.current;
    const el = target ?? statusRef.current;
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, settled]);

  // 내 줄이 아닌 현황 — 응답 전에는 트리 people(상태만, 펼침 없음)
  const rows: StatusRow[] = detail
    ? statusRows(detail, meId)
    : n.people.map((p) => ({ userId: p.userId, name: p.name, tone: p.tone, status: CODE_STATUS[p.c], me: p.userId === meId, released: false, submission: null }));
  const personal = n.personal;
  const task = detail?.node.task;
  const sub = task ? task.submitted : n.sub;
  const asg = task ? task.assigned : n.asg;
  const note = viewerPending
    ? "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요"
    : n.archived && !isLeader
      ? personal
        ? "보관된 목표예요 · 완료 내용은 그룹장과 작성자만 볼 수 있어요"
        : "보관된 과제예요 · 제출물은 그룹장과 작성자만 볼 수 있어요"
      : null;

  // 서명 URL 은 첨부(download)라 새 탭을 열면 빈 탭만 남는다 — 지금 페이지에서 내려받는다
  const openFile = async (f: FileMeta) => {
    try {
      const a = document.createElement("a");
      a.href = await fileUrl(f);
      a.rel = "noopener";
      a.download = f.name;
      a.click();
    } catch {
      toast({ text: "파일을 열 수 없어요", tone: "bad" });
    }
  };
  const saved = (s: Submission) => {
    setMine(s);
    refetch();
    onSubmitted();
  };

  const panelSub = panelSubOf(personal, detail?.node.endDate ?? n.e);
  // 위: 내 제출 면(불러오는 중·실패도 같은 면 안에서) · 아래: 담당자별 제출 현황(구분선 아래 따로)
  return (
    <div className="flex flex-col gap-6">
      {loading && (
        <SubmitPanel id="my-sub-title" title="내 제출" sub={panelSub} icon="submit">
          <div aria-busy="true" aria-label="내 제출 불러오는 중" className="flex flex-col gap-3">
            <div className="h-5 w-24 rounded-[6px] bg-line-2" />
            <div className="h-[120px] rounded-[10px] bg-surface" />
          </div>
        </SubmitPanel>
      )}
      {!detail && error && (
        <SubmitPanel id="my-sub-title" title="내 제출" sub={panelSub} icon="submit">
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <span className="min-w-0 flex-[1_1_200px]">제출 정보를 불러오지 못했어요</span>
            <button type="button" onClick={refetch} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
              다시 시도
            </button>
          </div>
        </SubmitPanel>
      )}
      {detail && card && meId && card.kind !== "hidden" && (
        <MySubmissionCard
          key={n.id}
          detail={detail}
          nodeId={n.id}
          userId={meId}
          state={card}
          badge={myBadgeOf(detail)}
          personal={personal}
          sub={panelSub}
          onSaved={saved}
          onRefetch={refetch}
          onOpenFile={openFile}
          toast={toast}
          headingRef={mineRef}
          onUploadingChange={onUploadingChange}
        />
      )}
      <div className="flex flex-col gap-3 border-t border-line-2 pt-5">
        {detail && card?.kind === "hidden" && !quietNotAssigned && <p className="m-0 text-[13px] text-muted">{notAssignedText(personal)}</p>}
        {detail && showAllSubmitted(detail) && (
          <div role="status" className="flex items-center gap-2 rounded-[12px] border border-[#BFE6D4] bg-[#E3F5EC] px-[14px] py-3 text-[13px] font-semibold text-[#1A7F55]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            모든 담당자가 제출했어요
          </div>
        )}
        <SubmissionStatusList rows={rows} sub={sub} asg={asg} note={note} archived={n.archived} personal={personal} headingRef={statusRef} onOpenFile={openFile} />
      </div>
    </div>
  );
}
