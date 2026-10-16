"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { mmdd } from "@/lib/api/format";
import { TypeBadge } from "../bits";
import type { LeafNode, ParentNode } from "../model";
import { draftOf, personalPatch, pickRound, roundWarning, type PersonalDraft } from "../personal";
import { roundOptions } from "../rounds";
import type { CurriculumApi } from "../useCurriculumApi";

type Props = {
  n: LeafNode;
  roots: ParentNode[];
  /** 방 기간 — 날짜 입력의 min/max (서버 INVALID_PERIOD room 과 같은 범위) */
  period: { start: string; end: string };
  api: Pick<CurriculumApi, "updatePersonal">;
  /** 저장했거나 취소 — 상세로 돌아간다 */
  onDone: () => void;
  /** 미저장 수정 여부 — 상세의 [← 진행목표]·Esc 확인용 */
  onDirtyChange: (dirty: boolean) => void;
};

const field = "h-11 w-full min-w-0 rounded-[10px] border border-line-3 bg-surface px-3 text-[14px] text-ink";
const label = "flex min-w-0 flex-col gap-[6px] text-[12px] font-semibold text-ink-3";

/**
 * 개인 목표 편집 폼 (스펙 §4.6, 시안 B-2) — 상세 자리에서 펼쳐진다. 제목 · 회차(+ 기간 미리보기) · 시작/마감 · 설명.
 * 유형·담당자 없음. 저장 = personal_update 한 번(회차 이동 + 기간 + 내용 원자적).
 */
export function PersonalForm({ n, roots, period, api, onDone, onDirtyChange }: Props) {
  const [d, setD] = useState<PersonalDraft>(() => draftOf(n));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descId = useId();
  const opts = roundOptions(roots);
  const round = roots.find((r) => r.id === d.roundId) ?? null;
  const patch = personalPatch(n, d);
  const dirty = Object.keys(patch).length > 0;
  const title = d.title.trim();
  const badDates = !d.s || !d.e || d.s > d.e;
  const warn = roundWarning(d, round);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  // 저장하지 않은 수정이 있는 채로 새로고침·탭 닫기 → 브라우저 확인 (앱 안 이동은 상세의 확인 상자)
  useEffect(() => {
    if (!dirty) return;
    const warnLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warnLeave);
    return () => window.removeEventListener("beforeunload", warnLeave);
  }, [dirty]);

  // 회차를 고르면 팀 과제 이동과 같은 규칙으로 기간을 제안해 날짜 칸에 채운다 — 사용자가 다시 고칠 수 있다
  const choose = (id: string) => {
    const r = pickRound(n, d, roots, id);
    if (!r) return;
    setD(r.draft);
    setNote(r.note);
  };
  // 날짜를 손으로 고치면 회차 이동 미리보기는 더 이상 맞지 않는다 — 지운다
  const setDate = (k: "s" | "e", v: string) => {
    if (!v) return;
    setD((x) => ({ ...x, [k]: v }));
    setNote("");
  };

  const save = async () => {
    if (!title || badDates || saving) return;
    if (!dirty) {
      onDone();
      return;
    }
    const to = patch.roundId ? roots.find((r) => r.id === patch.roundId) : null;
    setSaving(true);
    const cur = await api.updatePersonal(n.id, patch, to ? `${to.label ?? to.title}로 옮겼어요` : "저장했어요");
    setSaving(false);
    if (cur) onDone();
  };

  return (
    <form
      aria-labelledby={`pf-${n.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      <h2 id={`pf-${n.id}`} className="m-0 flex items-center gap-[10px] text-[20px] font-bold text-ink">
        <TypeBadge type="개인" />
        개인 목표 편집
      </h2>
      {warn && (
        <p role="status" className="m-0 rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
          {warn} · 저장은 할 수 있어요
        </p>
      )}
      <label className={label}>
        <span>
          제목 <span className="font-normal text-muted">{d.title.length}/80</span>
        </span>
        <input
          ref={titleRef}
          type="text"
          value={d.title}
          maxLength={80}
          aria-invalid={!title || undefined}
          onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
          className={`${field} h-[52px] text-[17px] font-bold`}
        />
        {!title && <span className="text-[12px] font-medium text-warn">제목을 입력해 주세요</span>}
      </label>
      <label className={label}>
        회차
        <select value={d.roundId} onChange={(e) => choose(e.target.value)} className={field}>
          {!opts.some((o) => o.id === d.roundId) && <option value={d.roundId}>{n.crumb}</option>}
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text}
            </option>
          ))}
        </select>
      </label>
      {note && (
        <p role="status" className="-mt-2 m-0 rounded-[10px] bg-[#E3ECFD] px-3 py-[10px] text-[13px] font-medium text-[#2F5BC2]">
          {note}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          시작
          <input type="date" value={d.s} min={period.start} max={period.end} required onChange={(e) => setDate("s", e.target.value)} className={field} />
        </label>
        <label className={label}>
          마감
          <input type="date" value={d.e} min={period.start} max={period.end} required onChange={(e) => setDate("e", e.target.value)} className={field} />
        </label>
      </div>
      {badDates && <p className="-mt-2 m-0 text-[12px] font-medium text-warn">마감일은 시작일 이후여야 해요</p>}
      <div className="flex flex-col gap-[6px]">
        <span id={descId} className="text-[12px] font-semibold text-ink-3">
          설명
        </span>
        <MarkdownEditor labelledBy={descId} value={d.desc} onChange={(v) => setD((x) => ({ ...x, desc: v }))} placeholder="무엇을 할지, 참고 링크 등을 적어 두세요" minHeight="240px" maxHeight="none" expandable={false} />
      </div>
      <p className="m-0 text-[12px] text-muted">
        유형·담당자는 없어요 · 기간은 방 기간({mmdd(period.start)} – {mmdd(period.end)}) 안에서 정해 주세요
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-11 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
          취소
        </button>
        <button type="submit" disabled={!title || badDates || saving} aria-busy={saving || undefined} className="h-11 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-50">
          저장
        </button>
      </div>
    </form>
  );
}
