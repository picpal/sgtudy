"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { md } from "@/lib/date";
import { ArchivedBadge, TypeBadge } from "../bits";
import { codeLabel, isPersonal, type LeafNode, type ParentNode } from "../model";
import { groupOthers, isDone, othersHeading, ownerCode, personalActions, sectionCounts, statusColor } from "../personal";
import type { RoomStatus } from "../submission";
import type { CurriculumApi } from "../useCurriculumApi";
import { AddRow, QuickAdd } from "./QuickAdd";

type Props = {
  round: ParentNode;
  meId: string | null;
  isLeader: boolean;
  roomStatus: RoomStatus;
  /** Curriculum.personal — 추가 자격(그룹장·ACTIVE 멤버 + 방 RECRUIT·ACTIVE)·회차당 한도 */
  personal?: { canAdd: boolean; perRound: number };
  api: Pick<CurriculumApi, "createPersonal" | "completePersonal">;
  onOpen: (id: string) => void;
};

const NOT_ACTIVE = "스터디가 진행 중일 때 완료할 수 있어요";

/** 완료 체크 — 44px 버튼, 보이는 원은 22px. 완료면 초록 채움 + 체크. 비활성 이유(title)는 툴팁이 안 뜨는 환경을 위해 aria-describedby 로도 */
function CheckButton({ n, done, disabled, busy, title, onClick }: { n: LeafNode; done: boolean; disabled: boolean; busy: boolean; title?: string; onClick: () => void }) {
  const whyId = `why-${n.id}`;
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={`${n.title} ${done ? "완료 취소" : "완료로 표시"}`}
      aria-busy={busy || undefined}
      aria-describedby={disabled && title ? whyId : undefined}
      disabled={disabled || busy}
      title={title}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 ${done ? "border-[#1E9E6A] bg-[#1E9E6A] text-white" : disabled ? "border-line-3 bg-surface-2" : "border-[#7D8BA1] bg-surface"} ${busy ? "opacity-50" : ""}`}
      >
        {done && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
      {disabled && title && (
        <span id={whyId} className="sr-only">
          {title}
        </span>
      )}
    </button>
  );
}

/** 목표 한 줄의 본문 버튼(누르면 그 상세) — [개인] 제목 · 기간 · 상태 */
function GoalBody({ n, onOpen, padLeft }: { n: LeafNode; onOpen: (id: string) => void; padLeft: string }) {
  const c = ownerCode(n);
  return (
    <button type="button" onClick={() => onOpen(n.id)} className={`flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[2px] py-2 pr-3 text-left text-ink ${padLeft}`}>
      <TypeBadge type="개인" />
      <span className={`min-w-[min(100%,8rem)] flex-1 text-[14px] font-medium [overflow-wrap:anywhere] ${isDone(c) ? "text-ink-3" : ""}`}>{n.title}</span>
      <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">
        {md(n.s)} – {md(n.e)}
      </span>
      <span className="shrink-0 text-[12px] font-semibold text-ink-2" style={{ color: statusColor(c) }}>
        {codeLabel(n, c)}
      </span>
      {n.archived && <ArchivedBadge left={n.ownerLeft} />}
    </button>
  );
}

const Disclosure = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined }}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/**
 * 회차 상세의 개인 목표 섹션 (스펙 §4.5) — 팀 과제 목록(ChildList) 아래.
 * "내 개인 목표" = 체크로 바로 완료 + 끝에 "＋ 내 목표 추가". "팀원 개인 목표" = 기본 접힘 → 멤버별 → 그 사람 목표(읽기 전용).
 */
export function PersonalSection({ round, meId, isLeader, roomStatus, personal, api, onOpen }: Props) {
  const mine = round.kids.filter((k): k is LeafNode => isPersonal(k) && meId !== null && k.ownerId === meId);
  const others = groupOthers(round, meId, isLeader);
  // 머리 개수는 보관 제외(personalStats 와 같은 기준) — 보관된 줄은 흐리게 보여도 세지 않는다
  const counts = sectionCounts(round, meId, isLeader);
  const othersRows = others.reduce((a, g) => a + g.items.length, 0);
  const eligible = !!personal?.canAdd;
  const canAdd = eligible && !round.archived && !round.temp;
  const limit = personal?.perRound ?? 20;
  const atLimit = counts.mine.total >= limit;
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState<Record<string, boolean>>({});

  const toggle = async (n: LeafNode, done: boolean) => {
    setBusy(n.id);
    try {
      await api.completePersonal(n.id, !done);
    } finally {
      setBusy(null);
    }
  };
  const closeAdd = () => {
    setAdding(false);
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLButtonElement>(`[data-add-personal="${CSS.escape(round.id)}"]`)?.focus();
    });
  };

  const showMine = mine.length > 0 || canAdd;
  if (!showMine && othersRows === 0) return null;

  return (
    <>
      {showMine && (
        <section aria-labelledby={`mine-${round.id}`} className="flex flex-col gap-2">
          <h3 id={`mine-${round.id}`} className="m-0 text-[13px] font-semibold text-ink-3">
            내 개인 목표 {counts.mine.total}개{counts.mine.total > 0 ? ` · ${counts.mine.done}개 완료` : ""}
          </h3>
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
            {mine.map((k) => {
              const done = isDone(ownerCode(k));
              const a = personalActions(k, meId, isLeader, roomStatus, eligible);
              const why = a.complete ? undefined : k.archived ? "보관된 목표는 완료할 수 없어요" : roomStatus === "active" ? undefined : NOT_ACTIVE;
              return (
                <li key={k.id} className="flex items-center border-b border-line-2 bg-[#F7F9FC] pl-1 last:border-b-0" style={{ opacity: k.archived ? 0.55 : 1 }}>
                  <CheckButton n={k} done={done} disabled={!a.complete} busy={busy === k.id} title={why} onClick={() => void toggle(k, done)} />
                  <GoalBody n={k} onOpen={onOpen} padLeft="pl-1" />
                </li>
              );
            })}
            {canAdd && (
              <li className="[&>div]:border-b-0">
                {atLimit ? (
                  <p className="m-0 bg-[#F7F9FC] px-4 py-3 text-[13px] text-muted">이 회차에는 개인 목표를 {limit}개까지 둘 수 있어요</p>
                ) : adding ? (
                  <QuickAdd round={round} indent={0} tone="personal" onAdd={(t) => api.createPersonal(round.id, t)} onClose={closeAdd} />
                ) : (
                  <AddRow round={round} indent={0} tone="personal" onOpen={() => setAdding(true)} />
                )}
              </li>
            )}
          </ul>
        </section>
      )}

      {othersRows > 0 && (
        <section aria-label={othersHeading(counts.others, counts.othersArchived, "개")} className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={othersOpen}
            aria-controls={`others-${round.id}`}
            onClick={() => setOthersOpen((v) => !v)}
            className="inline-flex min-h-11 items-center gap-[6px] self-start rounded-[10px] pr-2 text-[13px] font-semibold text-ink-3"
          >
            <Disclosure open={othersOpen} />
            {othersHeading(counts.others, counts.othersArchived, "개")}
          </button>
          {othersOpen && (
            <ul id={`others-${round.id}`} className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
              {others.map((g) => {
                const open = !!ownerOpen[g.ownerId];
                return (
                  <li key={g.ownerId} className="border-b border-line-2 last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOwnerOpen((p) => ({ ...p, [g.ownerId]: !open }))}
                      className="flex min-h-11 w-full items-center gap-2 bg-surface px-3 py-2 text-left text-[14px] font-medium text-ink"
                    >
                      <Disclosure open={open} />
                      <Avatar name={g.name} size={20} tone={g.tone} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {g.name} ({g.count})
                      </span>
                      {g.done > 0 && <span className="shrink-0 text-[12px] text-muted">· {g.done}개 완료</span>}
                    </button>
                    {open && (
                      <ul className="m-0 flex list-none flex-col border-t border-line-2 p-0">
                        {g.items.map((k) => (
                          <li key={k.id} className="flex items-center border-b border-line-2 bg-[#F7F9FC] last:border-b-0" style={{ opacity: k.archived ? 0.55 : 1 }}>
                            <GoalBody n={k} onOpen={onOpen} padLeft="pl-[34px]" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
