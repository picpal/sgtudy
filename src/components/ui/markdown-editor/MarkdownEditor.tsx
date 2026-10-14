"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { create, run, setDoc, type Command } from "./cm";
import { mod } from "./platform";

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 접근성 이름 — 바깥 라벨 요소 id 가 있으면 labelledBy 를 쓴다 */
  label?: string;
  labelledBy?: string;
  /** 편집 면 최소 높이 — 숫자는 px, 문자열은 CSS 길이 그대로(예: "max(420px, calc(100dvh - 400px))") */
  minHeight?: number | string;
  /** 편집 면 최대 높이 — 내용이 이보다 길면 편집 면 안에서 스크롤한다. "none" 이면 내용만큼 자란다 */
  maxHeight?: number | string;
  /** 툴바를 스크롤 부모 위쪽(이 오프셋)에 붙여 둔다 — 편집 면이 내용만큼 자라는 전용 편집 화면용 */
  stickyToolbar?: string;
  /** 본문 줄 폭 상한(px) — 넓은 편집 면에서 글 줄이 너무 길어지지 않게 가운데 정렬한다 */
  contentMaxWidth?: number;
  /** 툴바의 "크게 쓰기" — 같은 편집기를 큰 창으로 띄운다 (기본 켜짐) */
  expandable?: boolean;
  /** 툴바에 보일 도구 — 없으면 전부. 읽기 화면이 줄 목록으로만 보여 주는 칸(운영 규칙)은 인라인·글머리 목록만 준다 */
  tools?: readonly Command[];
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
  expand: <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>,
};


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

const BTN = "flex h-8 w-[28px] shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-line-2 hover:text-ink";

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON[name]}
    </svg>
  );
}

/** 서식 툴바 — 탭 정지 하나 + 좌우 화살표 이동 (WAI-ARIA toolbar). 묶음 사이에 세로 구분선 */
function Toolbar({ groups, view, onExpand, expandRef, stickyTop }: { groups: Tool[][]; view: RefObject<EditorView | null>; onExpand?: () => void; expandRef?: RefObject<HTMLButtonElement | null>; stickyTop?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
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
      ref={bar}
      role="toolbar"
      aria-label="서식 도구"
      onKeyDown={onKey}
      className={`flex flex-wrap items-center gap-x-[6px] gap-y-[2px] border-b border-line-2 bg-surface-3 py-1 ${stickyTop !== undefined ? "sticky z-[1]" : ""}`}
      // 본문 줄 폭 상한(--md-content-max)이 있으면 도구 줄도 같은 세로줄에서 시작한다 — 넓은 편집 면에서 툴바만 왼쪽 끝에 떨어져 보이지 않게
      style={{ paddingInline: "max(6px, calc((100% - var(--md-content-max, 100%)) / 2 + 6px))", ...(stickyTop !== undefined ? { top: stickyTop } : {}) }}
    >
      {groups.map((g, gi) => (
        <div key={gi} role="group" className="flex shrink-0 items-center gap-[2px]">
          {gi > 0 && <span aria-hidden="true" className="mr-1 h-[18px] w-px bg-line-3" />}
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
                className={BTN}
              >
                {t.cap ? (
                  <span aria-hidden="true" className="text-[13px] font-bold leading-none">
                    H<sub className="text-[9px]">{t.cap}</sub>
                  </span>
                ) : (
                  <Icon name={t.cmd} />
                )}
              </button>
            );
          })}
        </div>
      ))}
      {onExpand && (
        <button
          ref={expandRef}
          type="button"
          tabIndex={idx++ === active ? 0 : -1}
          title="크게 쓰기"
          aria-label="크게 쓰기"
          aria-haspopup="dialog"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onExpand}
          className={`${BTN} ml-auto`}
        >
          <Icon name="expand" />
        </button>
      )}
    </div>
  );
}

const FRAME = "rounded-[10px] border border-line-3 bg-surface font-normal text-ink focus-within:border-mint focus-within:shadow-[0_0_0_3px_#DDF4EE]";

