"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ReasonField } from "@/components/ui/ReasonField";
import { toApiError } from "@/lib/api/errors";
import { recruitErrorText } from "@/lib/api/recruit";
import { inviteActionOf, joinByInvite, type InviteAction } from "@/lib/api/invite";
import type { InvitePreview } from "@/lib/api/types";
import { JOIN_MODE_LABEL } from "@/lib/types";
import { mmdd, periodLong } from "@/lib/api/format";
import { PAL } from "@/lib/palette";
import { routes } from "@/lib/routes";
import { AuthShell } from "./AuthShell";

const primary = "flex h-12 w-full items-center justify-center rounded-[24px] text-[15px] font-semibold text-white hover:text-white";

export function InviteScreen({ token, preview }: { token: string; preview: InvitePreview }) {
  const router = useRouter();
  const [p, setP] = useState(preview);
  // router.refresh() 가 새 preview 를 내려보내면 로컬 상태를 다시 맞춘다(렌더 중 "이전 prop 저장 후 리셋" 패턴)
  const [seen, setSeen] = useState(preview);
  if (seen !== preview) {
    setSeen(preview);
    setP(preview);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(""); // 참가 신청 한마디 (승인제 — D4)
  const act: InviteAction = inviteActionOf(p);
  const r = p.room;

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await joinByInvite(token, act === "apply" ? message : undefined);
      setP((prev) => ({ ...prev, me: res.me, room: { ...prev.room, memberCount: res.memberCount } }));
      if (res.me?.state === "active") router.push(routes.myStudy(r.slug));
      else router.refresh();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "AUTH_REQUIRED") return router.push(routes.login(routes.invite(token)));
      if (err.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.invite(token)));
      if (err.code === "INVITE_EXPIRED") {
        setError(recruitErrorText(err.code, err.message));
        router.refresh(); // 미리보기를 다시 받는다
        return;
      }
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
          <>
            {act === "apply" && <ReasonField value={message} onChange={setMessage} label="그룹장에게 한마디 (선택)" placeholder="자기소개나 참여 계획을 짧게 남겨 주세요" />}
          <button type="button" onClick={go} disabled={busy} className={`${primary} bg-navy disabled:bg-slate-soft disabled:text-muted`}>
            {busy ? "처리 중…" : act === "join" ? (p.join?.via === "invite" ? "바로 참가하기" : "참가하기") : "참가 신청"}
          </button>
          </>
        );
      default: {
        const text = act === "inactive" ? "이탈 처리된 멤버예요" : act === "full" ? "정원 마감" : act === "ended" ? "종료된 스터디예요" : "모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요";
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
          <dd className="m-0 font-medium">{r.memberCount} / {r.maxMembers}명 · {JOIN_MODE_LABEL[r.joinMode]}{r.isPublic ? "" : " · 비공개"}</dd>
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
      {r.status === "active" && p.join?.mode && (
        <div role="note" className="flex flex-col gap-1 rounded-[12px] bg-bg px-4 py-3 text-[13px] leading-[1.6] text-ink-2">
          <p className="m-0">
            <b className="font-semibold text-ink">진행중인 스터디예요</b> · 오늘 이후 마감인 과제부터 함께해요. 지난 회차 기록은 볼 수 있어요.
          </p>
          {p.join.via === "invite" && p.join.until && <p className="m-0 font-semibold text-ink">초대로 바로 참가 · {mmdd(p.join.until)}까지</p>}
          {p.join.via === "extra" && p.join.until && <p className="m-0 font-semibold text-ink">추가 모집 · {mmdd(p.join.until)}까지</p>}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex flex-col gap-2">{cta()}</div>
    </AuthShell>
  );
}
