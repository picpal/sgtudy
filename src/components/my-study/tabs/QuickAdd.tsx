"use client";

import { useEffect, useRef, useState } from "react";
import { md } from "@/lib/date";
import { TypeBadge } from "../bits";
import type { ParentNode } from "../model";
import { normalizeTitle, shouldSubmitQuickAdd } from "../rounds";

const indentCls = "w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]";

/** inTree: role="tree" 의 직계 줄일 때 — 과제 행과 같은 aria-level 의 treeitem 으로 (펼침 상태 없음). `<li>` 안에서는 그냥 div */
const treeItem = (inTree: boolean, indent: number, label: string) => (inTree ? { role: "treeitem", "aria-level": indent + 2, "aria-label": label } : {});

/** team = 편집 목록 팀 과제(민트), personal = 보기 목록 "내 목표 추가"(슬레이트) */
export type AddTone = "team" | "personal";

/** "{회차 라벨} {회차 제목}" — 개인 목표 문구(스펙 §6)용 */
const roundName = (r: ParentNode) => (r.label ? `${r.label} ${r.title}` : r.title);

/** 펼친 회차 끝의 "+ 과제 추가" / "＋ 내 목표 추가" 줄 */
export function AddRow({ round, indent, onOpen, inTree = false, tone = "team" }: { round: ParentNode; indent: number; onOpen: () => void; inTree?: boolean; tone?: AddTone }) {
  const personal = tone === "personal";
  const label = personal ? `${roundName(round)}에 내 목표 추가` : `${round.title}에 과제 추가`;
  return (
    <div {...treeItem(inTree, indent, label)} className="flex min-h-11 items-center border-b border-line-2 bg-surface pl-2 pr-3">
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      <button
        type="button"
        {...(personal ? { "data-add-personal": round.id } : { "data-add-task": round.id })}
        onClick={onOpen}
        aria-label={label}
        className={`inline-flex h-11 items-center gap-[6px] rounded-[10px] px-2 text-[13px] font-semibold ${personal ? "text-[#3D4F6B]" : "text-mint"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {personal ? "내 목표 추가" : "과제 추가"}
      </button>
    </div>
  );
}

/** 빠른 추가 — Enter 로 만들고 입력은 다음 과제를 위해 비운 채 열어 둔다. Esc·빈 입력에서 포커스가 나가면 닫힘 */
export function QuickAdd({ round, indent, onAdd, onClose, inTree = false, tone = "team" }: { round: ParentNode; indent: number; onAdd: (title: string) => Promise<boolean>; onClose: () => void; inTree?: boolean; tone?: AddTone }) {
  const personal = tone === "personal";
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [last, setLast] = useState("");
  // 개인 목표는 낙관적 임시 행 없이 응답을 기다린다 — 그동안 입력에 aria-busy (스펙 §7)
  const [busy, setBusy] = useState(false);
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    const t = normalizeTitle(text);
    if (!t) return;
    setText("");
    setBusy(true);
    const ok = await onAdd(t);
    setBusy(false);
    if (ok) setLast(t);
    else setText((cur) => cur || t); // 실패하면 쓴 글자를 되살린다 (그새 새로 쓴 게 있으면 그대로)
  };
  return (
    <div
      {...treeItem(inTree, indent, personal ? `${roundName(round)}에 내 목표 빠른 추가` : `${round.title}에 과제 빠른 추가`)}
      className={`flex min-h-11 flex-wrap items-center gap-x-2 border-b border-line-2 py-1 pl-2 pr-3 ${personal ? "bg-[#F3F6FA]" : "bg-surface-2"}`}
    >
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      {personal && <TypeBadge type="개인" />}
      <input
        ref={input}
        type="text"
        value={text}
        maxLength={80}
        aria-label={personal ? `${roundName(round)}에 추가할 내 목표 제목` : `${round.title}에 추가할 과제 제목`}
        aria-busy={busy || undefined}
        placeholder={personal ? "내 목표 제목을 쓰고 Enter · Esc 닫기" : "과제 제목을 쓰고 Enter · Esc 닫기"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (shouldSubmitQuickAdd({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
            e.preventDefault();
            void submit();
          }
        }}
        onBlur={() => {
          if (!text.trim()) onClose();
        }}
        className={`h-11 min-w-0 flex-1 rounded-[10px] border bg-surface px-3 text-[14px] text-ink ${personal ? "border-[#4F6382]" : "border-line-3"}`}
      />
      {personal && (
        <span className="shrink-0 whitespace-nowrap text-[12px] text-muted max-sm:hidden">{last ? "다음 목표를 이어서 쓸 수 있어요" : `기간 = 회차 기간 ${md(round.s)} – ${md(round.e)}`}</span>
      )}
      <span role="status" className="sr-only">
        {last ? `추가했어요: ${last}` : ""}
      </span>
    </div>
  );
}
