"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Switch } from "@/components/ui/Switch";
import { toApiError } from "@/lib/api/errors";
import type { JoinMode } from "@/lib/api/types";
import { PAL } from "@/lib/palette";
import { JOIN_MODE_LABEL } from "@/lib/types";
import { useDebounced } from "@/lib/useDebounced";
import { addTag, fromDto, removeTag, searchTags, TAG_LIMIT, tagKey, type TagItem } from "./tags";

/* 방 만들기(NewRoomForm)·방 설정(RoomSettingsForm) 공용 입력 조각 */

// 운영 규칙은 읽기 화면에서 줄마다 한 항목(rulesOf)으로 보인다 — 표·코드 블록·제목처럼 줄을 넘는 모양은 주지 않는다
export const RULE_TOOLS = ["bold", "italic", "strike", "code", "link", "bullet"] as const;

export const FIELD_CLASS =
  "h-12 w-full min-w-0 rounded-[12px] border border-line-3 bg-surface px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE] disabled:bg-surface-2 disabled:text-muted";

/**
 * 날짜 칸 — iOS Safari 는 기본 모양(appearance:auto)의 date input 에 border-box 를 적용하지 않아
 * 칸 너비 + 좌우 패딩·테두리(34px)만큼 넓게(330→364px, 높이 50px) 그린다. 두 칸이 나란하면 시작일이 종료일을 덮는다.
 * 기본 모양을 끄면 border-box 로 칸 안에 맞는다. 값은 왼쪽 정렬(iOS 기본은 가운데).
 */
/** 기존 높이·모양은 그대로 두고 iOS 넘침만 막는 조각 — 다른 크기의 날짜 칸에 덧붙인다. */
export const DATE_NO_OVERFLOW_CLASS = "appearance-none [&::-webkit-date-and-time-value]:text-left";
export const DATE_FIELD_CLASS = `${FIELD_CLASS} ${DATE_NO_OVERFLOW_CLASS}`;

/** 필수 표시 — 글자로(색만으로 구분하지 않는다) */
const Required = () => <span className="ml-1 text-[11px] font-semibold text-warn">필수</span>;

export function Field({ label, error, hint, required, children }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      <span>
        {label}
        {required && <Required />}
      </span>
      {children}
      {hint && !error && <span className="text-[12px] font-normal text-muted">{hint}</span>}
      {error && <span role="alert" className="text-[12px] font-medium text-warn">{error}</span>}
    </label>
  );
}

/** 마크다운 에디터 칸 — 편집 면은 <label> 로 감쌀 수 없어(contenteditable) id 로 이름을 잇는다 */
export function EditorField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span id={id} className="text-[12px] font-semibold text-ink-3">{label}</span>
      {children}
    </div>
  );
}

