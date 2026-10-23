"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { PageBody } from "@/components/ui/PageBody";
import type { RoundsResponse } from "@/lib/ai/rounds/schema";
import type { Draft } from "@/lib/ai/schema";
import { applyRoundsPlan, tryOpenRecruit, withOnly } from "@/lib/api/plan";
import { changedKeys, draftKeys, fromNewRoomValues, toNewRoomValues, toTagItems, type FilledKey } from "@/lib/ai/toForm";
import { useToday } from "@/lib/today";
import { useLeaveConfirm } from "@/lib/useLeaveConfirm";
import { postRounds } from "./interview/api";
import { InterviewPanel } from "./interview/InterviewPanel";
import { INITIAL, isDirty, reduce, userLines } from "./interview/state";
import { NewRoomForm } from "./NewRoomForm";
import { RecruitNowField } from "./RecruitNowField";
import { includedStats, RoundsDraftSection } from "./RoundsDraftSection";
import type { TagItem } from "./tags";
import { EMPTY_VALUES, firstErrorKey, validateNewRoom, type NewRoomValues } from "./validate";

export type Mode = "manual" | "ai";

/**
 * 방 만들기 화면 — 「직접 입력 | AI 인터뷰」(D12). 두 모드가 values·tags 하나를 공유한다(D13).
 * aiEnabled=false(키 없음)면 세그먼트 없이 지금 폼 그대로. 인터뷰는 방을 만들지 않고, 끝나면 직접 입력 모드(미리보기)로 넘긴다
 */