/**
 * 라이브 프리뷰 마크다운 에디터 — 쓰는 즉시 서식이 보이고 원문은 마크다운 그대로(work-note 에디터 이식).
 * 값 계약은 textarea 와 같다: value(문자열) 를 받고 onChange(문자열) 로 돌려준다.
 * CodeMirror 를 끌어오므로 직접 쓰지 말고 ./index 의 지연 로드 래퍼를 쓴다.
 *
 * "크게 쓰기" 는 새 편집기를 만들지 않는다 — 같은 EditorView 의 DOM 을 큰 창(<dialog> showModal) 으로 옮겼다가 닫을 때 되돌린다.
 * 그래서 값·되돌리기 기록·캐럿이 그대로 이어지고, 부모의 저장 흐름(onChange)도 바뀌지 않는다.
 * showModal 은 top layer 라 @container(레이아웃 격리) 안에서도 화면 전체 기준으로 뜬다.
 */
const len = (v: number | string) => (typeof v === "number" ? `${v}px` : v);

export function MarkdownEditor({ value, onChange, placeholder, label, labelledBy, minHeight = 240, maxHeight = 480, expandable = true, tools, stickyToolbar, contentMaxWidth, className = "" }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const bigHost = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandBtn = useRef<HTMLButtonElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
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
    const dlg = dialog.current;
    return () => {
      if (dlg?.open) dlg.close();
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

  const expand = () => {
    const v = view.current, dlg = dialog.current;
    if (!v || !dlg || !bigHost.current || dlg.open) return;
    bigHost.current.appendChild(v.dom);
    dlg.showModal();
    v.requestMeasure();
    v.focus();
  };
  // Esc(cancel)·완료 모두 close 이벤트로 모인다 — 편집 면을 제자리로 돌리고 포커스를 "크게 쓰기" 로
  const onClose = () => {
    const v = view.current;
    if (!v || !host.current) return;
    host.current.appendChild(v.dom);
    v.requestMeasure();
    expandBtn.current?.focus();
  };

  const groups = tools ? GROUPS.map((g) => g.filter((t) => tools.includes(t.cmd))).filter((g) => g.length > 0) : GROUPS;
  return (
    <>
      <div
        // sticky 툴바는 overflow:hidden 조상 안에서 붙지 않는다 → 둥근 모서리만 자르는 clip 으로
        className={`${FRAME} ${stickyToolbar !== undefined ? "overflow-clip" : "overflow-hidden"} ${className}`}
        style={{ ["--md-min-h" as string]: len(minHeight), ["--md-max-h" as string]: len(maxHeight), ...(contentMaxWidth ? { ["--md-content-max" as string]: `${contentMaxWidth}px` } : {}) }}
      >
        <Toolbar groups={groups} view={view} onExpand={expandable ? expand : undefined} expandRef={expandBtn} stickyTop={stickyToolbar} />
        <div ref={host} className="text-left" />
      </div>
      {expandable && (
        <dialog
          ref={dialog}
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : (label ?? "크게 쓰기")}
          onClose={onClose}
          className="m-auto h-[80vh] max-h-none w-[min(960px,92vw)] max-w-none flex-col gap-3 rounded-[16px] border-0 bg-surface p-4 text-ink shadow-[0_24px_60px_rgba(27,34,48,.22)] backdrop:bg-[rgba(27,34,48,.42)] open:flex sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <span aria-hidden="true" className="text-[14px] font-semibold text-ink-3">
              크게 쓰기
            </span>
            <button type="button" onClick={() => dialog.current?.close()} className="h-9 rounded-[18px] bg-navy px-4 text-[14px] font-semibold text-white">
              완료
            </button>
          </div>
          <div className={`${FRAME} flex min-h-0 flex-1 flex-col overflow-hidden`} style={{ ["--md-min-h" as string]: "100%", ["--md-max-h" as string]: "none" }}>
            <Toolbar groups={groups} view={view} />
            <div ref={bigHost} className="min-h-0 flex-1 text-left [&>.cm-editor]:h-full [&_.cm-content]:text-[16px]" />
          </div>
        </dialog>
      )}
    </>
  );
}

export default MarkdownEditor;