/** 켜고 끄는 줄 — 줄 전체가 누르는 자리(44px 이상). 스위치 자체도 role=switch 로 키보드 조작 */
export function SwitchRow({ title, desc, on, onChange, disabled }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      onClick={(e) => {
        // 스위치 버튼을 직접 누른 건 스위치가 처리한다
        if (disabled || (e.target as HTMLElement).closest('[role="switch"]')) return;
        onChange(!on);
      }}
      className={`flex min-h-14 items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}
    >
      <span>
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-[12px] text-muted">{desc}</span>
      </span>
      <Switch on={on} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

const JOIN_MODES = [
  ["direct", JOIN_MODE_LABEL.direct, "누구나 바로 들어와요"],
  ["approval", JOIN_MODE_LABEL.approval, "그룹장이 승인해야 참가돼요"],
] as const;

/** 참가 방식 — 보이는 이름 + 선택 표시(체크 아이콘·굵은 테두리, 색만이 아니다). ←/→/↑/↓ 로 선택 이동, Tab 은 선택된 하나만(roving tabindex) */
export function JoinModeRadio({ value, onChange, disabled }: { value: JoinMode; onChange: (v: JoinMode) => void; disabled?: boolean }) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + JOIN_MODES.length) % JOIN_MODES.length;
    onChange(JOIN_MODES[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <span id={labelId} className="text-[12px] font-semibold text-ink-3">참가 방식</span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        {JOIN_MODES.map(([k, t, d], i) => {
          const on = value === k;
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(k)}
              onKeyDown={(e) => onKey(e, i)}
              className={`flex items-start gap-3 rounded-[12px] border-2 px-4 py-3 text-left disabled:opacity-70 ${on ? "border-mint bg-[#F5FBF9]" : "border-line bg-surface"}`}
            >
              <span aria-hidden="true" className={`mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-mint bg-mint text-white" : "border-line-3 bg-surface"}`}>
                {on && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="flex flex-col">
                <span className="text-[14px] font-semibold">{t}</span>
                <span className="text-[12px] text-muted">{d}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Sparkle = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);

/**
 * 태그 고르기 — 고른 태그 칩(× 로 빼기) + 입력(사전 검색 · Enter 로 새 태그) + 추천 칩. 최대 8개.
 * autoNote: 방 설정에서 자동 태그와의 관계 안내(빼면 다시 자동으로 붙지 않고, 저장하면 남긴 태그는 직접 고른 태그가 된다 — 서버 room_tags_put 규칙)
 */
export function TagPicker({ value, onChange, disabled, autoNote }: { value: TagItem[]; onChange: (v: TagItem[]) => void; disabled?: boolean; autoNote?: boolean }) {
  const inputId = useId();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState<TagItem[]>([]);
  const dq = useDebounced(q, 200);
  useEffect(() => {
    if (disabled) return;
    let live = true;
    searchTags(dq)
      .then((items) => live && setFound(items.map((t) => ({ ...fromDto(t), auto: false }))))
      .catch((e) => live && setError(toApiError(e).message || "태그를 불러오지 못했어요"));
    return () => {
      live = false;
    };
  }, [dq, disabled]);
  const picked = new Set(value.map(tagKey));
  const pickedLabels = new Set(value.map((t) => t.label.toLowerCase()));
  const suggestions = found.filter((t) => !picked.has(tagKey(t)) && !pickedLabels.has(t.label.toLowerCase())).slice(0, 10);

  const add = (t: TagItem) => {
    const r = addTag(value, t);
    setError(r.error ?? "");
    if (!r.error) {
      onChange(r.list);
      setQ("");
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault(); // 폼 제출 막기
    if (!q.trim()) return;
    // 사전에 같은 이름이 있으면 그 태그로
    const same = found.find((t) => t.label.toLowerCase() === q.trim().toLowerCase());
    add(same ?? { label: q });
  };
  const hasAuto = value.some((t) => t.auto);

  return (
    <div className="flex flex-col gap-[8px]">
      <label htmlFor={inputId} className="flex items-baseline justify-between text-[12px] font-semibold text-ink-3">
        <span>태그 (선택)</span>
        <span className="font-medium text-muted">
          {value.length}/{TAG_LIMIT}
        </span>
      </label>
      {value.length > 0 && (
        <ul aria-label="고른 태그" className="m-0 flex list-none flex-wrap gap-[6px] p-0">
          {value.map((t) => {
            const pal = PAL[t.tone ?? "slate"];
            return (
              <li key={tagKey(t)} className="inline-flex h-8 items-center gap-1 rounded-[16px] pl-[11px] text-[13px] font-semibold" style={{ background: pal.bg, color: pal.fg }}>
                {t.auto && <Sparkle />}
                {t.auto && <span className="sr-only">자동 태그</span>}
                {t.label}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`${t.label} 태그 빼기`}
                    onClick={() => {
                      setError("");
                      onChange(removeTag(value, tagKey(t)));
                    }}
                    className="relative flex h-8 w-8 items-center justify-center rounded-full before:absolute before:-inset-[6px] before:content-['']"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                )}
                {disabled && <span className="w-[11px]" />}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && (
        <>
          <input
            id={inputId}
            className={FIELD_CLASS}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setError("");
            }}
            onKeyDown={onKey}
            placeholder="검색하거나 새 태그를 쓰고 Enter"
            aria-describedby={`${inputId}-hint`}
            enterKeyHint="done"
            disabled={value.length >= TAG_LIMIT}
          />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-[6px]" aria-label={q.trim() ? "검색한 태그" : "추천 태그"} role="group">
              {suggestions.map((t) => (
                <button key={tagKey(t)} type="button" onClick={() => add(t)} disabled={value.length >= TAG_LIMIT} className="inline-flex h-11 items-center gap-1 rounded-[22px] border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 disabled:opacity-50">
                  <span aria-hidden="true" className="text-mint">＋</span>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <span id={`${inputId}-hint`} className="text-[12px] leading-[1.5] text-muted">
        {disabled
          ? "지금 상태에서는 태그를 바꿀 수 없어요"
          : value.length >= TAG_LIMIT
            ? `태그는 ${TAG_LIMIT}개까지예요 · 바꾸려면 하나를 빼 주세요`
            : "방 목록의 태그 필터·검색에 쓰여요"}
      </span>
      {autoNote && hasAuto && !disabled && (
        <span className="inline-flex items-start gap-1 text-[12px] leading-[1.5] text-muted">
          <span className="mt-[3px] shrink-0"><Sparkle size={11} /></span>
          <span>자동 태그는 진행목표 내용으로 붙은 태그예요 · 빼면 다시 자동으로 붙지 않고, 태그를 바꿔 저장하면 남긴 태그는 직접 고른 태그로 고정돼요</span>
        </span>
      )}
      {error && <span role="alert" className="text-[12px] font-medium text-warn">{error}</span>}
    </div>
  );
}
