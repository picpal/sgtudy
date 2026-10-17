"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeTitle } from "@/components/my-study/rounds";
import type { MeTasks } from "@/lib/api/types";
import { addBlockReason, addableRounds, addableStudies, defaultRound, personalCount } from "./calc";
import { period } from "./TaskRow";
import { studyTone } from "./tone";

const field = "h-11 rounded-[10px] border border-line-3 bg-surface px-[10px] text-[14px] text-ink";
const lbl = "flex min-w-0 flex-col gap-[6px] text-[12px] font-semibold text-ink-3";

const box = "rounded-[16px] border-[1.5px] border-slate-text/25 bg-slate-soft/40 p-[14px]";

/** 스터디 이름(점 + 제목) — 어느 방에 더하는지 늘 보이게 (QA Q3-2) */
function StudyName({ title, tone }: { title: string; tone: Parameters<typeof studyTone>[0] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-[6px] text-[14px] font-semibold text-ink">
      <span aria-hidden="true" className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: studyTone(tone).dot }} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
    </span>
  );
}

/**
 * 머리 "＋ 내 목표 추가" 폼 — 스터디 · 회차(그 방 canAdd 회차, 기본 = 현재 회차) · 제목.
 * 스터디 칩으로 방을 골랐으면(chosenSlug) 그 방에만 더한다 — 못 더하는 방이면 폼 대신 이유 (QA Q3-2).
 * "전체" 이고 추가 가능한 방이 여럿이면 스터디 고르기, 하나면 이름만.
 */
export function AddPersonalForm({ data, chosenSlug, onAdd, onClose }: { data: MeTasks; chosenSlug?: string; onAdd: (slug: string, roundId: string, title: string) => Promise<boolean>; onClose: () => void }) {
  const chosen = data.studies.find((s) => s.slug === chosenSlug) ?? null;
  const blocked = chosen ? addBlockReason(data, chosen.slug) : null;
  const studies = chosen ? (blocked ? [] : [chosen]) : addableStudies(data);
  const initSlug = studies[0]?.slug ?? "";
  const [slug, setSlug] = useState(initSlug);
  const [roundId, setRoundId] = useState(() => defaultRound(data, initSlug));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const rounds = addableRounds(data, slug);
  // 재조회로 고른 회차가 가득 차 목록에서 빠지면 첫 회차로 (select 표시와 제출 대상이 어긋나지 않게)
  const round = rounds.find((r) => r.id === roundId) ?? rounds[0];
  const mine = round ? personalCount(data, round.id) : 0;
  const currentId = studies.find((s) => s.slug === slug)?.currentRoundId;

  const submit = async () => {
    const t = normalizeTitle(title);
    if (!t || !round || busy) return;
    setBusy(true);
    const ok = await onAdd(slug, round.id, t);
    setBusy(false);
    if (!ok) titleRef.current?.focus();
  };

  if (chosen && blocked) {
    return (
      <div role="status" className={`${box} flex flex-wrap items-center gap-x-3 gap-y-2`}>
        <p className="m-0 flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-[13px] text-ink-2">
          <StudyName title={chosen.title} tone={chosen.tone} />
          <span>지금은 내 목표를 추가할 수 없어요 · {blocked}</span>
        </p>
        <button type="button" onClick={onClose} className="h-11 shrink-0 rounded-[12px] border border-line-3 bg-surface px-[18px] text-[14px] font-semibold text-ink">
          닫기
        </button>
      </div>
    );
  }
  if (studies.length === 0) {
    return (
      <div className={`${box} text-[13px] text-muted`}>
        지금 내 목표를 추가할 수 있는 스터디가 없어요 · 모집 중이거나 진행 중인 스터디에서 추가할 수 있어요
      </div>
    );
  }
  const only = studies.length === 1 ? studies[0] : null;
  return (
    <form
      aria-label="내 목표 추가"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className={`${box} flex flex-col gap-[10px]`}
    >
      {only && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-ink-3">
          스터디
          <StudyName title={only.title} tone={only.tone} />
        </p>
      )}
      <div className="flex flex-wrap gap-[10px] [&>*]:flex-[1_1_220px]">
        {!only && (
          <label className={lbl}>
            스터디
            <select
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setRoundId(defaultRound(data, e.target.value));
              }}
              className={field}
            >
              {studies.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={lbl}>
          회차
          <select value={round?.id ?? ""} onChange={(e) => setRoundId(e.target.value)} className={field}>
            {rounds.map((r) => {
              const cur = currentId === r.id;
              return (
                <option key={r.id} value={r.id}>
                  {[r.label, r.title].filter(Boolean).join(" ")}
                  {cur ? " (지금 회차)" : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label className={`${lbl} !flex-[2_1_280px]`}>
          제목
          <input ref={titleRef} type="text" value={title} maxLength={80} readOnly={busy} onChange={(e) => setTitle(e.target.value)} placeholder="예) 강의 3강 듣기" className={`${field} border-[1.5px] border-slate-text px-3`} />
        </label>
      </div>
      {round && (
        <p className="m-0 text-[12px] text-muted">
          기간은 회차 기간({period(round.startDate, round.endDate)})으로 정해져요 · 이 회차 내 목표 {mine}/{data.personalPerRound}
        </p>
      )}
      <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
        <button type="button" onClick={onClose} className="h-11 rounded-[12px] border border-line-3 bg-surface px-[18px] text-[14px] font-semibold text-ink">
          닫기
        </button>
        <button type="submit" disabled={busy || !normalizeTitle(title)} className="h-11 rounded-[12px] bg-navy px-[22px] text-[14px] font-semibold text-white disabled:opacity-50">
          추가
        </button>
      </div>
    </form>
  );
}
