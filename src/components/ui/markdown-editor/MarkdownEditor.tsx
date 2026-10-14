"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { create, run, setDoc, type Command } from "./cm";

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 접근성 이름 — 바깥 라벨 요소 id 가 있으면 labelledBy 를 쓴다 */
  label?: string;
  labelledBy?: string;
  /** 편집 면 최소 높이(px) */
  minHeight?: number;
  className?: string;
};

// 아이콘 — work-note(frontend/src/components/Icon.tsx) 의 선 아이콘 24×24 을 옮겨 왔다 (ordered·codeblock·hr 은 같은 결로 추가)
const ICON: Record<string, ReactNode> = {
  bold: <><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" strokeWidth="2" /></>,
  italic: <><line x1="19" y1="5" x2="11" y2="5" /><line x1="13" y1="19" x2="5" y2="19" /><line x1="15" y1="5" x2="9" y2="19" /></>,
  strike: <><path d="M5 12h14" /><path d="M8 7.5C8 6 9.5 5 12 5c2 0 3.5 1 3.5 2.2" /><path d="M9 16c.4 1.7 1.8 2.5 3.5 2.5 2.2 0 3.5-1 3.5-2.6 0-1-.5-1.6-1.4-2" /></>,
  code: <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>,
  quote: <><path d="M7 7H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2v3a1 1 0 0 1-1 1H4M20 7h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2v3a1 1 0 0 1-1 1h-1" /></>,
  bullet: <><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1.1" fill="currentColor" /><circle cx="4.5" cy="12" r="1.1" fill="currentColor" /><circle cx="4.5" cy="18" r="1.1" fill="currentColor" /></>,
  ordered: <><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><path d="M4 4.5h1.5V9" /><path d="M3.8 13.2c.3-.6.9-.9 1.5-.9.8 0 1.4.5 1.4 1.2 0 1-2.9 2.1-2.9 3.5h3" /></>,
  task: <><path d="M3 6l1.5 1.5L7.5 4.5" /><path d="M3 17l1.5 1.5L7.5 14.5" /><line x1="11" y1="6" x2="20" y2="6" /><line x1="11" y1="17" x2="20" y2="17" /></>,
  link: <><path d="M9.5 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" /><path d="M14.5 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" /></>,
  codeblock: <><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="10 9.5 7.5 12 10 14.5" /><polyline points="14 9.5 16.5 12 14 14.5" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9.5" y1="10" x2="9.5" y2="20" /></>,
  hr: <><line x1="3" y1="12" x2="21" y2="12" /><line x1="7" y1="6" x2="17" y2="6" opacity=".45" /><line x1="7" y1="18" x2="17" y2="18" opacity=".45" /></>,
};

const mod = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? "⌘" : "Ctrl+";

type Tool = { cmd: Command; label: string; key?: string; cap?: string };
const GROUPS: Tool[][] = [
  [
    { cmd: "h1", label: "제목 1", cap: "1" },
    { cmd: "h2", label: "제목 2", cap: "2" },
    { cmd: "h3", label: "제목 3", cap: "3" },
  ],
  [
    { cmd: "bold", label: "굵게", key: "B" },
    { cmd: "italic", label: "기울임", key: "I" },
    { cmd: "strike", label: "취소선", key: "Shift+X" },
  ],
  [
    { cmd: "bullet", label: "글머리 목록" },
    { cmd: "ordered", label: "번호 목록" },
    { cmd: "task", label: "체크리스트" },
    { cmd: "quote", label: "인용" },
  ],
  [
    { cmd: "link", label: "링크", key: "K" },
    { cmd: "code", label: "인라인 코드", key: "E" },
    { cmd: "codeblock", label: "코드 블록" },
  ],
  [
    { cmd: "table", label: "표 넣기" },
    { cmd: "hr", label: "구분선" },
  ],
];

/**
 * 라이브 프리뷰 마크다운 에디터 — 쓰는 즉시 서식이 보이고 원문은 마크다운 그대로(work-note 에디터 이식).
 * 값 계약은 textarea 와 같다: value(문자열) 를 받고 onChange(문자열) 로 돌려준다.
 * CodeMirror 를 끌어오므로 직접 쓰지 말고 ./index 의 지연 로드 래퍼를 쓴다.
 */
export function MarkdownEditor({ value, onChange, placeholder, label, labelledBy, minHeight = 120, className = "" }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const bar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // 에디터가 마지막으로 내보낸 값 — 부모가 이 값을 늦게 돌려줘도(비동기 렌더) 바깥 변경으로 오인해 되돌리지 않게
  const emitted = useRef(value);

  // 마운트 시 1회 생성 — 이후 바깥 값 변화는 아래 effect 가 맞춘다
  useEffect(() => {
    if (!host.current) return;
    const emit = (s: string) => {
      emitted.current = s;
      onChangeRef.current(s);
    };
    const v = create(host.current, { doc: value, placeholder, label, labelledBy, onChange: emit });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 에디터 인스턴스는 한 번만 만든다
  }, []);

  // 바깥에서 바뀐 값(버리기·다른 항목 불러오기)만 문서에 반영한다
  useEffect(() => {
    if (!view.current || value === emitted.current) return;
    emitted.current = value;
    setDoc(view.current, value);
  }, [value]);

  // 툴바는 탭 정지 하나 + 좌우 화살표 이동 (WAI-ARIA toolbar)
  const onBarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const btns = Array.from(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length;
    setActive(next);
    btns[next].focus();
  };

  let idx = 0;
  return (
    <div
      className={`overflow-hidden rounded-[10px] border border-line-3 bg-surface font-normal text-ink focus-within:border-mint focus-within:shadow-[0_0_0_3px_#DDF4EE] ${className}`}
      style={{ ["--md-min-h" as string]: `${minHeight}px` }}
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label="서식 도구"
        onKeyDown={onBarKey}
        className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px] border-b border-line-2 bg-surface-3 px-[6px] py-1"
      >
        {GROUPS.map((g, gi) => (
          <div key={gi} role="group" className="flex shrink-0 items-center gap-[2px]">
            {g.map((t) => {
              const tip = t.key ? `${t.label} (${mod}${t.key})` : t.label;
              const tabIndex = idx++ === active ? 0 : -1;
              return (
                <button
                  key={t.cmd}
                  type="button"
                  tabIndex={tabIndex}
                  title={tip}
                  aria-label={t.label}
                  // 클릭해도 편집 면의 선택을 잃지 않게
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => view.current && run(view.current, t.cmd)}
                  className="flex h-8 w-[30px] shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-line-2 hover:text-ink"
                >
                  {t.cap ? (
                    <span aria-hidden="true" className="text-[13px] font-bold leading-none">
                      H<sub className="text-[9px]">{t.cap}</sub>
                    </span>
                  ) : (
                    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {ICON[t.cmd]}
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div ref={host} className="text-left" />
    </div>
  );
}

export default MarkdownEditor;
