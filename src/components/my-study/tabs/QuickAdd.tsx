"use client";

import { useEffect, useRef, useState } from "react";
import { md } from "@/lib/date";
import type { TaskType } from "@/data/my-study";
import { Seg, TypeBadge } from "../bits";
import type { ParentNode } from "../model";
import { normalizeTitle, shouldSubmitQuickAdd } from "../rounds";

const indentCls = "w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]";

/** inTree: role="tree" 의 직계 줄일 때 — 과제 행과 같은 aria-level 의 treeitem 으로 (펼침 상태 없음). `<li>` 안에서는 그냥 div */
const treeItem = (inTree: boolean, indent: number, label: string) => (inTree ? { role: "treeitem", "aria-level": indent + 2, "aria-label": label } : {});

/** team = 편집 목록 팀 과제(민트), personal = 보기 목록 "내 목표 추가"(슬레이트) */
export type AddTone = "team" | "personal";

/** "{회차 라벨} {회차 제목}" — 개인 목표 문구(스펙 §6)용 */
const roundName = (r: ParentNode) => (r.label ? `${r.label} ${r.title}` : r.title);

/** 팀 빠른 추가의 종류 — 시험은 리프를 만든 뒤 빈 초안을 넣고 출제 화면으로 (스펙 2026-10-21-round-exam §4.1) */
export type AddKind = "task" | "exam";

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
        className={`inline-flex h-11 items-center gap-[6px] rounded-[10px] px-2 text-[13px] font-semibold ${personal ? "text-personal-ink" : "text-mint"}`}
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
export function QuickAdd({
  round, indent, onAdd, onClose, inTree = false, tone = "team", designatedNote = null,
}: {
  round: ParentNode;
  indent: number;
  /** type: 팀 빠른 추가에서 고른 과제 유형(공통/지정, 시나리오 QA D4), kind: 과제/시험. 개인 목표는 둘 다 늘 undefined */
  onAdd: (title: string, type?: TaskType, kind?: AddKind) => Promise<boolean>;
  onClose: () => void;
  inTree?: boolean;
  tone?: AddTone;
  /** 지정을 골랐을 때 보일 안내 — 시작 전 방(rounds.designatedHint) */
  designatedNote?: string | null;
}) {
  const personal = tone === "personal";
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  // 팀 과제 유형 — 열려 있는 동안 이어서 추가하는 과제에 그대로 쓴다
  const [type, setType] = useState<TaskType>("공통");
  const [kind, setKind] = useState<AddKind>("task");
  const exam = !personal && kind === "exam";
  const [last, setLast] = useState("");
  // 개인 목표는 낙관적 임시 행 없이 응답을 기다린다 — 그동안 입력에 aria-busy (스펙 §7). 연달아 보내면 마지막 응답까지
  const [pending, setPending] = useState(0);
  const busy = pending > 0;
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    const t = normalizeTitle(text);
    if (!t) return;
    setText("");
    setPending((c) => c + 1);
    const ok = await (personal ? onAdd(t) : onAdd(t, type, kind));
    setPending((c) => c - 1);
    if (ok) setLast(t);
    else setText((cur) => cur || t); // 실패하면 쓴 글자를 되살린다 (그새 새로 쓴 게 있으면 그대로)
  };
  return (
    <div
      ref={row}
      {...treeItem(inTree, indent, personal ? `${roundName(round)}에 내 목표 빠른 추가` : `${round.title}에 과제 빠른 추가`)}
      className={`flex min-h-11 flex-wrap items-center gap-x-2 border-b border-line-2 py-1 pl-2 pr-3 ${personal ? "bg-personal-field" : "bg-surface-2"}`}
    >
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      {personal && <TypeBadge type="개인" />}
      {!personal && (
        // 마우스로 종류·유형을 눌러도 포커스는 입력에 둔다 — Safari·macOS Firefox 는 버튼에 포커스를 주지 않아
        // 입력의 blur 가 relatedTarget=null 로 와서(줄 밖으로 나간 것처럼) 빈 입력이 닫혀 버렸다. 키보드(Tab·Space)는 그대로
        <span className="flex shrink-0 gap-x-2" onMouseDown={(e) => e.preventDefault()}>
          <Seg<AddKind> label="추가할 종류" value={kind} onChange={(v) => { setKind(v); input.current?.focus(); }} options={[["task", "과제"], ["exam", "시험"]]} />
          <Seg<TaskType> label="추가할 과제 유형" value={type} onChange={(v) => { setType(v); input.current?.focus(); }} options={[["공통", "공통"], ["지정", "지정"]]} />
        </span>
      )}
      <input
        ref={input}
        type="text"
        value={text}
        maxLength={80}
        aria-label={personal ? `${roundName(round)}에 추가할 내 목표 제목` : `${round.title}에 추가할 ${exam ? "시험" : "과제"} 제목`}
        aria-busy={busy || undefined}
        placeholder={personal ? "내 목표 제목을 쓰고 Enter · Esc 닫기" : exam ? "시험 제목을 쓰고 Enter · Esc 닫기" : "과제 제목을 쓰고 Enter · Esc 닫기"}
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
        onBlur={(e) => {
          // 종류·유형 버튼(같은 줄)으로 옮겨 간 포커스는 닫지 않는다
          if (row.current?.contains(e.relatedTarget as Node | null)) return;
          if (!text.trim()) onClose();
        }}
        className={`h-11 min-w-0 flex-1 rounded-[10px] border bg-surface px-3 text-[14px] text-ink ${personal ? "border-personal-line" : "border-line-3 max-sm:basis-full"}`}
      />
      {personal && (
        <span className="shrink-0 whitespace-nowrap text-[12px] text-muted max-sm:hidden">{last ? "다음 목표를 이어서 쓸 수 있어요" : `기간 = 회차 기간 ${md(round.s)} – ${md(round.e)}`}</span>
      )}
      {exam && <span className="basis-full pb-1 text-[12px] text-muted">시험은 초안으로 만들어져요 · 문제를 쓰고 발행해야 팀원에게 열려요</span>}
      {!personal && type === "지정" && (
        <span className="basis-full pb-1 text-[12px] text-muted">
          지정 과제는 담당 미정으로 만들어져요 · 과제를 눌러 담당을 골라 주세요{designatedNote ? ` · ${designatedNote}` : ""}
        </span>
      )}
      {/* 개인 목표는 토스트("내 목표를 추가했어요")가 알리므로 두 번 읽지 않게 팀 빠른 추가에만 */}
      {!personal && (
        <span role="status" className="sr-only">
          {last ? `추가했어요: ${last}` : ""}
        </span>
      )}
    </div>
  );
}
