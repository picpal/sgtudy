"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EditorField, FIELD_CLASS, Field, JoinModeRadio, RULE_TOOLS, SwitchRow, TagPicker } from "@/components/room-new/fields";
import { fromDto, putRoomTags, sameTags, type TagItem } from "@/components/room-new/tags";
import { clampCp, firstErrorKey, maxEndDate, revalidateOnChange, serverFieldError, type NewRoomValues } from "@/components/room-new/validate";
import { StatusBadge } from "@/components/my-study/StudyHeaderInfo";
import { AppHeader } from "@/components/ui/AppHeader";
import { PageBody } from "@/components/ui/PageBody";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { ymd, uiStatus } from "@/lib/api/format";
import type { RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { useToday } from "@/lib/today";
import { useLeaveConfirm } from "@/lib/useLeaveConfirm";
import { archiveRoom, buildPatch, dangerOf, deleteRoom, lockReason, lockedOf, saveSteps, updateRoom, validateSettings, valuesOf } from "./settings";
import { NotifySettingsSection } from "./NotifySettings";
import { SideBackRail, TopBackLink } from "./BackButtons";

type Errors = Partial<Record<keyof NewRoomValues, string>>;

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line-2 pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 id={id} className="m-0 text-[17px] font-bold">{title}</h2>
        {desc && <p className="m-0 mt-1 text-[13px] leading-[1.5] text-muted">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * 방 설정 (그룹장, QA Q3-1·Q2-2) — 방 만들기 폼과 같은 칸 + 태그 + 삭제/보관.
 * 저장: 바뀐 칸만 room_update, 태그가 바뀌었으면 room_tags_put. 잠긴 칸·삭제/보관 가능 여부는 서버 규칙(settings.ts)을 따른다
 */
export function RoomSettingsForm({ detail: initialDetail }: { detail: RoomDetail }) {
  const router = useRouter();
  const today = useToday();
  const [d, setD] = useState(initialDetail);
  const [base, setBase] = useState(() => valuesOf(initialDetail));
  const [v, setV] = useState(base);
  const [baseTags, setBaseTags] = useState<TagItem[]>(() => initialDetail.tags.map(fromDto));
  const [tags, setTags] = useState<TagItem[]>(baseTags);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [toast, setToast] = useState<ToastMsg>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const locked = lockedOf(d);
  const reason = lockReason(d);
  const tagsLocked = d.archived || d.status === "ended";
  const patch = useMemo(() => buildPatch(base, v), [base, v]);
  const tagsDirty = !sameTags(baseTags, tags);
  const dirtyCount = Object.keys(patch).length + (tagsDirty ? 1 : 0);
  const formRef = useRef<HTMLFormElement>(null);
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    const el = formRef.current?.elements.namedItem(k);
    if (el instanceof HTMLElement) el.focus();
  }, [errors]);
  // 저장 안 한 수정이 있으면 탭 닫기·새로고침 전에 브라우저가 묻는다
  useEffect(() => {
    if (!dirtyCount) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirtyCount]);
  // 앱 안 링크(헤더 메뉴·로고·"내 스터디로")로 떠날 때도 묻는다 (Q2-1, leaveGuard)
  const leaveAsk = useLeaveConfirm(dirtyCount > 0, (href) => router.push(href));

  const set = <K extends keyof NewRoomValues>(k: K, val: NewRoomValues[K]) => {
    const next = { ...v, [k]: val };
    setV(next);
    setErrors((e) => revalidateOnChange(e, k, next, today));
  };
  const recheck = (k: keyof NewRoomValues) => setErrors((e) => revalidateOnChange(e, k, v, today));
  const dis = (k: keyof NewRoomValues) => locked.has(k) || busy;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirtyCount) return;
    const errs = validateSettings(base, v, today, d);
    setErrors(errs);
    focusKey.current = firstErrorKey(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError("");
    try {
      // 방 정보가 저장되면 태그 결과를 기다리지 않고 기준값을 먼저 갱신 — 태그만 실패해도 "바뀐 항목"엔 태그만 남는다 (최종 리뷰 Minor 6)
      const next = await saveSteps(
        { hasPatch: Object.keys(patch).length > 0, tagsDirty },
        {
          update: () => updateRoom(d.slug, patch),
          putTags: () => putRoomTags(d.slug, tags),
          onRoom: (r) => {
            setD(r);
            setBase(valuesOf(r));
          },
        },
        d,
      );
      setD(next);
      const nv = valuesOf(next);
      setBase(nv);
      setV(nv);
      const nt = next.tags.map(fromDto);
      setBaseTags(nt);
      setTags(nt);
      setToast({ text: "저장했어요", tone: "ok" });
      router.refresh();
    } catch (err) {
      const a = toApiError(err);
      const fe = serverFieldError(a.details, a.message);
      if (fe) {
        setErrors(fe);
        focusKey.current = firstErrorKey(fe);
      } else setServerError(a.message || "저장하지 못했어요 · 잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setV(base);
    setTags(baseTags);
    setErrors({});
    setServerError("");
  };

  const back = routes.myStudy(d.slug);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="myStudy" bell={<NotificationBell />} />
      <PageBody>
        <main className="relative mx-auto w-full max-w-[880px] rounded-[20px] bg-surface p-7 max-sm:p-5">
          <TopBackLink href={back} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">방 설정</h1>
            <StatusBadge status={uiStatus(d.status)} draft={d.status === "draft"} />
            {d.archived && <span className="rounded-[8px] bg-slate-soft px-[10px] py-[3px] text-[12px] font-semibold text-ink-3">보관됨</span>}
          </div>
          <p className="mb-6 mt-[6px] line-clamp-2 break-words text-[14px] text-muted" title={d.title}>
            {d.title}
          </p>
          {reason && (
            <p role="note" className="mb-6 mt-0 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-3 text-[13px] font-medium leading-[1.5] text-[#6B4700]">
              {d.status === "active" && !d.archived ? "진행중에는 시작일·최소 인원·공개 여부·참가 방식·그룹장 과제 수행을 바꿀 수 없어요" : reason}
            </p>
          )}

          <form ref={formRef} onSubmit={save} className="flex flex-col gap-6" noValidate>
            <Section title="기본 정보">
              <Field label="제목 (= 최상위 목표)" required error={errors.title}>
                <input name="title" className={FIELD_CLASS} value={v.title} disabled={dis("title")} onChange={(e) => set("title", clampCp(e.target.value, 60))} aria-required aria-invalid={!!errors.title} />
              </Field>
              <Field label="한 줄 소개" required hint="방 목록 카드에 제목과 함께 보여요 · 100자까지" error={errors.intro}>
                <input name="intro" className={FIELD_CLASS} value={v.intro} disabled={dis("intro")} onChange={(e) => set("intro", clampCp(e.target.value, 100))} aria-required aria-invalid={!!errors.intro} />
              </Field>
              <EditorField id="settings-desc" label="상세 설명">
                {locked.has("descriptionMd") ? (
                  <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-[14px] text-muted">{v.descriptionMd ? "고칠 수 없어요 · 개요 탭에서 볼 수 있어요" : "상세 설명이 없어요"}</div>
                ) : (
                  <MarkdownEditor labelledBy="settings-desc" value={v.descriptionMd} onChange={(x) => set("descriptionMd", x)} placeholder="스터디 목표, 진행 방식, 준비물 등을 적어 주세요" maxHeight="none" />
                )}
              </EditorField>
              <EditorField id="settings-rules" label="운영 규칙 (한 줄에 하나씩 목록으로)">
                {locked.has("rulesMd") ? (
                  <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-[14px] text-muted">{v.rulesMd ? "고칠 수 없어요 · 개요 탭에서 볼 수 있어요" : "운영 규칙이 없어요"}</div>
                ) : (
                  <MarkdownEditor labelledBy="settings-rules" value={v.rulesMd} onChange={(x) => set("rulesMd", x)} placeholder="- 마감은 회차 마지막 날 23:59(KST)예요." minHeight={150} maxHeight="none" tools={RULE_TOOLS} />
                )}
              </EditorField>
            </Section>

            <Section title="태그" desc="진행목표 내용으로 자동으로 붙는 태그(반짝이 표시)와 직접 고른 태그가 함께 보여요">
              <TagPicker value={tags} onChange={setTags} disabled={tagsLocked || busy} autoNote />
            </Section>

            <Section title="참가·공개">
              <SwitchRow title="공개 방" desc={locked.has("isPublic") ? reason : "끄면 초대 링크로만 들어올 수 있어요"} on={v.isPublic} onChange={(x) => set("isPublic", x)} disabled={dis("isPublic")} />
              <JoinModeRadio value={v.joinMode} onChange={(x) => set("joinMode", x)} disabled={dis("joinMode")} />
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="최대 인원" required hint={`2~100명 · 지금 ${d.memberCount}명 참가 중`} error={errors.maxMembers}>
                  <input name="maxMembers" type="number" inputMode="numeric" min={Math.max(2, d.memberCount)} max={100} className={FIELD_CLASS} value={v.maxMembers} disabled={dis("maxMembers")} onChange={(e) => set("maxMembers", e.target.value)} aria-invalid={!!errors.maxMembers} />
                </Field>
                <Field label="최소 인원 (선택)" hint={locked.has("minMembers") ? reason : "비우면 제한 없음"} error={errors.minMembers}>
                  <input name="minMembers" type="number" inputMode="numeric" min={1} className={FIELD_CLASS} value={v.minMembers} disabled={dis("minMembers")} onChange={(e) => set("minMembers", e.target.value)} aria-invalid={!!errors.minMembers} />
                </Field>
              </div>
              <SwitchRow
                title="그룹장도 과제 수행"
                desc={locked.has("leaderDoesTasks") ? reason : "끄면 공통 과제 담당자에서 빠져요 (시작 후 변경 불가)"}
                on={v.leaderDoesTasks}
                onChange={(x) => set("leaderDoesTasks", x)}
                disabled={dis("leaderDoesTasks")}
              />
            </Section>

            <Section
              title="기간"
              desc={
                d.status === "active" && !d.archived
                  ? "진행중에는 종료일만 바꿀 수 있어요 · 오늘과 마지막 과제 마감 이후로. 종료일이 지나면 스터디가 자동으로 종료돼요 — 일찍 끝내려면 종료일을 앞당겨 주세요"
                  : d.status === "draft" || d.status === "recruit"
                    ? "시작일은 오늘 이후, 기간은 최대 1년이에요"
                    : undefined
              }
            >
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="시작일" required hint={locked.has("startDate") && !d.archived && d.status !== "ended" ? reason : undefined} error={errors.startDate}>
                  <input name="startDate" type="date" className={FIELD_CLASS} min={v.startDate === base.startDate ? undefined : today} value={v.startDate} disabled={dis("startDate")} onChange={(e) => set("startDate", e.target.value)} onBlur={() => recheck("startDate")} aria-invalid={!!errors.startDate} />
                </Field>
                <Field label="종료일" required error={errors.endDate}>
                  <input name="endDate" type="date" className={FIELD_CLASS} min={d.status === "active" ? today : v.startDate || today} max={maxEndDate(v.startDate) || undefined} value={v.endDate} disabled={dis("endDate")} onChange={(e) => set("endDate", e.target.value)} onBlur={() => recheck("endDate")} aria-invalid={!!errors.endDate} />
                </Field>
              </div>
            </Section>

            {serverError && <p role="alert" className="m-0 text-[13px] text-warn">{serverError}</p>}
            {/* 저장 막대 — 바뀐 게 있으면 긴 폼에서도 보이게 화면 아래에 붙는다 */}
            <div className={`${dirtyCount ? "sticky bottom-0 z-10 shadow-[0_-8px_20px_rgba(27,34,48,.06)]" : ""} -mx-7 flex flex-wrap items-center justify-end gap-2 border-t border-line-2 bg-surface px-7 py-3 max-sm:-mx-5 max-sm:px-5`}>
              <span aria-live="polite" className="mr-auto text-[13px] text-muted">
                {dirtyCount ? `바뀐 항목 ${dirtyCount}개` : "바뀐 내용이 없어요"}
              </span>
              <button type="button" onClick={reset} disabled={!dirtyCount || busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-50">
                되돌리기
              </button>
              <button type="submit" disabled={!dirtyCount || busy} className="h-11 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
                {busy ? "저장하는 중…" : "저장"}
              </button>
            </div>
          </form>

          {/* 알림 설정 — 바로 저장(위 폼 저장과 따로). 끝났거나 보관된 방은 보낼 알림이 없다 */}
          {!d.archived && d.status !== "ended" && <NotifySettingsSection slug={d.slug} toast={setToast} />}

          <DangerZone detail={d} onDetail={setD} toast={setToast} dirty={dirtyCount > 0} />
          <SideBackRail href={back} />
        </main>
        <Toast msg={toast} onClose={closeToast} />
        <ConfirmDialog
          open={leaveAsk.pending !== null}
          title="저장하지 않은 수정이 있어요"
          body={`바뀐 항목 ${dirtyCount}개를 저장하지 않고 이동할까요?`}
          confirmLabel="버리고 이동"
          danger
          onConfirm={leaveAsk.leave}
          onCancel={leaveAsk.stay}
        />
      </PageBody>
    </div>
  );
}

/**
 * 삭제·보관 (서버 규칙 그대로): 준비중·모집중 → 삭제(되돌릴 수 없음 — 방 제목을 다시 입력해야 버튼이 켜진다),
 * 진행중·종료 → 보관(모든 참가자 목록에서 빠지고 읽기 전용, 언제든 풀 수 있음), 보관됨 → 보관 풀기
 */
function DangerZone({ detail: d, onDetail, toast, dirty }: { detail: RoomDetail; onDetail: (d: RoomDetail) => void; toast: (m: ToastMsg) => void; dirty: boolean }) {
  const router = useRouter();
  const kind = dangerOf(d);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const typedOk = typed.trim() === d.title.trim();
  const others = Math.max(0, d.memberCount - 1);

  const del = async () => {
    if (!typedOk || busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteRoom(d.slug);
      // 이 방은 더 없다 — 내 스터디(첫 스터디 또는 빈 화면)로
      router.replace(routes.myStudy());
      router.refresh();
    } catch (e) {
      setError(toApiError(e).message || "삭제하지 못했어요 · 잠시 후 다시 시도해 주세요");
      setBusy(false);
    }
  };
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await archiveRoom(d.slug, kind === "archive");
      onDetail(next);
      toast({ text: kind === "archive" ? "방을 보관했어요 · 언제든 여기서 보관을 풀 수 있어요" : "보관을 풀었어요", tone: "ok" });
      router.refresh();
      setOpen(false);
    } catch (e) {
      toast({ text: toApiError(e).message || "처리하지 못했어요", tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="danger-title" className="mt-8 flex flex-col gap-3 rounded-[16px] border border-[#F0C9C4] bg-[#FFF7F6] p-5">
      <h2 id="danger-title" className="m-0 text-[15px] font-bold text-[#8C2F1C]">
        {kind === "delete" ? "방 삭제" : kind === "archive" ? "방 보관" : "보관 풀기"}
      </h2>
      <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
        {kind === "delete"
          ? "모집을 시작하기 전·모집 중인 방만 지울 수 있어요. 진행목표·제출·참가 기록이 모두 지워지고 되돌릴 수 없어요."
          : kind === "archive"
            ? "진행중이거나 종료된 방은 지울 수 없고 보관할 수 있어요. 보관하면 참가자에게 알림이 가고, 방 목록·내 과제·일정에서 빠지며 제출과 수정이 멈춰요. 내 스터디의 '보관됨'에서 기록은 계속 볼 수 있어요. 보관은 언제든 이 화면에서 풀 수 있어요."
            : "보관을 풀면 참가자들의 내 스터디·일정과 방 목록에 다시 보이고, 방 정보·진행목표를 고칠 수 있어요."}
      </p>
      {dirty && <p className="m-0 text-[12px] text-muted">저장하지 않은 수정은 이 동작과 함께 저장되지 않아요</p>}

      {kind === "delete" && !open && (
        <button type="button" onClick={() => setOpen(true)} className="h-11 self-start rounded-[22px] border border-danger bg-surface px-5 text-[14px] font-semibold text-danger">
          방 삭제…
        </button>
      )}
      {kind === "delete" && open && (
        <div role="group" aria-label="방 삭제 확인" className="flex flex-col gap-2 rounded-[12px] border border-[#F0C9C4] bg-surface p-4">
          <p className="m-0 text-[13px] font-semibold leading-[1.6] text-[#8C2F1C]">
            되돌릴 수 없어요.{others > 0 ? ` 참가 중인 ${others}명도 이 방을 더는 볼 수 없어요.` : ""}
          </p>
          <label htmlFor={inputId} className="text-[12px] font-semibold text-ink-3">
            확인을 위해 방 제목 <b className="break-all text-ink">{d.title}</b> 을(를) 그대로 입력해 주세요
          </label>
          <input id={inputId} autoFocus className={FIELD_CLASS} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          {error && <span role="alert" className="text-[12px] text-warn">{error}</span>}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError("");
              }}
              disabled={busy}
              className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60"
            >
              취소
            </button>
            <button type="button" onClick={() => void del()} disabled={!typedOk || busy} className="h-11 rounded-[22px] bg-danger px-5 text-[14px] font-semibold text-white disabled:opacity-40">
              {busy ? "삭제하는 중…" : "영구 삭제"}
            </button>
          </div>
        </div>
      )}
      {kind !== "delete" && (
        <button type="button" onClick={() => setOpen(true)} disabled={busy} className={`h-11 self-start rounded-[22px] px-5 text-[14px] font-semibold disabled:opacity-60 ${kind === "archive" ? "border border-danger bg-surface text-danger" : "bg-navy text-white"}`}>
          {kind === "archive" ? "방 보관…" : "보관 풀기"}
        </button>
      )}
      <ConfirmDialog
        open={kind !== "delete" && open}
        title={kind === "archive" ? "방을 보관할까요?" : "보관을 풀까요?"}
        body={
          kind === "archive"
            ? `${d.status === "active" ? "진행 중인 스터디예요. " : ""}참가자에게 알림이 가고, 제출·수정이 멈춰요${d.status === "active" ? " · 보관된 동안은 종료일이 지나도 자동으로 종료되지 않아요" : ""}. 기록은 내 스터디의 '보관됨'에서 볼 수 있고, 언제든 방 설정에서 풀 수 있어요.`
            : `방 기간 ${ymd(d.startDate)} – ${ymd(d.endDate)} 그대로 다시 보여요.`
        }
        confirmLabel={kind === "archive" ? "보관" : "보관 풀기"}
        danger={kind === "archive"}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}
