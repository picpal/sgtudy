"use client";

import { useEffect, useRef, useState } from "react";
import type { ParentNode } from "../model";
import { normalizeTitle, shouldSubmitQuickAdd } from "../rounds";

const indentCls = "w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]";

/** inTree: role="tree" 의 직계 줄일 때 — 과제 행과 같은 aria-level 의 treeitem 으로 (펼침 상태 없음). `<li>` 안에서는 그냥 div */
const treeItem = (inTree: boolean, indent: number, label: string) => (inTree ? { role: "treeitem", "aria-level": indent + 2, "aria-label": label } : {});

/** 펼친 회차 끝의 "+ 과제 추가" 줄 */
export function AddRow({ round, indent, onOpen, inTree = false }: { round: ParentNode; indent: number; onOpen: () => void; inTree?: boolean }) {
  return (
    <div {...treeItem(inTree, indent, `${round.title}에 과제 추가`)} className="flex min-h-11 items-center border-b border-line-2 bg-surface pl-2 pr-3">
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      <button type="button" data-add-task={round.id} onClick={onOpen} aria-label={`${round.title}에 과제 추가`} className="inline-flex h-11 items-center gap-[6px] rounded-[10px] px-2 text-[13px] font-semibold text-mint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        과제 추가
      </button>
    </div>
  );
}

/** 빠른 추가 — Enter 로 만들고 입력은 다음 과제를 위해 비운 채 열어 둔다. Esc·빈 입력에서 포커스가 나가면 닫힘 */
export function QuickAdd({ round, indent, onAdd, onClose, inTree = false }: { round: ParentNode; indent: number; onAdd: (title: string) => Promise<boolean>; onClose: () => void; inTree?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [last, setLast] = useState("");
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    const t = normalizeTitle(text);
    if (!t) return;
    setText("");
    const ok = await onAdd(t);
    if (ok) setLast(t);
    else setText((cur) => cur || t); // 실패하면 쓴 글자를 되살린다 (그새 새로 쓴 게 있으면 그대로)
  };
  return (
    <div {...treeItem(inTree, indent, `${round.title}에 과제 빠른 추가`)} className="flex min-h-11 flex-wrap items-center gap-x-2 border-b border-line-2 bg-surface-2 py-1 pl-2 pr-3">
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      <input
        ref={input}
        type="text"
        value={text}
        maxLength={80}
        aria-label={`${round.title}에 추가할 과제 제목`}
        placeholder="과제 제목을 쓰고 Enter · Esc 닫기"
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
        className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-3 bg-surface px-3 text-[14px] text-ink"
      />
      <span role="status" className="sr-only">
        {last ? `추가했어요: ${last}` : ""}
      </span>
    </div>
  );
}
