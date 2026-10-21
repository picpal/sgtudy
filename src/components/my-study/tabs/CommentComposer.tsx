"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { COMMENT_LIMITS, validateComment } from "@/lib/api/comments";
import type { Tone } from "@/lib/palette";
import { activeQuery, displayLength, insertMention, isImeComposing, matchMembers, mentionIds, toTokens, type MentionPick } from "@/lib/mention";
import { clearCommentDraft, draftStore, readCommentDraft, writeCommentDraft } from "../commentDraft";
import { CommentBody } from "./CommentBody";

/** 자동완성 후보 — 방 그룹장 + ACTIVE 멤버(D11) */
export type MentionMember = { userId: string; nickname: string; tone: Tone };
/** [답글] — 입력창 끝에 `@작성자 ` 를 넣고 포커스(D5) */
export type ComposerHandle = { reply: (p: MentionPick) => void; focus: () => void };

type Props = {
  members: MentionMember[];
  meId: string | null;
  /** 수정 모드 — 저장 본문을 toEditable 로 바꾼 글·picks */
  initial?: { text: string; picks: MentionPick[] };
  /** 새 댓글 임시 저장 키(D24) — 수정 모드는 없음 */
  draftKey?: string | null;
  submitLabel: string;
  /** body = 저장 본문(토큰, 앞뒤 공백 정리). true 면 비운다(새 댓글)·닫힌다(수정) */
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  label: string;
  autoFocus?: boolean;
  ref?: Ref<ComposerHandle>;
};

const COUNT_FROM = 1800;
const MAX_LINES = 8;
const LINE_PX = 22;

/**
 * 댓글 입력창 (§6.3·§6.4) — 평범한 textarea(모바일·IME 단순) + `@` 멤버 자동완성(MentionPicker).
 * 고른 멤버는 입력창에 `@닉네임` 으로 보이고 picks 에 기록 → 등록 때 toTokens 가 `<@uuid>` 로 바꾼다(공백 있는 닉네임도 안전).
 * 키: Enter 줄바꿈 · Cmd/Ctrl+Enter 등록 · 후보가 열려 있으면 ↑↓ 이동, Enter·Tab 선택, Esc 닫기.
 * 한글 조합 중(isComposing·229)에는 이 키들을 처리하지 않는다 — 조합 확정 Enter 가 선택·등록으로 새지 않게
 */