export function NewRoomScreen({ aiEnabled, initialMode }: { aiEnabled: boolean; initialMode: Mode }) {
  const router = useRouter();
  const today = useToday();
  const [values, setValues] = useState<NewRoomValues>(EMPTY_VALUES);
  const [tags, setTags] = useState<TagItem[]>([]);
  /** 사용자가 고쳤거나 인터뷰가 채운 칸 — 인터뷰에는 이 칸만 "이미 채움" 으로 보낸다(기본값은 다시 묻게) */
  const [filled, setFilled] = useState<ReadonlySet<FilledKey>>(new Set());
  const [aiHidden, setAiHidden] = useState(false);
  const showAi = aiEnabled && !aiHidden;
  const [mode, setMode] = useState<Mode>(showAi ? initialMode : "manual");
  const [interview, dispatch] = useReducer(reduce, INITIAL);
  const [banner, setBanner] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | undefined>();
  const tabsId = useId();
  // 회차 초안(2단계) — 받은 때의 기간을 함께 둔다. 폼에서 기간을 바꾸면 stale(적용 안 함, [다시 생성] 안내)
  const [rounds, setRounds] = useState<{ data: RoundsResponse; start: string; end: string } | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [regen, setRegen] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // 바로 모집 시작(D37) — 회차 초안이 있으면 켜진 채, 인터뷰에서 "아니요" 면 꺼진 채
  const [openRecruit, setOpenRecruit] = useState(true);

  const addFilled = (keys: FilledKey[]) => setFilled((s) => (keys.every((k) => s.has(k)) ? s : new Set([...s, ...keys])));
  const onFormChange = (next: NewRoomValues) => {
    addFilled(changedKeys(values, next));
    setValues(next);
  };
  const onTags = (t: TagItem[]) => {
    addFilled(["tags"]);
    setTags(t);
  };
  const draft = useMemo(() => fromNewRoomValues(values, tags, filled), [values, tags, filled]);
  const onDraft = (d: Draft) => {
    setValues((v) => toNewRoomValues(d, v));
    setTags((t) => toTagItems(d, t));
    addFilled(draftKeys(d));
  };

  const toManual = (note: string | null) => {
    setBanner(note);
    const errs = validateNewRoom(values, today);
    setFocusField(note ? (firstErrorKey(errs) ?? undefined) : undefined);
    setMode("manual");
  };
  const onFinish = () => toManual("AI 인터뷰로 채운 초안이에요 · 확인하고 만들어 주세요");
  const onRounds = (data: RoundsResponse) => {
    setRounds({ data, start: values.startDate, end: values.endDate });
    setExcluded(new Set());
    setRegen({ busy: false, error: null });
  };
  const regenerate = async () => {
    setRegen({ busy: true, error: null });
    const r = await postRounds({ draft, userLines: userLines(interview), style: interview.style });
    if (r.ok) onRounds(r.data);
    else setRegen({ busy: false, error: r.err.message });
  };
  const toggleRound = (i: number) => setExcluded((s) => {
    const n = new Set(s);
    if (!n.delete(i)) n.add(i);
    return n;
  });
  const stale = !!rounds && (rounds.start !== values.startDate || rounds.end !== values.endDate);
  const inc = rounds && !stale ? includedStats(rounds.data, excluded) : null;
  // 모집 시작은 말단 과제(과제·시험 리프)가 1개 이상 함께 적용될 때만(ROOM_NO_LEAF_TASK)
  const canRecruit = !!inc && inc.leaves > 0;
  const recruitNow = openRecruit && canRecruit;
  const withRounds = !!inc && inc.rounds > 0;
  const submitLabel = withRounds ? `방 만들기 · 회차 ${inc.rounds}개${recruitNow ? " · 바로 모집" : " 함께"}` : "방 만들기";
  // 방이 만들어진 뒤: 회차 적용 → (적용됐고 켰으면) 모집 시작. 결과는 note — 편집 화면이 토스트로 알린다
  const afterCreate = withRounds
    ? async (slug: string) => {
        const r = await applyRoundsPlan(slug, withOnly(rounds!.data.plan, excluded));
        if (r !== "applied") return r;
        if (!recruitNow) return null;
        const o = await tryOpenRecruit(slug);
        return o === "applied" ? null : o;
      }
    : undefined;
  const onBudgetExceeded = (message: string) => {
    setAiHidden(true); // 이번 방문 동안 세그먼트를 숨긴다(§10)
    toManual(message);
  };

  // 인터뷰를 한 턴이라도 했으면 떠날 때 묻는다(대화는 저장되지 않는다)
  const dirty = isDirty(interview);
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);
  const leaveAsk = useLeaveConfirm(dirty, (href) => router.push(href));

  const moreOpen = !!(values.descriptionMd.trim() || values.rulesMd.trim() || values.minMembers.trim() || !values.leaderDoesTasks);

  const form = (
    <NewRoomForm
      key={`form-${mode}`}
      values={values}
      tags={tags}
      onChange={onFormChange}
      onTagsChange={onTags}
      initialMore={moreOpen}
      initialFocus={focusField}
      banner={banner && <p role="status" className="m-0 rounded-[12px] bg-[#F5FBF9] px-4 py-3 text-[14px] font-semibold text-mint">{banner}</p>}
      submitLabel={submitLabel}
      afterCreate={afterCreate}
      beforeSubmit={
        <>
          {rounds && <RoundsDraftSection data={rounds.data} excluded={excluded} onToggle={toggleRound} stale={stale} busy={regen.busy} error={regen.error} onRegenerate={() => void regenerate()} />}
          <RecruitNowField checked={recruitNow} disabled={!canRecruit} onChange={setOpenRecruit} isPublic={values.isPublic} joinMode={values.joinMode} />
        </>
      }
    />
  );

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader bell={<NotificationBell />} />
      <PageBody>
        <main className="mx-auto w-full max-w-[880px] rounded-[20px] bg-surface p-7 max-sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="m-0 text-[24px] font-bold tracking-[-0.02em]">방 만들기</h1>
            {showAi && <ModeTabs id={tabsId} mode={mode} onChange={(m) => (m === "manual" ? toManual(null) : (setBanner(null), setMode("ai")))} />}
          </div>
          <p className="mb-6 mt-[6px] text-[14px] text-muted">
            {mode === "ai" ? "몇 가지 질문에 답하면 방 초안을 채워 드려요. 만들기 전에 한 번 더 확인해요." : "채팅방 만들듯 30초면 충분해요. 진행목표는 만든 뒤 천천히 채워요."}
          </p>
          {!showAi ? (
            form
          ) : (
            <div role="tabpanel" id={`${tabsId}-${mode}-panel`} aria-labelledby={`${tabsId}-${mode}`}>
              {mode === "manual" ? (
                form
              ) : (
                <InterviewPanel
                  state={interview}
                  dispatch={dispatch}
                  draft={draft}
                  today={today}
                  onDraft={onDraft}
                  onFinish={onFinish}
                  onManual={() => toManual(null)}
                  onBudgetExceeded={onBudgetExceeded}
                  onRounds={onRounds}
                  onRecruitPref={setOpenRecruit}
                />
              )}
            </div>
          )}
        </main>
        <ConfirmDialog
          open={leaveAsk.pending !== null}
          title="인터뷰 내용이 사라져요"
          body="대화와 채운 값은 저장되지 않아요. 이동할까요?"
          confirmLabel="버리고 이동"
          danger
          onConfirm={leaveAsk.leave}
          onCancel={leaveAsk.stay}
        />
      </PageBody>
    </div>
  );
}

const MODES: [Mode, string][] = [["manual", "직접 입력"], ["ai", "AI 인터뷰"]];

/** 세그먼트(role=tablist) — ←/→ 로 이동하며 바로 전환 */
function ModeTabs({ id, mode, onChange }: { id: string; mode: Mode; onChange: (m: Mode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MODES.length) % MODES.length;
    onChange(MODES[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label="만드는 방법" className="inline-flex rounded-[22px] bg-surface-2 p-1">
      {MODES.map(([m, label], i) => {
        const on = mode === m;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${m}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${id}-${m}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(m)}
            onKeyDown={(e) => onKey(e, i)}
            className={`h-11 rounded-[18px] px-4 text-[14px] font-semibold ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-muted"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
