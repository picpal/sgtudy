"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Switch } from "@/components/ui/Switch";
import { rpc, toApiError } from "@/lib/api/errors";
import type { RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { useToday } from "@/lib/today";
import { DATE_FIELD_CLASS, EditorField, FIELD_CLASS as field, Field, JoinModeRadio, RULE_TOOLS, SwitchRow, TagPicker } from "./fields";
import { putRoomTags, toPutArgs, type TagItem } from "./tags";
import { clampCp, firstErrorKey, maxEndDate, revalidateOnChange, serverFieldError, toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

/**
 * 방 만들기 폼 — 값(values·tags)은 밖(NewRoomScreen)이 들고 있다. AI 인터뷰와 같은 상태를 공유해 모드를 오가도 값이 남는다(D13).
 * banner: 폼 위 안내(인터뷰로 채운 초안 등). initialMore: 「더 설정하기」 를 펼친 채 시작. initialFocus: 처음 포커스할 칸 이름(없으면 제목)
 * beforeSubmit: [방 만들기] 바로 위(회차 초안·바로 모집). afterCreate: 방을 만든 뒤 회차 적용·모집 시작 — 돌려준 note 를 이동 주소에 붙인다.
 * afterCreate 가 실패해도 방은 만들어졌으니 반드시 편집 화면으로 간다(2단계 D22·Review Focus 1)
 */
export function NewRoomForm({ values: v, tags, onChange, onTagsChange, banner, initialMore = false, initialFocus, beforeSubmit, afterCreate, submitLabel = "방 만들기" }: {
  values: NewRoomValues;
  tags: TagItem[];
  onChange: (v: NewRoomValues) => void;
  onTagsChange: (t: TagItem[]) => void;
  banner?: ReactNode;
  initialMore?: boolean;
  initialFocus?: string;
  beforeSubmit?: ReactNode;
  afterCreate?: (slug: string) => Promise<string | null>;
  submitLabel?: string;
}) {
  const router = useRouter();
  const today = useToday();
  const [errors, setErrors] = useState<ReturnType<typeof validateNewRoom>>({});
  const [more, setMore] = useState(initialMore);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const inFlight = useRef(false); // 같은 프레임 두 번 제출(disabled 반영 전) 막기 — DRAFT 방 중복 생성 방지
  const set = <K extends keyof NewRoomValues>(k: K, val: NewRoomValues[K]) => {
    const next = { ...v, [k]: val };
    onChange(next);
    setErrors((e) => revalidateOnChange(e, k, next, today)); // 고친 칸의 오류·aria-invalid 를 바로 걷는다 (V1-01)
  };
  const formRef = useRef<HTMLFormElement>(null);
  // 제출로 생긴 오류의 첫 칸 — 렌더(더 설정하기 펼침 포함) 뒤 그 칸으로 포커스(Q2-19). 입력 중 오류 갱신에는 움직이지 않는다
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    const el = formRef.current?.elements.namedItem(k);
    if (el instanceof HTMLElement) el.focus();
  }, [errors, more]);
  // 인터뷰에서 넘어오면 첫 빈 필수 칸으로 — 제목 autoFocus 뒤에 옮긴다
  useEffect(() => {
    if (!initialFocus) return;
    const el = formRef.current?.elements.namedItem(initialFocus);
    if (el instanceof HTMLElement) el.focus();
  }, [initialFocus]);
  // 날짜 칸은 달력·키보드로 고르는 중간값이 onChange 로 안 올 수 있어 칸을 떠날 때도 떠 있는 오류를 다시 본다 (Q3-11)
  const recheck = (k: keyof NewRoomValues) => setErrors((e) => revalidateOnChange(e, k, v, today));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateNewRoom(v, today);
    setErrors(errs);
    focusKey.current = firstErrorKey(errs);
    if (errs.minMembers) setMore(true);
    if (Object.keys(errs).length || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setServerError("");
    try {
      const c = toCreateRoom(v);
      const room = await rpc<RoomDetail>("room_create", {
        p_title: c.title, p_intro: c.intro, p_start_date: c.startDate, p_end_date: c.endDate, p_max_members: c.maxMembers, p_is_public: c.isPublic, p_join_mode: c.joinMode,
        p_description_md: c.descriptionMd ?? "", p_rules_md: c.rulesMd ?? "", p_min_members: c.minMembers ?? null, p_leader_does_tasks: c.leaderDoesTasks ?? true, p_tag_slugs: toPutArgs(tags).slugs,
      });
      // 새로 쓴 태그(사전에 없는 라벨)는 room_create 가 받지 않는다 — 만든 뒤 전체 목록으로 한 번 더 저장. 실패해도 방은 만들어졌으니 넘어간다(방 설정에서 다시 고칠 수 있다)
      if (toPutArgs(tags).freeLabels.length) await putRoomTags(room.slug, tags).catch(() => undefined);
      const note = afterCreate ? await Promise.resolve(room.slug).then(afterCreate).catch(() => "rounds-skipped") : null;
      router.push(note ? `${routes.myStudyEdit(room.slug)}&note=${encodeURIComponent(note)}` : routes.myStudyEdit(room.slug));
      router.refresh();
    } catch (err) {
      const a = toApiError(err);
      inFlight.current = false;
      if (a.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(routes.createRoom()));
      const fe = serverFieldError(a.details, a.message);
      if (fe) {
        setErrors(fe);
        focusKey.current = firstErrorKey(fe);
        if (fe.minMembers) setMore(true);
      } else setServerError(a.message);
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {banner}
      {/* 한도는 서버와 같은 코드 포인트(60/100)로 자른다 — maxLength 는 UTF-16 단위라 이모지에서 어긋난다(Q2-16) */}
      <Field label="제목 (= 최상위 목표)" required error={errors.title}><input name="title" className={field} value={v.title} onChange={(e) => set("title", clampCp(e.target.value, 60))} placeholder="예) AWS SAA 자격증 3개월 완주" autoFocus aria-required aria-invalid={!!errors.title} /></Field>
      <Field label="한 줄 소개" required hint="방 목록 카드에 제목과 함께 보여요 · 100자까지" error={errors.intro}><input name="intro" className={field} value={v.intro} onChange={(e) => set("intro", clampCp(e.target.value, 100))} placeholder="예) 매주 한 챕터씩 읽고 기출 20문제를 풀어요" aria-required aria-invalid={!!errors.intro} /></Field>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label="시작일" required hint="오늘 이후" error={errors.startDate}><input name="startDate" aria-required aria-invalid={!!errors.startDate} type="date" className={DATE_FIELD_CLASS} min={today} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} onBlur={() => recheck("startDate")} /></Field>
        <Field label="종료일" required hint="시작일부터 최대 1년" error={errors.endDate}><input name="endDate" aria-required aria-invalid={!!errors.endDate} type="date" className={DATE_FIELD_CLASS} min={v.startDate || today} max={maxEndDate(v.startDate) || undefined} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} onBlur={() => recheck("endDate")} /></Field>
      </div>
      <Field label="최대 인원" required hint="2~100명 · 그룹장 포함" error={errors.maxMembers}><input name="maxMembers" aria-invalid={!!errors.maxMembers} type="number" inputMode="numeric" min={2} max={100} className={field} value={v.maxMembers} onChange={(e) => set("maxMembers", e.target.value)} /></Field>
      <SwitchRow title="공개 방" desc="끄면 초대 링크로만 들어올 수 있어요" on={v.isPublic} onChange={(x) => set("isPublic", x)} />
      <JoinModeRadio value={v.joinMode} onChange={(x) => set("joinMode", x)} />
      <TagPicker value={tags} onChange={onTagsChange} />

      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="h-11 self-start text-[14px] font-semibold text-mint">{more ? "접기" : "더 설정하기"}</button>
      {/* 편집기는 글만큼 자란다(maxHeight none) — 한 페이지 스크롤, 안쪽 세로 스크롤 없음 */}
      {more && (
        <div className="flex flex-col gap-4 rounded-[14px] bg-surface-2 p-4">
          <EditorField id="new-room-desc" label="상세 설명"><MarkdownEditor labelledBy="new-room-desc" value={v.descriptionMd} onChange={(x) => set("descriptionMd", x)} placeholder="스터디 목표, 진행 방식, 준비물 등을 적어 주세요" maxHeight="none" /></EditorField>
          <EditorField id="new-room-rules" label="운영 규칙 (한 줄에 하나씩 목록으로)"><MarkdownEditor labelledBy="new-room-rules" value={v.rulesMd} onChange={(x) => set("rulesMd", x)} placeholder="- 마감은 회차 마지막 날 23:59(KST)예요." minHeight={150} maxHeight="none" tools={RULE_TOOLS} /></EditorField>
          <Field label="최소 인원 (선택)" error={errors.minMembers}><input name="minMembers" aria-invalid={!!errors.minMembers} type="number" inputMode="numeric" min={1} className={field} value={v.minMembers} onChange={(e) => set("minMembers", e.target.value)} /></Field>
          <div className="flex items-center justify-between">
            <span><span className="block text-[14px] font-semibold">그룹장도 과제 수행</span><span className="block text-[12px] text-muted">끄면 공통 과제 담당자에서 빠져요 (시작 후 변경 불가)</span></span>
            <Switch on={v.leaderDoesTasks} onChange={(x) => set("leaderDoesTasks", x)} label="그룹장도 과제 수행" />
          </div>
        </div>
      )}

      {beforeSubmit}
      {serverError && <p role="alert" className="m-0 text-[13px] text-warn">{serverError}</p>}
      <button type="submit" disabled={busy} className="flex min-h-12 items-center justify-center rounded-[24px] bg-navy px-4 text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">{busy ? "만드는 중…" : submitLabel}</button>
    </form>
  );
}
