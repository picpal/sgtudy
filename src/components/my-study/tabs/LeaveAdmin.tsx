"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChoiceList } from "@/components/ui/ChoiceList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import {
  deactivateMember,
  decisionsOf,
  dismissLeaveRequest,
  fetchLeaveRequests,
  initialChoices,
  leaveErrorText,
  missingChoices,
  previewDeactivate,
  reassignCandidates,
  requestedOn,
  type DeactivatePreview,
  type LeaveChoices,
  type LeaveRequestItem,
} from "@/lib/api/leave";
import type { Person, RoomMemberDto } from "@/lib/api/types";
import { useHashTarget } from "@/lib/hashTarget";

type Props = {
  slug: string;
  today: string;
  members: RoomMemberDto[];
  leaderDoesTasks: boolean;
  /** room_get.leaveRequestCount — 0 이면 목록을 부르지 않는다 */
  leaveRequestCount: number;
  toast: (m: ToastMsg) => void;
};

type Dialog =
  | { kind: "dismiss"; item: LeaveRequestItem }
  | { kind: "pick"; userId: string }
  | { kind: "plan"; user: Person; preview: DeactivatePreview | null; choices: LeaveChoices };

const BTN = "h-11 rounded-[22px] px-4 text-[13px] font-semibold disabled:opacity-60";

/**
 * 진행 중 나가기 — 그룹장 쪽 (시나리오 QA D3). 멤버 관리 카드 안에 붙는다(진행중·미보관 방만).
 * 탈퇴 요청 목록(#leave-requests 알림 앵커): [내보내기] · [반려]. 요청이 없어도 [팀원 내보내기] 로 고른 팀원을 내보낸다.
 * 내보내기 = member_deactivate_preview → 미제출 지정 과제마다 "담당에서 빼기 / 다른 팀원에게 맡기기" → member_deactivate. 제출 기록은 남는다.
 */