export function CommentComposer({ members, meId, initial, draftKey = null, submitLabel, onSubmit, onCancel, label, autoFocus = false, ref }: Props) {
  const [text, setText] = useState(() => initial?.text ?? (draftKey ? (readCommentDraft(draftStore(), draftKey)?.text ?? "") : ""));
  const [picks, setPicks] = useState<MentionPick[]>(() => initial?.picks ?? (draftKey ? (readCommentDraft(draftStore(), draftKey)?.picks ?? []) : []));
  const [caret, setCaret] = useState<number>(() => text.length);
  const [active, setActive] = useState(0);
  // Esc 로 닫은 질의(@ 위치) — 다른 @ 를 치기 전까지 다시 열지 않는다
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const ids = useId();
  const listId = `${ids}-list`;

  const q = activeQuery(text, caret);
  const cands = q ? matchMembers(q.query, members, meId) : [];
  const open = !!q && dismissed !== q.start && cands.length > 0;
  // 질의가 바뀌면 첫 후보부터
  const qKey = q ? `${q.start}:${q.query}` : "";
  const [seenQ, setSeenQ] = useState(qKey);
  if (qKey !== seenQ) {
    setSeenQ(qKey);
    setActive(0);
    if (q?.start !== dismissed) setDismissed(null);
  }
  const at = Math.min(active, Math.max(0, cands.length - 1));

  const tokens = toTokens(text, picks).trim();
  const len = displayLength(tokens);
  const mentions = mentionIds(tokens).length;
  const over = len > COMMENT_LIMITS.bodyMax || mentions > COMMENT_LIMITS.mentionsMax;

  // 임시 저장 — 새 댓글만, 바뀔 때마다(짧은 글이라 따로 늦추지 않는다)
  useEffect(() => {
    if (draftKey) writeCommentDraft(draftStore(), draftKey, { text, picks });
  }, [draftKey, text, picks]);

  // 자동 높이(최대 8줄) + 선택 뒤 캐럿
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const max = LINE_PX * MAX_LINES + 20;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    if (nextCaret.current !== null) {
      el.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
  }, [text]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const syncCaret = () => {
    const el = area.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  };

  const addPick = (p: MentionPick) => setPicks((list) => (list.some((x) => x.userId === p.userId && x.nickname === p.nickname) ? list : [...list, p]));
  /** 이 사람을 부르면 상한을 넘나 — 이미 부른 사람은 괜찮다 */
  const wouldOverflow = (userId: string) => {
    const now = mentionIds(toTokens(text, picks));
    return !now.includes(userId) && now.length >= COMMENT_LIMITS.mentionsMax;
  };

  const choose = (m: MentionMember) => {
    if (!q) return;
    if (wouldOverflow(m.userId)) {
      setErr("한 댓글에서 10명까지 부를 수 있어요");
      setDismissed(q.start);
      return;
    }
    const r = insertMention(text, q, m.nickname);
    addPick({ userId: m.userId, nickname: m.nickname });
    nextCaret.current = r.caret;
    setText(r.text);
    setCaret(r.caret);
    setErr(null);
    area.current?.focus();
  };

  useImperativeHandle(ref, () => ({
    reply: (p) => {
      if (wouldOverflow(p.userId)) {
        setErr("한 댓글에서 10명까지 부를 수 있어요");
        area.current?.focus();
        return;
      }
      const base = text.replace(/\s+$/, "");
      const next = `${base}${base ? " " : ""}@${p.nickname} `;
      addPick(p);
      nextCaret.current = next.length;
      setText(next);
      setCaret(next.length);
      setPreview(false);
      area.current?.focus();
      area.current?.scrollIntoView({ block: "nearest" });
    },
    focus: () => area.current?.focus(),
  }));

  const submit = async () => {
    if (busy) return;
    const bad = validateComment(tokens);
    if (bad) {
      setErr(bad.text);
      area.current?.focus();
      return;
    }
    setErr(null);
    setBusy(true);
    const ok = await onSubmit(tokens);
    setBusy(false);
    if (!ok) return;
    // 새 댓글은 비우고 입력창에 남는다(이어 쓰기). 수정 모드는 부모가 닫는다
    if (!initial) {
      if (draftKey) clearCommentDraft(draftStore(), draftKey);
      setText("");
      setPicks([]);
      setCaret(0);
      setPreview(false);
      setLive("댓글을 등록했어요");
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
      return;
    }
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setActive((at + d + cands.length) % cands.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        choose(cands[at]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(q!.start);
        return;
      }
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const optId = (i: number) => `${ids}-o${i}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {open && (
          // 캐럿 좌표 대신 입력창 바로 위에 고정(§6.4) — 모바일은 가상 키보드 위, 폭은 입력창과 같아 화면 밖으로 나가지 않는다
          <ul
            id={listId}
            role="listbox"
            aria-label="부를 멤버"
            className="absolute inset-x-0 bottom-[calc(100%+6px)] z-20 m-0 flex max-h-[min(40vh,264px)] list-none flex-col overflow-y-auto rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.16)]"
          >
            {cands.map((m, i) => (
              <li
                key={m.userId}
                id={optId(i)}
                role="option"
                aria-selected={i === at}
                // 입력창 포커스를 지킨다 — 누르는 순간 blur 되면 캐럿·질의가 흔들린다
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(m)}
                onMouseMove={() => i !== at && setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[14px] font-medium text-ink ${i === at ? "bg-bg" : ""}`}
              >
                <Avatar name={m.nickname} size={24} tone={m.tone} id={m.userId} />
                <span className="min-w-0 truncate">{m.nickname}</span>
                {m.userId === meId && <span className="shrink-0 text-[12px] text-muted">(나)</span>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={area}
          value={text}
          rows={2}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? optId(at) : undefined}
          aria-invalid={over || !!err || undefined}
          aria-describedby={`${ids}-hint`}
          placeholder="댓글을 남겨 주세요 · @로 멤버를 불러요"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (err) setErr(null);
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onCompositionEnd={syncCaret}
          onBlur={() => setDismissed(q?.start ?? null)}
          onFocus={() => setDismissed(null)}
          onKeyDown={onKey}
          className="block w-full resize-none rounded-[12px] border border-line-3 bg-surface px-3 py-[10px] text-[14px] leading-[22px] text-ink placeholder:text-faint max-sm:text-[16px]"
        />
      </div>
      {preview && (
        <div data-comment-preview className="rounded-[12px] bg-surface-2 px-3 py-[10px] text-[14px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
          {tokens ? <CommentBody body={tokens} people={Object.fromEntries(picks.map((p) => [p.userId, p]))} meId={meId} /> : <span className="text-muted">미리 볼 내용이 없어요</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p id={`${ids}-hint`} className="m-0 min-w-0 flex-1 text-[12px] text-muted">
          {err ? (
            <span role="alert" className="font-medium text-warn">
              {err}
            </span>
          ) : mentions > COMMENT_LIMITS.mentionsMax ? (
            <span className="font-medium text-warn">한 댓글에서 {COMMENT_LIMITS.mentionsMax}명까지 부를 수 있어요</span>
          ) : (
            <span className="max-sm:hidden">**굵게** _기울임_ `코드` [링크](주소) · Ctrl/⌘+Enter 등록</span>
          )}
          {len > COUNT_FROM && (
            <span data-count className={`ml-2 ${len > COMMENT_LIMITS.bodyMax ? "font-semibold text-warn" : ""}`}>
              {len.toLocaleString("ko-KR")}/{COMMENT_LIMITS.bodyMax.toLocaleString("ko-KR")}
            </span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-pressed={preview} onClick={() => setPreview((v) => !v)} className="h-11 rounded-[22px] px-3 text-[13px] font-semibold text-ink-3 hover:text-ink">
            미리 보기
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink">
              취소
            </button>
          )}
          <button type="button" onClick={() => void submit()} disabled={busy || over || tokens === ""} aria-busy={busy || undefined} className="h-11 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-50">
            {submitLabel}
          </button>
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {live}
      </span>
    </div>
  );
}
