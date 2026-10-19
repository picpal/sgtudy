"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { PageBody } from "@/components/ui/PageBody";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Switch } from "@/components/ui/Switch";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { rpc, toApiError } from "@/lib/api/errors";
import type { RoomDetail } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { useToday } from "@/lib/today";
import { EditorField, FIELD_CLASS as field, Field, JoinModeRadio, RULE_TOOLS, SwitchRow, TagPicker } from "./fields";
import { putRoomTags, toPutArgs, type TagItem } from "./tags";
import { EMPTY_VALUES, clampCp, firstErrorKey, maxEndDate, revalidateOnChange, serverFieldError, toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

export function NewRoomForm() {
  const router = useRouter();
  const today = useToday();
  const [v, setV] = useState<NewRoomValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ReturnType<typeof validateNewRoom>>({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const inFlight = useRef(false); // 같은 프레임 두 번 제출(disabled 반영 전) 막기 — DRAFT 방 중복 생성 방지
  const set = <K extends keyof NewRoomValues>(k: K, val: NewRoomValues[K]) => {
    const next = { ...v, [k]: val };
    setV(next);
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
  const [tags, setTags] = useState<TagItem[]>([]);
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
      router.push(routes.myStudyEdit(room.slug));
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
    <div className="flex min-h-screen flex-col">
      <AppHeader bell={<NotificationBell />} />
      <PageBody>
        <main className="mx-auto w-full max-w-[880px] rounded-[20px] bg-surface p-7 max-sm:p-5">
          <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">방 만들기</h1>
          <p className="mb-6 mt-[6px] text-[14px] text-muted">채팅방 만들듯 30초면 충분해요. 진행목표는 만든 뒤 천천히 채워요.</p>
          <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {/* 한도는 서버와 같은 코드 포인트(60/100)로 자른다 — maxLength 는 UTF-16 단위라 이모지에서 어긋난다(Q2-16) */}
            <Field label="제목 (= 최상위 목표)" required error={errors.title}><input name="title" className={field} value={v.title} onChange={(e) => set("title", clampCp(e.target.value, 60))} placeholder="예) AWS SAA 자격증 3개월 완주" autoFocus aria-required aria-invalid={!!errors.title} /></Field>
            <Field label="한 줄 소개" required hint="방 목록 카드에 제목과 함께 보여요 · 100자까지" error={errors.intro}><input name="intro" className={field} value={v.intro} onChange={(e) => set("intro", clampCp(e.target.value, 100))} placeholder="예) 매주 한 챕터씩 읽고 기출 20문제를 풀어요" aria-required aria-invalid={!!errors.intro} /></Field>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="시작일" required hint="오늘 이후" error={errors.startDate}><input name="startDate" aria-required aria-invalid={!!errors.startDate} type="date" className={field} min={today} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} onBlur={() => recheck("startDate")} /></Field>
              <Field label="종료일" required hint="시작일부터 최대 1년" error={errors.endDate}><input name="endDate" aria-required aria-invalid={!!errors.endDate} type="date" className={field} min={v.startDate || today} max={maxEndDate(v.startDate) || undefined} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} onBlur={() => recheck("endDate")} /></Field>
            </div>
            <Field label="최대 인원" required hint="2~100명 · 그룹장 포함" error={errors.maxMembers}><input name="maxMembers" aria-invalid={!!errors.maxMembers} type="number" inputMode="numeric" min={2} max={100} className={field} value={v.maxMembers} onChange={(e) => set("maxMembers", e.target.value)} /></Field>
            <SwitchRow title="공개 방" desc="끄면 초대 링크로만 들어올 수 있어요" on={v.isPublic} onChange={(x) => set("isPublic", x)} />
            <JoinModeRadio value={v.joinMode} onChange={(x) => set("joinMode", x)} />
            <TagPicker value={tags} onChange={setTags} />

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

            {serverError && <p role="alert" className="m-0 text-[13px] text-warn">{serverError}</p>}
            <button type="submit" disabled={busy} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">{busy ? "만드는 중…" : "방 만들기"}</button>
          </form>
        </main>
      </PageBody>
    </div>
  );
}