export function LeaveAdmin({ slug, today, members, leaderDoesTasks, leaveRequestCount, toast }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<LeaveRequestItem[] | null>(leaveRequestCount > 0 ? null : []);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const hit = useHashTarget("leave-requests", items !== null || !!error);

  useEffect(() => {
    if (leaveRequestCount === 0) return;
    let live = true;
    fetchLeaveRequests(slug)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(toApiError(e).message));
    return () => {
      live = false;
    };
  }, [slug, leaveRequestCount]);

  const others = members.filter((m) => m.role === "member" && m.status === "active");
  const close = () => !busy && setDialog(null);

  const openPlan = async (user: Person) => {
    setDialog({ kind: "plan", user, preview: null, choices: {} });
    try {
      const preview = await previewDeactivate(slug, user.userId);
      setDialog({ kind: "plan", user, preview, choices: initialChoices(preview) });
    } catch (e) {
      const err = toApiError(e);
      setDialog(null);
      toast({ text: leaveErrorText(err.code, err.message), tone: "bad" });
    }
  };

  const run = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    try {
      if (dialog.kind === "dismiss") {
        const r = await dismissLeaveRequest(slug, dialog.item.userId);
        setItems(r.items);
        toast({ text: `${dialog.item.nickname} 님의 탈퇴 요청을 반려했어요 · 계속 참가 중이에요`, tone: "ok" });
      } else if (dialog.kind === "plan" && dialog.preview) {
        await deactivateMember(slug, dialog.user.userId, decisionsOf(dialog.preview, dialog.choices));
        setItems((list) => list?.filter((x) => x.userId !== dialog.user.userId) ?? list);
        const n = dialog.preview.tasks.length;
        toast({ text: `${dialog.user.nickname} 님을 내보냈어요${n > 0 ? ` · 맡은 과제 ${n}개를 정리했어요` : ""}`, tone: "ok" });
      }
      setDialog(null);
      router.refresh(); // 참가자 목록(이탈)·담당·요청 수
    } catch (e) {
      const err = toApiError(e);
      toast({ text: leaveErrorText(err.code, err.message), tone: "bad" });
      // 요청이 그새 취소·처리됐으면 목록을 다시 받는다
      if (err.code === "NOT_FOUND" || err.code === "MEMBER_NOT_ACTIVE") {
        setDialog(null);
        fetchLeaveRequests(slug).then((r) => setItems(r.items), () => undefined);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const showList = leaveRequestCount > 0 || (items?.length ?? 0) > 0 || hit;

  return (
    <div className="flex flex-col gap-3 border-t border-line-2 pt-3">
      {showList && (
        <div id="leave-requests" tabIndex={-1} className="flex scroll-mt-4 flex-col gap-2 outline-none">
          <div className="flex items-center gap-2">
            <h4 className="m-0 text-[13px] font-bold">탈퇴 요청</h4>
            <span className={`flex h-5 min-w-5 items-center justify-center rounded-[10px] px-[6px] text-[11px] font-bold ${(items?.length ?? leaveRequestCount) > 0 ? "bg-danger text-white" : "bg-slate-soft text-ink-3"}`}>
              {items?.length ?? leaveRequestCount}
            </span>
          </div>
          {error && <p role="alert" className="m-0 text-[12px] text-warn">{error}</p>}
          {items === null && !error && <p className="m-0 text-[12px] text-muted">불러오는 중…</p>}
          {items?.length === 0 && <p className="m-0 text-[12px] text-muted">지금 처리할 탈퇴 요청이 없어요</p>}
          {items && items.length > 0 && (
            <ul className="m-0 flex list-none flex-col p-0">
              {items.map((it) => (
                <li key={it.userId} data-leave-row={it.userId} className="flex flex-wrap items-center gap-[10px] border-t border-line py-2 first:border-t-0">
                  <Avatar name={it.nickname} size={28} tone={it.tone} id={it.userId} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold">{it.nickname}</span>
                    <span className="text-[12px] text-muted">
                      {requestedOn(it.requestedAt, today)} 요청{it.pendingTaskCount > 0 ? ` · 미제출 지정 과제 ${it.pendingTaskCount}개` : ""}
                    </span>
                  </span>
                  {it.reason && <p className="m-0 basis-full whitespace-pre-wrap break-words rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] leading-[1.5] text-ink-2">{it.reason}</p>}
                  <span className="flex basis-full justify-end gap-[6px]">
                    <button type="button" aria-label={`${it.nickname} 탈퇴 요청 반려`} onClick={() => setDialog({ kind: "dismiss", item: it })} disabled={busy} className={`${BTN} border border-line-3 bg-surface font-medium text-ink`}>
                      반려
                    </button>
                    <button type="button" aria-label={`${it.nickname} 내보내기`} onClick={() => void openPlan(it)} disabled={busy} className={`${BTN} bg-danger text-white`}>
                      내보내기
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {others.length > 0 && (
        <button type="button" onClick={() => setDialog({ kind: "pick", userId: others[0].userId })} className="inline-flex min-h-11 items-center self-start rounded-[10px] px-1 text-[13px] font-semibold text-ink-3 hover:text-danger">
          팀원 내보내기
        </button>
      )}

      {dialog?.kind === "dismiss" && (
        <ConfirmDialog
          open
          title={`${dialog.item.nickname} 님의 탈퇴 요청을 반려할까요?`}
          body={`${dialog.item.nickname} 님은 계속 참가 중으로 남고, 반려됐다는 알림이 가요. 다시 요청할 수 있어요.`}
          confirmLabel="반려"
          busy={busy}
          onConfirm={() => void run()}
          onCancel={close}
        />
      )}
      {dialog?.kind === "pick" && (
        <ConfirmDialog
          open
          title="누구를 내보낼까요?"
          body="다음 단계에서 그 팀원이 맡은 미제출 과제를 어떻게 할지 정해요."
          confirmLabel="다음"
          onConfirm={() => {
            const m = others.find((x) => x.userId === dialog.userId);
            if (m) void openPlan(m);
          }}
          onCancel={close}
        >
          <ChoiceList legend="내보낼 팀원" value={dialog.userId} onChange={(userId) => setDialog({ kind: "pick", userId })} choices={others.map((m) => ({ key: m.userId, label: m.nickname }))} />
        </ConfirmDialog>
      )}
      {dialog?.kind === "plan" && (
        <ConfirmDialog
          open
          title={`${dialog.user.nickname} 님을 내보낼까요?`}
          body={`참가자 목록에서 '이탈'로 바뀌고 과제 담당에서 빠져요. 지금까지 낸 제출 기록은 남아요. 내보낸 뒤에는 되돌릴 수 없어요.`}
          confirmLabel="내보내기"
          danger
          busy={busy}
          confirmDisabled={!dialog.preview || missingChoices(dialog.preview, dialog.choices).length > 0}
          onConfirm={() => void run()}
          onCancel={close}
        >
          <PlanList dialog={dialog} members={members} leaderDoesTasks={leaderDoesTasks} onChoose={(nodeId, v) => setDialog({ ...dialog, choices: { ...dialog.choices, [nodeId]: v } })} />
        </ConfirmDialog>
      )}
    </div>
  );
}

/** 미제출 지정 과제마다 처리 방법 — 다른 담당이 있으면 빼기만 해도 되고, 혼자 맡았으면 맡길 사람을 고른다 */
function PlanList({ dialog, members, leaderDoesTasks, onChoose }: { dialog: Extract<Dialog, { kind: "plan" }>; members: RoomMemberDto[]; leaderDoesTasks: boolean; onChoose: (nodeId: string, v: string) => void }) {
  if (!dialog.preview) return <p className="m-0 text-[13px] text-muted">맡은 과제를 확인하는 중…</p>;
  if (dialog.preview.tasks.length === 0) return <p className="m-0 rounded-[12px] bg-surface-2 px-3 py-[10px] text-[13px] text-ink-2">미제출 지정 과제가 없어요 · 바로 내보낼 수 있어요</p>;
  const all = reassignCandidates(members, dialog.user.userId, leaderDoesTasks);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[13px] font-semibold text-ink-2">맡은 미제출 지정 과제 {dialog.preview.tasks.length}개</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {dialog.preview.tasks.map((t) => {
          const others = t.currentAssignees;
          const cands = all.filter((c) => !others.some((o) => o.userId === c.userId));
          const id = `leave-plan-${t.nodeId}`;
          return (
            <li key={t.nodeId} className="flex flex-col gap-[6px] rounded-[12px] border border-line px-3 py-[10px]">
              <label htmlFor={id} className="text-[14px] font-semibold text-ink">
                {t.roundLabel ? `${t.roundLabel} · ${t.title}` : t.title}
              </label>
              <span className="text-[12px] text-muted">{others.length > 0 ? `다른 담당 ${others.map((o) => o.nickname).join(", ")}` : "혼자 맡은 과제예요 · 다른 팀원에게 맡겨야 해요"}</span>
              <select
                id={id}
                value={dialog.choices[t.nodeId] ?? ""}
                onChange={(e) => onChoose(t.nodeId, e.target.value)}
                className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink"
              >
                {others.length > 0 ? <option value="exclude">담당에서 빼기</option> : <option value="">맡길 사람 고르기</option>}
                {cands.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.nickname} 님에게 맡기기
                  </option>
                ))}
              </select>
              {others.length === 0 && cands.length === 0 && <span className="text-[12px] text-warn">맡길 수 있는 팀원이 없어요 · 과제를 지우거나 공통 과제로 바꾼 뒤 내보내 주세요</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
