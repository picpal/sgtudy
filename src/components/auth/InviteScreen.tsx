"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { toApiError } from "@/lib/api/errors";
import { inviteActionOf, joinByInvite, type InviteAction } from "@/lib/api/invite";
import type { InvitePreview } from "@/lib/api/types";
import { periodLong } from "@/lib/api/format";
import { PAL } from "@/lib/palette";
import { routes } from "@/lib/routes";
import { AuthShell } from "./AuthShell";

const primary = "flex h-12 w-full items-center justify-center rounded-[24px] text-[15px] font-semibold text-white hover:text-white";

export function InviteScreen({ token, preview }: { token: string; preview: InvitePreview }) {
  const router = useRouter();
  const [p, setP] = useState(preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act: InviteAction = inviteActionOf(p);
  const r = p.room;

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await joinByInvite(token);
      setP((prev) => ({ ...prev, me: res.me, room: { ...prev.room, memberCount: res.memberCount } }));
      if (res.me?.state === "active") router.push(routes.myStudy(r.slug));
      else router.refresh();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "AUTH_REQUIRED") return router.push(routes.login(routes.invite(token)));
      if (err.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.invite(token)));
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cta = () => {
    switch (act) {
      case "login":
        return <Link href={routes.login(routes.invite(token))} className={`${primary} bg-navy`}>로그인하고 참가</Link>;
      case "owner":
        return <Link href={routes.myStudy(r.slug)} className={`${primary} bg-navy`}>내가 만든 방 · 관리하기</Link>;
      case "joined":
        return <Link href={routes.myStudy(r.slug)} className={`${primary} bg-mint`}>참가중 · 내 스터디에서 보기</Link>;
      case "pending":
        return (
          <>
            <div className="flex h-12 items-center justify-center rounded-[24px] bg-amber-soft text-[15px] font-semibold text-amber-text">승인 대기중</div>
            <Link href={routes.room(r.slug)} className="text-center text-[13px] font-semibold text-mint">방 둘러보기</Link>
          </>
        );
      case "join":
      case "apply":
        return (
          <button type="button" onClick={go} disabled={busy} className={`${primary} bg-navy disabled:bg-slate-soft disabled:text-muted`}>
            {busy ? "처리 중…" : act === "join" ? "참가하기" : "참가 신청"}
          </button>
        );
      default: {
        const text = act === "inactive" ? "이탈 처리된 멤버예요" : act === "full" ? "정원 마감" : act === "ended" ? "종료된 스터디예요" : "이미 진행 중인 스터디예요";
        return <button type="button" disabled className="h-12 rounded-[24px] bg-slate-soft text-[15px] font-semibold text-muted">{text}</button>;
      }
    }
  };

  return (
    <AuthShell title="스터디 초대" subtitle={`${p.leader.nickname} 님이 초대했어요`}>
      <div className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
        <div className="text-[18px] font-bold leading-[1.35]">{r.title}</div>
        {r.intro && <p className="m-0 text-[14px] leading-[1.6] text-ink-2">{r.intro}</p>}
        <dl className="m-0 grid grid-cols-[72px_minmax(0,1fr)] gap-y-2 text-[13px]">
          <dt className="text-muted">기간</dt>
          <dd className="m-0 font-medium">{periodLong(r.startDate, r.endDate)}</dd>
          <dt className="text-muted">인원</dt>
          <dd className="m-0 font-medium">{r.memberCount} / {r.maxMembers}명 · {r.joinMode === "approval" ? "승인제" : "바로 참가"}{r.isPublic ? "" : " · 비공개"}</dd>
          <dt className="text-muted">그룹장</dt>
          <dd className="m-0 flex items-center gap-2 font-medium"><Avatar name={p.leader.nickname} tone={p.leader.tone} id={p.leader.userId} size={22} />{p.leader.nickname}</dd>
        </dl>
        {r.tags.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {r.tags.map((t) => (
              <span key={t.slug} className="inline-flex h-6 items-center rounded-[12px] px-[9px] text-[12px] font-semibold" style={{ background: PAL[t.tone].bg, color: PAL[t.tone].fg }}>{t.label}</span>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex flex-col gap-2">{cta()}</div>
    </AuthShell>
  );
}
