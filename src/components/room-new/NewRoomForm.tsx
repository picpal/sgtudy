"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { Switch } from "@/components/ui/Switch";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { rpc, toApiError } from "@/lib/api/errors";
import type { RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { useToday } from "@/lib/today";
import { EMPTY_VALUES, toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

const field = "h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]";
const area = "min-h-[96px] w-full resize-y rounded-[12px] border border-line-3 px-4 py-3 text-[14px] text-ink outline-none focus:border-mint";

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      {label}
      {children}
      {error && <span role="alert" className="text-[12px] font-medium text-warn">{error}</span>}
    </label>
  );
}

export function NewRoomForm() {
  const router = useRouter();
  const today = useToday();
  const [v, setV] = useState<NewRoomValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ReturnType<typeof validateNewRoom>>({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const set = <K extends keyof NewRoomValues>(k: K, val: NewRoomValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateNewRoom(v, today);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError("");
    try {
      const c = toCreateRoom(v);
      const room = await rpc<RoomDetail>("room_create", {
        p_title: c.title, p_intro: c.intro, p_start_date: c.startDate, p_end_date: c.endDate, p_max_members: c.maxMembers, p_is_public: c.isPublic, p_join_mode: c.joinMode,
        p_description_md: c.descriptionMd ?? "", p_rules_md: c.rulesMd ?? "", p_min_members: c.minMembers ?? null, p_leader_does_tasks: c.leaderDoesTasks ?? true, p_tag_slugs: [],
      });
      router.push(routes.myStudyEdit(room.slug));
      router.refresh();
    } catch (err) {
      const a = toApiError(err);
      if (a.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.createRoom()));
      setServerError(a.message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto w-full max-w-[640px] rounded-[20px] bg-surface p-7 max-sm:p-5">
        <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">방 만들기</h1>
        <p className="mb-6 mt-[6px] text-[14px] text-muted">채팅방 만들듯 30초면 충분해요. 커리큘럼은 만든 뒤 천천히 채워요.</p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="제목 (= 최상위 목표)" error={errors.title}><input className={field} value={v.title} maxLength={60} onChange={(e) => set("title", e.target.value)} placeholder="예) AWS SAA 자격증 3개월 완주" autoFocus /></Field>
          <Field label="한 줄 소개" error={errors.intro}><input className={field} value={v.intro} maxLength={100} onChange={(e) => set("intro", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="시작일" error={errors.startDate}><input type="date" className={field} min={today} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            <Field label="종료일" error={errors.endDate}><input type="date" className={field} min={v.startDate || today} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          </div>
          <Field label="최대 인원" error={errors.maxMembers}><input type="number" inputMode="numeric" min={2} max={100} className={field} value={v.maxMembers} onChange={(e) => set("maxMembers", e.target.value)} /></Field>
          <div className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3">
            <span><span className="block text-[14px] font-semibold">공개 방</span><span className="block text-[12px] text-muted">끄면 초대 링크로만 들어올 수 있어요</span></span>
            <Switch on={v.isPublic} onChange={(x) => set("isPublic", x)} label="공개 방" />
          </div>
          <div role="radiogroup" aria-label="참가 방식" className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            {([["direct", "바로 참가", "누구나 바로 들어와요"], ["approval", "승인제", "그룹장이 승인해야 참가돼요"]] as const).map(([k, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={v.joinMode === k} onClick={() => set("joinMode", k)} className="flex flex-col items-start rounded-[12px] border px-4 py-3 text-left" style={{ borderColor: v.joinMode === k ? "#3FB89C" : "#E4ECEA", background: v.joinMode === k ? "#F5FBF9" : "#FFFFFF" }}>
                <span className="text-[14px] font-semibold">{t}</span><span className="text-[12px] text-muted">{d}</span>
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="h-11 self-start text-[14px] font-semibold text-mint">{more ? "접기" : "더 설정하기"}</button>
          {more && (
            <div className="flex flex-col gap-4 rounded-[14px] bg-surface-2 p-4">
              <Field label="상세 설명 (마크다운)"><textarea className={area} value={v.descriptionMd} onChange={(e) => set("descriptionMd", e.target.value)} /></Field>
              <Field label="운영 규칙 (마크다운 · 한 줄에 하나, '- ' 로 시작)"><textarea className={area} value={v.rulesMd} onChange={(e) => set("rulesMd", e.target.value)} placeholder={"- 마감은 회차 마지막 날 23:59(KST)예요."} /></Field>
              <Field label="최소 인원 (선택)" error={errors.minMembers}><input type="number" inputMode="numeric" min={1} className={field} value={v.minMembers} onChange={(e) => set("minMembers", e.target.value)} /></Field>
              <div className="flex items-center justify-between">
                <span><span className="block text-[14px] font-semibold">그룹장도 과제 수행</span><span className="block text-[12px] text-muted">끄면 공통 과제 담당자에서 빠져요 (시작 후 변경 불가)</span></span>
                <Switch on={v.leaderDoesTasks} onChange={(x) => set("leaderDoesTasks", x)} label="그룹장도 과제 수행" />
              </div>
            </div>
          )}

          {serverError && <p role="alert" className="m-0 text-[13px] text-warn">{serverError}</p>}
          <button type="submit" disabled={busy} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">{busy ? "만드는 중…" : "방 만들기"}</button>
        </form>
      </main>
    </div>
  );
}
