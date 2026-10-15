"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import {
  absoluteUrl,
  approveApplicant,
  fetchApplications,
  fetchInvite,
  leaderErrorText,
  openRecruit,
  openRecruitNote,
  rejectApplicant,
  rotateInvite,
  showApplications,
  startRoom,
  statusActionOf,
  statusStepLabel,
  type Applicant,
} from "@/lib/api/leader";
import type { MembershipResult, RoomDetail } from "@/lib/api/types";

type Detail = Pick<RoomDetail, "slug" | "status" | "archived" | "isPublic" | "joinMode" | "pendingCount" | "invite">;
/** onDetail/onMembership: 화면이 RoomDetail 을 state 로 들고 있으면(방 화면) 응답으로 바로 교체. 어느 쪽이든 끝나면 router.refresh */
type Props = { detail: Detail; toast: (m: ToastMsg) => void; onDetail?: (d: RoomDetail) => void; onMembership?: (r: MembershipResult) => void };

const PRIMARY = "flex h-11 w-full items-center justify-center rounded-[22px] text-[14px] font-semibold text-white disabled:opacity-60";
const SECONDARY = "flex h-11 items-center justify-center gap-[6px] rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60";

/** 그룹장 패널 (plan 06 P0) — 모집 시작 / 지금 시작 · 초대 링크 · 승인 대기. 그룹장에게만 렌더한다 */
export function LeaderPanel({ detail, toast, onDetail, onMembership }: Props) {
  const router = useRouter();
  const action = statusActionOf(detail);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"start" | "rotate" | null>(null);
  const [inviteUrl, setInviteUrl] = useState(detail.invite?.url ?? null);

  const runStatus = async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      const d = action === "openRecruit" ? await openRecruit(detail.slug) : await startRoom(detail.slug);
      onDetail?.(d);
      const unassigned = "warnings" in d ? (d as { warnings: unknown[] }).warnings.length : 0;
      toast({
        text: action === "openRecruit" ? "모집을 시작했어요" : unassigned > 0 ? `스터디를 시작했어요 · 담당자 없는 과제 ${unassigned}개` : "스터디를 시작했어요",
        tone: "ok",
      });
      router.refresh(); // 상태 배지(준비중→모집중→진행중)·사이드바·탭 재동기화
    } catch (e) {
      const err = toApiError(e);
      toast({ text: leaderErrorText(err.code, err.message), tone: "bad" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const copyInvite = async () => {
    try {
      // room_get 은 이미 있는 링크만 준다 — 없으면 invite_get 이 만든다
      const url = inviteUrl ?? (await fetchInvite(detail.slug)).url;
      setInviteUrl(url);
      await navigator.clipboard.writeText(absoluteUrl(url, window.location.origin));
      toast({ text: "초대 링크를 복사했어요", tone: "ok" });
    } catch (e) {
      const err = toApiError(e);
      toast({ text: err.code ? leaderErrorText(err.code, err.message) : "링크를 복사하지 못했어요", tone: "bad" });
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await rotateInvite(detail.slug);
      setInviteUrl(r.url);
      await navigator.clipboard.writeText(absoluteUrl(r.url, window.location.origin)).catch(() => undefined);
      toast({ text: "새 초대 링크를 만들어 복사했어요 · 이전 링크는 더 이상 열리지 않아요", tone: "ok" });
    } catch (e) {
      const err = toApiError(e);
      toast({ text: leaderErrorText(err.code, err.message), tone: "bad" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <section aria-labelledby="leader-panel-title" className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5 shadow-[0_10px_30px_rgba(27,34,48,.06)]">
      <div className="flex items-center justify-between gap-2">
        <h3 id="leader-panel-title" className="m-0 text-[14px] font-bold">
          그룹장 패널
        </h3>
        <span className="rounded-[7px] bg-bg px-2 py-[2px] text-[12px] font-semibold text-ink-3">지금 {statusStepLabel(detail.status)}</span>
      </div>

      {action === "openRecruit" && (
        <div className="flex flex-col gap-[6px]">
          <button type="button" onClick={() => void runStatus()} disabled={busy} className={`${PRIMARY} bg-navy`}>
            모집 시작
          </button>
          <span className="text-[12px] leading-[1.5] text-muted">
            지금은 준비중이라 아무도 찾거나 참가할 수 없어요. 모집을 시작하면 {openRecruitNote(detail)}
          </span>
        </div>
      )}
      {action === "start" && (
        <div className="flex flex-col gap-[6px]">
          <button type="button" onClick={() => setConfirm("start")} disabled={busy} className={`${PRIMARY} bg-mint`}>
            지금 시작
          </button>
          <span className="text-[12px] leading-[1.5] text-muted">시작일을 오늘로 당기고 진행중으로 바꿔요</span>
        </div>
      )}

      <div className="flex flex-col gap-[6px]">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copyInvite()} disabled={busy} className={`${SECONDARY} flex-1 whitespace-nowrap`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
              <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
            초대 링크 복사
          </button>
          <button type="button" onClick={() => setConfirm("rotate")} disabled={busy} className="h-11 whitespace-nowrap rounded-[22px] px-3 text-[13px] font-medium text-ink-3 underline-offset-2 hover:underline disabled:opacity-60">
            새 링크로 바꾸기
          </button>
        </div>
        <span className="text-[12px] leading-[1.5] text-muted">
          {detail.status === "draft"
            ? "모집을 시작하면 이 링크로 들어올 수 있어요"
            : detail.isPublic
              ? "링크를 받은 사람은 바로 이 방으로 와요"
              : "비공개 방이라 이 링크를 받은 사람만 들어올 수 있어요"}
        </span>
      </div>

      {showApplications(detail) && <Applications slug={detail.slug} initialCount={detail.pendingCount} toast={toast} onMembership={onMembership} />}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "start" ? "지금 스터디를 시작할까요?" : "초대 링크를 새로 만들까요?"}
        body={
          confirm === "start"
            ? "시작일이 오늘로 바뀌고 진행중이 돼요. 이후에는 새 참가를 받지 않고, 승인 대기 중인 신청은 만료돼요."
            : "지금 링크는 더 이상 열리지 않아요. 이미 참가한 사람에게는 영향이 없어요."
        }
        confirmLabel={confirm === "start" ? "지금 시작" : "새 링크 만들기"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void (confirm === "start" ? runStatus() : rotate())}
      />
    </section>
  );
}

/** 승인 대기 — 승인·거절은 낙관적으로 줄을 빼고, 실패하면 되돌린다 */
function Applications({ slug, initialCount, toast, onMembership }: { slug: string; initialCount: number; toast: (m: ToastMsg) => void; onMembership?: (r: MembershipResult) => void }) {
  const router = useRouter();
  const [items, setItems] = useState<Applicant[] | null>(null);
  const [error, setError] = useState("");
  const busyRef = useRef(new Set<string>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    fetchApplications(slug)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(toApiError(e).message));
    return () => {
      live = false;
    };
  }, [slug, initialCount]);

  const decide = async (a: Applicant, ok: boolean) => {
    if (busyRef.current.has(a.userId)) return;
    busyRef.current.add(a.userId);
    setBusy((p) => ({ ...p, [a.userId]: true }));
    const before = items;
    setItems((list) => list?.filter((x) => x.userId !== a.userId) ?? null);
    try {
      const r = await (ok ? approveApplicant(slug, a.userId) : rejectApplicant(slug, a.userId));
      onMembership?.(r);
      toast({ text: ok ? `${a.nickname} 님의 참가를 승인했어요` : `${a.nickname} 님의 신청을 거절했어요`, tone: "ok" });
      router.refresh();
    } catch (e) {
      const err = toApiError(e);
      // 이미 처리된 신청은 목록에서 빠진 게 맞다 — 그 외에는 되돌린다
      if (err.code !== "ALREADY_DECIDED" && err.code !== "NOT_FOUND") setItems(before);
      toast({ text: leaderErrorText(err.code, err.message), tone: "bad" });
    } finally {
      busyRef.current.delete(a.userId);
      setBusy(({ [a.userId]: _done, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
  };

  const count = items?.length ?? initialCount;
  return (
    <div className="flex flex-col gap-2 border-t border-line-2 pt-4">
      <div className="flex items-center gap-2">
        <h4 className="m-0 text-[13px] font-bold">승인 대기</h4>
        <span aria-label={`승인 대기 ${count}명`} className={`flex h-5 min-w-5 items-center justify-center rounded-[10px] px-[6px] text-[11px] font-bold ${count > 0 ? "bg-danger text-white" : "bg-slate-soft text-ink-3"}`}>
          {count}
        </span>
      </div>
      {error && <p role="alert" className="m-0 text-[12px] text-warn">{error}</p>}
      {items === null && !error && <p className="m-0 text-[12px] text-muted">불러오는 중…</p>}
      {items?.length === 0 && <p className="m-0 text-[12px] text-muted">아직 신청한 사람이 없어요</p>}
      {items && items.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((a) => (
            <li key={a.userId} className="flex min-h-11 flex-wrap items-center gap-[10px] border-t border-line py-1 first:border-t-0">
              <Avatar name={a.nickname} size={28} tone={a.tone} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{a.nickname}</span>
              <span className="flex gap-[6px]">
                <button type="button" aria-label={`${a.nickname} 승인`} onClick={() => void decide(a, true)} disabled={!!busy[a.userId]} className="h-9 rounded-[18px] bg-navy px-3 text-[13px] font-semibold text-white disabled:opacity-60">
                  승인
                </button>
                <button type="button" aria-label={`${a.nickname} 거절`} onClick={() => void decide(a, false)} disabled={!!busy[a.userId]} className="h-9 rounded-[18px] border border-line-3 bg-surface px-3 text-[13px] font-medium text-ink disabled:opacity-60">
                  거절
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
