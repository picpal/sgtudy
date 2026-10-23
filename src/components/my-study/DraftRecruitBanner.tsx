"use client";

import { useState } from "react";
import { openRecruitConfirm, useOpenRecruit } from "@/components/room-view/useOpenRecruit";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ToastMsg } from "@/components/ui/Toast";
import type { RoomDetail } from "@/lib/api/types";

type Props = { detail: Pick<RoomDetail, "slug" | "isPublic" | "joinMode">; toast: (m: ToastMsg) => void };

/** 공개방은 둘러보기에 안 나오는 것, 비공개방은 초대 링크가 막힌 것(room_join → ROOM_NOT_RECRUITING)이 준비중의 차이 */
export const draftBannerText = (isPublic: boolean) =>
  `아직 준비중이라 ${isPublic ? "둘러보기에 보이지 않아요" : "초대 링크를 받아도 참가할 수 없어요"} · 회차를 준비한 뒤 모집을 시작하세요`;

/**
 * 내 스터디 준비중 막대 — 방을 만들면 곧바로 진행목표 편집으로 와서 방 페이지의 「모집 시작」을 놓친다(공개방이 목록에 안 보인다는 신고).
 * 준비중 방의 그룹장에게만 그린다(그 밖의 사람은 준비중 방에 들어올 수 없고 할 수 있는 일도 없다). 확인 창·RPC 는 그룹장 패널과 같다
 */
export function DraftRecruitBanner({ detail, toast }: Props) {
  const run = useOpenRecruit(detail.slug, toast);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // 성공하면 router.refresh 로 상태가 모집중이 되어 막대가 빠진다 — 그 전에 다시 누르지 않게 먼저 숨긴다
  const [done, setDone] = useState(false);
  const text = openRecruitConfirm(detail);
  const onConfirm = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await run();
    setBusy(false);
    setConfirm(false);
    if (ok) setDone(true);
  };
  if (done) return null;
  return (
    <section
      data-draft-banner
      aria-label="모집 시작 안내"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-2 text-[13px] font-medium leading-[1.5] text-[#6B4700]"
    >
      <span className="flex min-w-0 flex-[1_1_240px] items-start gap-[10px] py-1">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[1px] shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <circle cx="12" cy="7.8" r=".6" />
        </svg>
        <span role="status">{draftBannerText(detail.isPublic)}</span>
      </span>
      <button type="button" onClick={() => setConfirm(true)} disabled={busy} className="h-11 shrink-0 rounded-[22px] bg-navy px-5 text-[13px] font-semibold text-white disabled:opacity-60">
        모집 시작
      </button>
      <ConfirmDialog open={confirm} title={text.title} body={text.body} confirmLabel={text.confirmLabel} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void onConfirm()} />
    </section>
  );
}
