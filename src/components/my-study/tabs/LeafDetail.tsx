"use client";

import { Avatar } from "@/components/ui/Avatar";
import { md, weekdayKo } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { CODE_COLOR, CODE_LABEL, ddayLabel, type LeafNode } from "../model";

/** 참가자 보기에서 리프 행 아래 펼쳐지는 상세 */
export function LeafDetail({ n }: { n: LeafNode }) {
  const today = useToday();
  const meId = useMe()?.id;
  return (
    <div className="flex flex-col gap-[10px] border-b border-line-2 bg-surface-2 py-3 pb-4 pl-[60px] pr-4 max-[390px]:pl-4">
      <div className="text-[12px] text-muted">
        {n.crumb} · {md(n.s)}({weekdayKo(n.s)}) – {md(n.e)}({weekdayKo(n.e)}) · {n.state === "complete" ? "전원 제출" : ddayLabel(today, n.e)}
      </div>
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
