"use client";

import { md } from "@/lib/date";
import { useMe } from "@/lib/me";
import { TypeBadge } from "../bits";
import { CODE_COLOR, CODE_LABEL, myCode, type ParentNode } from "../model";

type Props = { parent: ParentNode; onOpen: (id: string) => void };

/** 회차(·묶음) 상세/편집 화면의 "이 회차의 과제" 목록. 내용만큼 자란다(안쪽 스크롤 없음) */
export function ChildList({ parent, onOpen }: Props) {
  const meId = useMe()?.id ?? null;
  return (
    <section aria-labelledby={`kids-${parent.id}`} className="flex flex-col gap-2">
      <h3 id={`kids-${parent.id}`} className="m-0 text-[13px] font-semibold text-ink-3">
        이 회차의 과제 {parent.kids.length}개
      </h3>
      {parent.kids.length === 0 ? (
        <p className="m-0 rounded-[12px] border border-dashed border-line-3 px-4 py-3 text-[13px] text-muted">아직 과제가 없어요</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
          {parent.kids.map((k) => {
            const mine = k.leaf ? myCode(k, meId) : null;
            return (
              <li key={k.id} className="border-b border-line-2 last:border-b-0" style={{ opacity: k.archived ? 0.55 : 1 }}>
                <button type="button" onClick={() => onOpen(k.id)} className="flex min-h-11 w-full flex-wrap items-center gap-x-[10px] gap-y-[2px] bg-surface px-3 py-2 text-left text-ink">
                  {k.leaf ? <TypeBadge type={k.type} /> : <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">묶음</span>}
                  <span className="min-w-0 flex-1 text-[14px] font-medium [overflow-wrap:anywhere]">{k.title}</span>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
