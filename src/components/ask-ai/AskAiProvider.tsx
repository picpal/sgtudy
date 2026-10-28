"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { normTerm } from "@/lib/ai/explain/normalize";
import { NO_SHARE_SOURCES, type ExplainOut, type Source } from "@/lib/ai/explain/schema";
import { errorMessage, postExplain } from "./api";
import { AskAiPill } from "./AskAiPill";
import { AskAiSheet, type SheetState } from "./AskAiSheet";
import type { SelectionPick } from "./selection";
import { useAskAiSelection } from "./useAskAiSelection";

type Open = { term: string; source: Source; context: string; returnFocus: HTMLElement | null };

const FOCUS_SEL = "[tabindex],a[href],button,input,textarea,select";
const isTyping = (el: Element | null) => !!el && (el.matches("input,textarea,select") || (el as HTMLElement).isContentEditable);

/** 닫은 뒤 포커스 자리(D18) — 선택이 있던 곳의 가장 가까운 포커스 가능 조상, 없으면 body */
const focusBackOf = (p: SelectionPick): HTMLElement => p.container.closest<HTMLElement>(FOCUS_SEL) ?? document.body;

/**
 * 「AI에게 물어보기」(스펙 2026-10-27-ask-ai-term-explain-design). 내 스터디 화면을 감싼다 — 허용 영역(data-ask-ai) 안 선택 → 알약 → 해설 시트.
 * 세션 메모리(D20, 정규화 용어 키, term 해설만) · 시트가 열린 동안 새 선택 무시(D21) · 닫으면 진행 중 요청 abort · 단축키 Alt+Shift+A(D18)
 */
export function AskAiProvider({ slug, enabled, children }: { slug: string; enabled: boolean; children?: ReactNode }) {
  const { pick, clear } = useAskAiSelection(enabled);
  const [open, setOpen] = useState<Open | null>(null);
  const [state, setState] = useState<SheetState>({ phase: "loading" });
  const memo = useRef(new Map<string, ExplainOut>());
  const ctrl = useRef<AbortController | null>(null);

  const ask = async (term: string, source: Source, context: string, returnFocus: HTMLElement | null) => {
    ctrl.current?.abort();
    setOpen({ term, source, context, returnFocus });
    const key = normTerm(term);
    const hit = memo.current.get(key);
    if (hit) {
      ctrl.current = null;
      setState({ phase: "ok", body: hit });
      return;
    }
    setState({ phase: "loading" });
    const ac = new AbortController();
    ctrl.current = ac;
    const r = await postExplain({ slug, term, source, context }, { signal: ac.signal });
    if (ac.signal.aborted) return;
    ctrl.current = null;
    if (r.ok) {
      if (r.data.body.kind === "term") memo.current.set(key, r.data.body);
      setState({ phase: "ok", body: r.data.body });
    } else {
      const sec = r.err.details?.retryAfterSec;
      setState({ phase: "error", code: r.err.error, message: errorMessage(r.err), retryAfterSec: typeof sec === "number" ? sec : undefined });
    }
  };

  const askPick = (p: SelectionPick) => {
    clear();
    void ask(p.term, p.source, p.context, focusBackOf(p));
  };

  const close = () => {
    ctrl.current?.abort();
    ctrl.current = null;
    setOpen(null);
  };

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.altKey && e.shiftKey && e.code === "KeyA") || e.ctrlKey || e.metaKey) return;
    if (open || !pick || isTyping(document.activeElement)) return;
    e.preventDefault();
    askPick(pick);
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => onShortcut(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
  useEffect(() => () => ctrl.current?.abort(), []);

  if (!enabled) return <>{children}</>;
  return (
    <>
      {children}
      {pick && !open && <AskAiPill pick={pick} onAsk={() => askPick(pick)} />}
      {open && (
        <AskAiSheet
          term={open.term}
          state={state}
          onClose={close}
          onAskRelated={(t) => void ask(t, open.source, open.context, open.returnFocus)}
          returnFocus={open.returnFocus}
          shared={!NO_SHARE_SOURCES.has(open.source)}
        />
      )}
    </>
  );
}
