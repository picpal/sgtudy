"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { PageBody } from "@/components/ui/PageBody";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Switch } from "@/components/ui/Switch";
import { toApiError } from "@/lib/api/errors";
import { updateMe } from "@/lib/api/me";
import type { Me } from "@/lib/api/types";
import { AVATAR_PAL } from "@/lib/palette";
import { ChangePassword } from "./ChangePassword";
import { NicknameField } from "./NicknameField";
import type { NickHint } from "./nickname";

export function ProfileScreen({ me }: { me: Me }) {
  const router = useRouter();
  const original = me.nickname ?? "";
  const [nick, setNick] = useState(original);
  const [hint, setHint] = useState<NickHint>({ tone: "ok", text: "" });
  const [mail, setMail] = useState(me.optionalMailEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailOk, setMailOk] = useState("");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (hint.tone !== "ok" || nick.trim() === original) return;
    setBusy(true);
    setMsg(null);
    setMailOk("");
    try {
      await updateMe({ nickname: nick.trim() });
      setMsg({ tone: "ok", text: "닉네임을 바꿨어요" });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "bad", text: toApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleMail = async (next: boolean) => {
    if (mailBusy) return;
    setMailBusy(true);
    setMailError("");
    setMailOk("");
    if (msg?.tone === "ok") setMsg(null); // 지난 "닉네임을 바꿨어요" 가 토글 결과처럼 남지 않게(Q1-18)
    setMail(next);
    try {
      await updateMe({ optionalMailEnabled: next });
      setMailOk(next ? "옵션 알림 메일을 켰어요" : "옵션 알림 메일을 껐어요");
    } catch (err) {
      setMail(!next);
      setMailError(toApiError(err).message);
    } finally {
      setMailBusy(false);
    }
  };

  const onNick = (v: string) => {
    setNick(v);
    if (msg) setMsg(null); // 결과 문구("바꿨어요"·지난 저장 오류)는 다시 고치기 시작하면 지운다(Q1-18)
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader bell={<NotificationBell />} />
      <PageBody>
        <main className="mx-auto flex w-full max-w-[560px] flex-col gap-5 rounded-[20px] bg-surface p-7 max-sm:p-5">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full text-[24px] font-bold" style={{ background: AVATAR_PAL[me.tone].bg, color: AVATAR_PAL[me.tone].fg }}>
              {me.initial}
            </span>
            <div>
              <h1 className="m-0 text-[22px] font-bold">내 프로필</h1>
              <p className="mb-0 mt-1 text-[13px] text-muted">아바타는 닉네임 첫 글자예요</p>
            </div>
          </div>

          <form onSubmit={save} className="flex flex-col gap-4">
            <NicknameField value={nick} onChange={onNick} original={original} onHint={setHint} />
            <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
              이메일
              <input type="email" value={me.email} readOnly aria-readonly className="h-12 w-full rounded-[12px] border border-line bg-surface-3 px-4 text-[15px] text-muted" />
              <span className="text-[12px] font-medium text-muted">로그인에 쓰는 주소라 바꿀 수 없어요</span>
            </label>
            {msg && <p role={msg.tone === "bad" ? "alert" : "status"} className="m-0 text-[13px]" style={{ color: msg.tone === "ok" ? "#0D7A64" : "#B4462B" }}>{msg.text}</p>}
            <button type="submit" disabled={busy || hint.tone !== "ok" || nick.trim() === original} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
              닉네임 저장
            </button>
          </form>

          <section aria-label="알림 메일" className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-[14px] font-semibold">옵션 알림 메일 받기</span>
                <span className="block text-[12px] text-muted">마감 리마인더·일정 변경 같은 선택 알림을 메일로도 받아요</span>
              </span>
              <Switch on={mail} onChange={toggleMail} label="옵션 알림 메일 받기" disabled={mailBusy} />
            </div>
            {mailError && <p role="alert" className="m-0 text-[13px]" style={{ color: "#B4462B" }}>{mailError}</p>}
            {mailOk && <p role="status" className="m-0 text-[13px]" style={{ color: "#0D7A64" }}>{mailOk}</p>}
            <p className="m-0 text-[12px] text-muted">기본 알림(참가 승인·회차 시작·전원 제출)은 항상 발송돼요.</p>
          </section>

          <ChangePassword email={me.email} />
        </main>
      </PageBody>
    </div>
  );
}
