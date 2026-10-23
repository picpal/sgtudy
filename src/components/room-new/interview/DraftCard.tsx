"use client";

import type { Draft, Dropped } from "@/lib/ai/schema";
import { PAL, type Tone } from "@/lib/palette";

/* 초안 카드(D16·§9) — 필수 6개 체크 + 선택 항목 + 태그 + 반영 안 된 값 메모. 항목을 누르면 "…을 바꿀래요" 를 보낸다.
   데스크톱(≥1024) = 오른쪽 sticky 카드, 모바일 = 위에 붙는 접힘 바 「초안 n/6 · 펼치기」 */

type Row = { key: string; label: string; obj: string; value: string | null };

const md = (ymd?: string) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "");
const lines = (s?: string) => (s?.trim() ? s.trim().split("\n").filter((l) => l.trim()).length : 0);
const ACCESS = (d: Draft) => (d.isPublic === undefined ? null : d.isPublic ? (d.joinMode === "approval" ? "공개 · 승인 후 참가" : "공개 · 바로 참가") : "비공개 · 초대 링크");

/** 필수 6개 — label 은 카드에 보이는 이름, obj 는 "…을/를 바꿀래요" 에 쓰는 목적어 */
export function requiredRows(d: Draft): Row[] {
  return [
    { key: "title", label: "제목", obj: "제목을", value: d.title ?? null },
    { key: "intro", label: "소개", obj: "소개를", value: d.intro ?? null },
    { key: "startDate", label: "시작", obj: "시작일을", value: d.startDate ? `${md(d.startDate)}` : null },
    { key: "endDate", label: "종료", obj: "종료일을", value: d.endDate ? `${md(d.endDate)}` : null },
    { key: "maxMembers", label: "인원", obj: "인원을", value: d.maxMembers ? `${d.maxMembers}명${d.minMembers ? ` (최소 ${d.minMembers}명)` : ""}` : null },
    { key: "isPublic", label: "공개", obj: "공개·참가 방식을", value: ACCESS(d) },
  ];
}
export const filledCount = (d: Draft) => requiredRows(d).filter((r) => r.value).length;

function Card({ draft, dropped, onAskChange, disabled }: { draft: Draft; dropped: Dropped[]; onAskChange: (obj: string) => void; disabled?: boolean }) {
  const extras: Row[] = [
    { key: "descriptionMd", label: "설명", obj: "상세 설명을", value: lines(draft.descriptionMd) ? `${lines(draft.descriptionMd)}줄` : null },
    { key: "rulesMd", label: "규칙", obj: "규칙을", value: lines(draft.rulesMd) ? `${lines(draft.rulesMd)}줄` : null },
    { key: "leaderDoesTasks", label: "그룹장 과제", obj: "그룹장 과제를", value: draft.leaderDoesTasks === undefined ? null : draft.leaderDoesTasks ? "함께 해요" : "운영만" },
  ].filter((r) => r.value);
  const row = (r: Row, check: boolean) => (
    <li key={r.key}>
      <button
        type="button"
        disabled={disabled || !r.value}
        onClick={() => onAskChange(r.obj)}
        aria-label={r.value ? `${r.label}: ${r.value} — 바꾸기` : `${r.label}: 아직 안 채움`}
        className="flex min-h-11 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[14px] enabled:hover:bg-surface-2 disabled:cursor-default"
      >
        {check && (
          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${r.value ? "bg-mint text-white" : "border-2 border-line-3"}`}>
            {r.value ? "✓" : ""}
          </span>
        )}
        <span className="w-[52px] shrink-0 text-[12px] font-semibold text-ink-3">{r.label}</span>
        <span className={`min-w-0 flex-1 truncate ${r.value ? "text-ink" : "text-muted"}`}>{r.value ?? "—"}</span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="필수 항목" className="m-0 flex list-none flex-col p-0">{requiredRows(draft).map((r) => row(r, true))}</ul>
      {!!draft.tags?.length && (
        <ul aria-label="태그" className="m-0 flex list-none flex-wrap gap-[6px] px-2 p-0">
          {draft.tags.map((t) => {
            const pal = PAL[(t.tone as Tone) ?? "slate"] ?? PAL.slate;
            return <li key={t.slug ?? t.label} className="inline-flex h-7 items-center rounded-[14px] px-[10px] text-[12px] font-semibold" style={{ background: pal.bg, color: pal.fg }}>{t.label}</li>;
          })}
        </ul>
      )}
      {!!extras.length && (
        <>
          <p className="m-0 mt-1 px-2 text-[12px] font-semibold text-muted">더 설정</p>
          <ul className="m-0 flex list-none flex-col p-0">{extras.map((r) => row(r, false))}</ul>
        </>
      )}
      {!!dropped.length && (
        <ul aria-label="반영하지 못한 값" className="m-0 flex list-none flex-col gap-1 px-2 p-0">
          {dropped.map((x, i) => <li key={`${x.field}-${i}`} className="text-[12px] text-muted">반영 안 됨 · {x.reason}</li>)}
        </ul>
      )}
    </div>
  );
}

export function DraftCard(props: { draft: Draft; dropped: Dropped[]; onAskChange: (obj: string) => void; disabled?: boolean }) {
  const n = filledCount(props.draft);
  return (
    <>
      <aside aria-label="방 초안" className="sticky top-4 self-start rounded-[16px] border border-line bg-surface p-3 max-lg:hidden lg:order-2">
        <h2 className="m-0 mb-1 px-2 text-[14px] font-bold">초안 <span className="font-semibold text-muted">{n}/6</span></h2>
        <Card {...props} />
      </aside>
      <details className="group sticky top-0 z-[3] -mx-1 rounded-[14px] border border-line bg-surface px-1 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
          <span>초안 {n}/6</span>
          <span className="text-mint group-open:hidden">펼치기</span>
          <span className="hidden text-mint group-open:inline">접기</span>
        </summary>
        <div className="px-1 pb-2">
          <Card {...props} />
        </div>
      </details>
    </>
  );
}
