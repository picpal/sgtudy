"use client";

import { useState } from "react";
import { md } from "@/lib/date";
import { useMe } from "@/lib/me";
import { TypeBadge } from "../bits";
import { CODE_COLOR, CODE_LABEL, myCode, removePlan, type ParentNode } from "../model";
import { InlineConfirm } from "./InlineConfirm";
import { AddRow, QuickAdd } from "./QuickAdd";

/** 편집 화면에서만 — 순서(위/아래)·삭제는 즉시 RPC, 끝에 빠른 과제 추가 */
export type ChildListEdit = { onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void; onAdd: (title: string) => Promise<boolean>; busy: string | null; canAdd: boolean };

type Props = { parent: ParentNode; onOpen: (id: string) => void; edit?: ChildListEdit };

const IconBtn = ({ label, d, onClick, disabled, tone }: { label: string; d: string; onClick: () => void; disabled?: boolean; tone?: "warn" }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={`flex h-11 w-11 items-center justify-center rounded-[10px] bg-transparent disabled:opacity-35 ${tone === "warn" ? "text-warn" : "text-ink-3"}`}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  </button>
);

/** 회차(·묶음) 상세/편집 화면의 "이 회차의 과제" 목록. 내용만큼 자란다(안쪽 스크롤 없음) */
export function ChildList({ parent, onOpen, edit }: Props) {
  const meId = useMe()?.id ?? null;
  const [ask, setAsk] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby={`kids-${parent.id}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`kids-${parent.id}`} className="m-0 text-[13px] font-semibold text-ink-3">
          이 회차의 과제 {parent.kids.length}개
        </h3>
        {edit && <span className="shrink-0 text-[12px] font-medium text-muted">진척률 {parent.pct}%</span>}
      </div>
      {parent.kids.length === 0 && !edit?.canAdd ? (
        <p className="m-0 rounded-[12px] border border-dashed border-line-3 px-4 py-3 text-[13px] text-muted">아직 과제가 없어요</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
          {parent.kids.map((k, i) => {
            const mine = k.leaf ? myCode(k, meId) : null;
            const plan = ask === k.id ? removePlan(k) : null;
            return (
              <li key={k.id} aria-busy={edit?.busy === k.id} className="border-b border-line-2 last:border-b-0" style={{ opacity: k.archived ? 0.55 : 1 }}>
                <div className="flex items-center bg-surface">
                  <button type="button" onClick={() => onOpen(k.id)} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[2px] bg-surface px-3 py-2 text-left text-ink">
                    {k.leaf ? <TypeBadge type={k.type} /> : <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">묶음</span>}
                    <span className="min-w-[min(100%,8rem)] flex-1 text-[14px] font-medium [overflow-wrap:anywhere]">{k.title}</span>
                    <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">
                      {md(k.s)} – {md(k.e)}
                    </span>
                    {mine && (
                      <span className="shrink-0 text-[12px] font-semibold" style={{ color: CODE_COLOR[mine] }}>
                        나 · {CODE_LABEL[mine]}
                      </span>
                    )}
                    <span className="w-9 shrink-0 text-right text-[12px] font-semibold text-ink-2">{k.asg ? `${k.sub}/${k.asg}` : ""}</span>
                    {k.archived && <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">보관됨</span>}
                  </button>
                  {edit && (
                    <span className="flex shrink-0 items-center pr-1">
                      <IconBtn label={`${k.title} 위로`} disabled={i === 0 || k.archived || k.temp || edit.busy !== null} onClick={() => edit.onMove(k.id, -1)} d="m6 15 6-6 6 6" />
                      <IconBtn label={`${k.title} 아래로`} disabled={i === parent.kids.length - 1 || k.archived || k.temp || edit.busy !== null} onClick={() => edit.onMove(k.id, 1)} d="m6 9 6 6 6-6" />
                      <IconBtn label={`${k.title} 삭제`} tone="warn" disabled={k.temp || edit.busy !== null} onClick={() => setAsk(k.id)} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                    </span>
                  )}
                </div>
                {edit && plan && (
                  <div className="border-t border-line-2 bg-surface-2 p-2">
                    <InlineConfirm
                      text={plan.kind === "none" ? plan.reason : plan.text}
                      onCancel={() => setAsk(null)}
                      actions={
                        plan.kind === "none"
                          ? []
                          : [
                              {
                                label: plan.label,
                                tone: "danger",
                                onClick: () => {
                                  setAsk(null);
                                  edit.onRemove(k.id);
                                },
                              },
                            ]
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
          {edit?.canAdd && (
            <li className="[&>div]:border-b-0">
              {adding ? <QuickAdd round={parent} indent={0} onAdd={edit.onAdd} onClose={() => setAdding(false)} /> : <AddRow round={parent} indent={0} onOpen={() => setAdding(true)} />}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
