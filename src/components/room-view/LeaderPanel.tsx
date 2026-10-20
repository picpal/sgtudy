"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChoiceList } from "@/components/ui/ChoiceList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { useHashTarget } from "@/lib/hashTarget";
import { useRefocusOnClose } from "@/lib/useRefocusOnClose";
import { mmdd, ymd } from "@/lib/api/format";
import { formatCode, inviteNote } from "@/lib/api/recruit";
import {
  absoluteUrl,
  approveApplicant,
  earlyStartDays,
  fetchApplications,
  fetchInvite,
  leaderErrorText,
  openRecruit,
  openRecruitNote,
  rejectApplicant,
  rotateInvite,
  shiftChoiceText,
  showApplications,
  startDoneText,
  startBlockOf,
  startRoom,
  statusActionOf,
  statusStepLabel,
  type Applicant,
} from "@/lib/api/leader";
import type { MembershipResult, RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { EndDateForm } from "./EndDateForm";

type Detail = Pick<RoomDetail, "today" | "slug" | "status" | "archived" | "isPublic" | "joinMode" | "pendingCount" | "invite" | "startDate" | "endDate"> & { recruit?: RoomDetail["recruit"]; stats?: Pick<RoomDetail["stats"], "unassignedCount"> };
/** onDetail/onMembership: 화면이 RoomDetail 을 state 로 들고 있으면(방 화면) 응답으로 바로 교체. 어느 쪽이든 끝나면 router.refresh */
type Props = { detail: Detail; toast: (m: ToastMsg) => void; onDetail?: (d: RoomDetail) => void; onMembership?: (r: MembershipResult) => void };

const PRIMARY = "flex h-11 w-full items-center justify-center rounded-[22px] text-[14px] font-semibold text-white disabled:opacity-60";
const SECONDARY = "flex h-11 items-center justify-center gap-[6px] rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60";

/** 그룹장 패널 (plan 06 P0) — 모집 시작 / 지금 시작 · 초대 링크 · 승인 대기. 그룹장에게만 렌더한다 */
export function LeaderPanel({ detail, toast, onDetail, onMembership }: Props) {
  const router = useRouter();
  const action = statusActionOf(detail);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"open" | "start" | "rotate" | null>(null);
  const [inviteUrl, setInviteUrl] = useState(detail.invite?.url ?? null);
  const [inviteCode, setInviteCode] = useState(detail.invite?.code ?? null);
  // 예정보다 일찍 시작 — 일정을 오늘로 당길지 (시나리오 QA D1, 기본 당기기). 0 이면 묻지 않는다
  const early = earlyStartDays(detail);
  const [shift, setShift] = useState<"shift" | "keep">("shift");
  // "지금 시작"이 1년 상한에 막힘(0016 — 일찍 시작하면 시작일이 오늘로 당겨진다): 전용 안내를 패널에 남기고 종료일 바꾸기로 잇는다
  const [block, setBlock] = useState<{ text: string; maxEndDate: string | null } | null>(null);
  const [editEnd, setEditEnd] = useState(false);
  const refocusEnd = useRefocusOnClose(editEnd);
  const cancelEnd = () => {
    refocusEnd(() => document.querySelector<HTMLButtonElement>("[data-start-block] [data-edit-end]"));
    setEditEnd(false);
  };

  const runStatus = async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action === "openRecruit") {
        const d = await openRecruit(detail.slug); // onDetail?.(await …) 로 쓰면 onDetail 이 없을 때 호출 자체가 빠진다
        onDetail?.(d);
        toast({ text: "모집을 시작했어요", tone: "ok" });
      } else {
        const d = await startRoom(detail.slug, { shift: early > 0 && shift === "shift" });
        onDetail?.(d);
        toast({ text: startDoneText(d), tone: "ok" });
      }
      router.refresh(); // 상태 배지(준비중→모집중→진행중)·사이드바·탭 재동기화
    } catch (e) {
      const err = toApiError(e);
      const b = action === "start" ? startBlockOf(err) : null;
      if (b) {
        setBlock(b);
        setEditEnd(false);
      } else toast({ text: leaderErrorText(err.code, err.message), tone: "bad" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const onEndSaved = (d: RoomDetail) => {
    onDetail?.(d);
    setBlock(null);
    setEditEnd(false);
    toast({ text: "종료일을 바꿨어요 · 이제 지금 시작할 수 있어요", tone: "ok" });
    router.refresh();
  };

  const copyInvite = async () => {
    try {
      // room_get 은 이미 있는 링크만 준다 — 없으면 invite_get 이 만든다
      let url = inviteUrl;
      if (!url || !inviteCode) {
        const r = await fetchInvite(detail.slug);
        url = r.url;
        setInviteCode(r.code);
      }
      setInviteUrl(url);
      await navigator.clipboard.writeText(absoluteUrl(url, window.location.origin));
      toast({ text: "초대 링크를 복사했어요", tone: "ok" });
    } catch (e) {
      const err = toApiError(e);
      toast({ text: err.code ? leaderErrorText(err.code, err.message) : "링크를 복사하지 못했어요", tone: "bad" });
    }
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      toast({ text: "초대 코드를 복사했어요", tone: "ok" });
    } catch {
      toast({ text: "코드를 복사하지 못했어요", tone: "bad" });
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await rotateInvite(detail.slug);
      setInviteUrl(r.url);
      setInviteCode(r.code);
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
        <span className="flex items-center gap-1">
          <span className="rounded-[7px] bg-bg px-2 py-[2px] text-[12px] font-semibold text-ink-3">지금 {detail.archived ? "보관됨" : statusStepLabel(detail.status)}</span>
          {detail.recruit?.extraUntil && (
            <span className="rounded-[7px] bg-[#E3ECFD] px-2 py-[2px] text-[12px] font-semibold text-[#2F5BC2]">추가 모집 ~{mmdd(detail.recruit.extraUntil)}</span>
          )}
          {/* 방 정보·태그·기간 수정, 삭제·보관 (Q3-1·Q2-2) */}
          <Link href={routes.roomSettings(detail.slug, routes.room(detail.slug))} className="-mr-2 inline-flex h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] font-semibold text-ink-3 hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
            방 설정
          </Link>
        </span>
      </div>

      {action === "openRecruit" && (
        <div className="flex flex-col gap-[6px]">
          <button type="button" onClick={() => setConfirm("open")} disabled={busy} className={`${PRIMARY} bg-navy`}>
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
          <span className="text-[12px] leading-[1.5] text-muted">
            {early > 0 ? `진행중으로 바꿔요 · 예정 시작일(${mmdd(detail.startDate)})보다 ${early}일 일찍이라 일정을 당길지 골라요` : "진행중으로 바꿔요"}
          </span>
          {block && (
            <div data-start-block role="alert" className="mt-1 flex flex-col gap-2 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-3 text-[13px] font-medium leading-[1.5] text-[#6B4700]">
              <span>{block.text}</span>
              {editEnd ? (
                <EndDateForm
                  slug={detail.slug}
                  initial={block.maxEndDate && block.maxEndDate < detail.endDate ? block.maxEndDate : detail.endDate}
                  max={block.maxEndDate ?? undefined}
                  hint={`지금 종료일 ${ymd(detail.endDate)}`}
                  onSaved={onEndSaved}
                  onCancel={cancelEnd}
                />
              ) : (
                <button type="button" data-edit-end onClick={() => setEditEnd(true)} className="h-11 self-start rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink">
                  종료일 바꾸기
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 담당 미정 과제(지정 과제 담당 0명 — 내보내기 "담당 미정으로 두기" 등, 0027) → 진행목표 편집으로 */}
      {!detail.archived && detail.status !== "ended" && (detail.stats?.unassignedCount ?? 0) > 0 && (
        <p data-unassigned role="note" className="m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-1 text-[13px] font-medium leading-[1.5] text-[#6B4700]">
          <span className="py-2">담당 미정 과제 {detail.stats!.unassignedCount}개 · 담당자를 정해 주세요</span>
          <Link href={routes.myStudyEdit(detail.slug)} className="inline-flex min-h-11 items-center font-semibold text-[#6B4700] underline underline-offset-2">
            진행목표 편집 →
          </Link>
        </p>
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
          {inviteCode && (
            <button type="button" onClick={() => void copyCode()} disabled={busy} className={`${SECONDARY} whitespace-nowrap font-mono`}>
              코드 {formatCode(inviteCode)} 복사
            </button>
          )}
          <button type="button" onClick={() => setConfirm("rotate")} disabled={busy} className="h-11 whitespace-nowrap rounded-[22px] px-3 text-[13px] font-medium text-ink-3 underline-offset-2 hover:underline disabled:opacity-60">
            새 링크로 바꾸기
          </button>
        </div>
        <span className="text-[12px] leading-[1.5] text-muted">
          {inviteNote(detail)}
          {detail.status === "active" && !detail.recruit?.open && !detail.invite?.bypass?.active && (
            <>
              {" "}
              <Link href={routes.roomSettings(detail.slug, routes.room(detail.slug))} className="inline-flex min-h-11 items-center font-semibold text-ink-3 underline underline-offset-2">
                방 설정 →
              </Link>
            </>
          )}
        </span>
      </div>

      {showApplications(detail) && <Applications slug={detail.slug} initialCount={detail.pendingCount} toast={toast} onMembership={onMembership} />}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "open" ? "모집을 시작할까요?" : confirm === "start" ? "지금 스터디를 시작할까요?" : "초대 링크를 새로 만들까요?"}
        body={
          confirm === "open"
            ? `모집을 시작하면 ${openRecruitNote(detail)}. 모집중에도 방 설정에서 공개 여부·참가 방식을 바꿀 수 있어요.`
            : confirm === "start"
              ? `${early > 0 ? `예정 시작일 ${mmdd(detail.startDate)}보다 ${early}일 일찍 시작해요. ` : ""}진행중이 되면 새 참가는 방 설정의 추가 모집·바로 참가로만 받고, 승인 대기 중인 신청은 만료돼요.`
              : "지금 링크는 더 이상 열리지 않아요. 이미 참가한 사람에게는 영향이 없어요."
        }
        confirmLabel={confirm === "open" ? "모집 시작" : confirm === "start" ? "지금 시작" : "새 링크 만들기"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void (confirm === "rotate" ? rotate() : runStatus())}
      >
        {confirm === "start" && early > 0 && (
          <ChoiceList
            legend="일정을 어떻게 할까요"
            value={shift}
            onChange={setShift}
            choices={(["shift", "keep"] as const).map((k) => ({ key: k, ...shiftChoiceText(early, detail.startDate)[k] }))}
          />
        )}
      </ConfirmDialog>
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
  // 참가 신청 알림 딥링크 /my-study/{slug}#applications — 목록이 오면 여기로 (시나리오 QA #8)
  useHashTarget("applications", items !== null || !!error);
  return (
    <div id="applications" role="region" tabIndex={-1} aria-labelledby="applications-title" className="flex scroll-mt-4 flex-col gap-2 border-t border-line-2 pt-4 outline-none">
      <div className="flex items-center gap-2">
        <h4 id="applications-title" className="m-0 text-[13px] font-bold">승인 대기</h4>
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
            <li key={a.userId} data-applicant={a.userId} className="flex min-h-11 flex-wrap items-center gap-[10px] border-t border-line py-1 first:border-t-0">
              <Avatar name={a.nickname} size={28} tone={a.tone} id={a.userId} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{a.nickname}</span>
              <span className="flex gap-[6px]">
                <button type="button" aria-label={`${a.nickname} 승인`} onClick={() => void decide(a, true)} disabled={!!busy[a.userId]} className="h-11 rounded-[22px] bg-navy px-4 text-[13px] font-semibold text-white disabled:opacity-60">
                  승인
                </button>
                <button type="button" aria-label={`${a.nickname} 거절`} onClick={() => void decide(a, false)} disabled={!!busy[a.userId]} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-medium text-ink disabled:opacity-60">
                  거절
                </button>
              </span>
              {/* 참가 신청 한마디 (D4 — 선택, 200자) */}
              {a.message && <p data-apply-message className="m-0 mb-1 basis-full whitespace-pre-wrap break-words rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] leading-[1.5] text-ink-2">{a.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
