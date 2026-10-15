"use client";

import { Avatar } from "@/components/ui/Avatar";
import { useMe } from "@/lib/me";
import { MarkdownView } from "../MarkdownView";
import { CODE_COLOR, CODE_LABEL, type LeafNode } from "../model";

/** 보기 상세 화면의 과제 본문 — 설명 + 담당자별 상태 */
export function LeafBody({ n }: { n: LeafNode }) {
  const meId = useMe()?.id;
  return (
    <div className="flex flex-col gap-3">
      {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">과제 설명이 아직 없어요</p>}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {n.people.map((p) => {
          const me = p.userId === meId;
          return (
            <span key={p.userId} className="flex items-center gap-2 rounded-[10px] border border-line px-[10px] py-2" style={{ background: me ? "#EEF3FF" : "#FFFFFF" }}>
              <Avatar name={p.name} size={30} tone={p.tone} />
              <span className="flex min-w-0 flex-col">
                <span className="whitespace-nowrap text-[13px] font-semibold">
                  {p.name}
                  {me ? " (나)" : ""}
                </span>
                <span className="text-[12px] font-semibold" style={{ color: CODE_COLOR[p.c] }}>
                  {CODE_LABEL[p.c]}
                </span>
              </span>
            </span>
          );
        })}
      </div>
      {n.asg === 0 && <span className="text-[13px] text-amber-text">아직 담당자가 없어요</span>}
      {/* plan 06: 제출 */}
    </div>
  );
}
