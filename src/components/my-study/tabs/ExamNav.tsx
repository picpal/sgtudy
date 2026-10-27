"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

/** 번호 칸 하나 — text = 칸 글자(문항 번호), label = aria-label·title(색만으로 구분하지 않게 상태를 글로), tone = 칸 색 클래스,
 * mark = 오른쪽 위 귀퉁이 표시(마지막 정오), star = 왼쪽 위 귀퉁이 ★(오답노트 다시 볼 문제 — label 에도 글로 넣는다) */
export type NavCell = { key: string; text: string; label: string; tone: string; mark?: "ok" | "bad" | null; star?: boolean };
/** 칸 묶음 — 시험이 여럿이면 시험별(title = 시험 이름). 번호 칸 index 는 묶음을 이어 센다 */
export type NavGroup = { key: string; title?: string; cells: NavCell[] };

type NavProps = {
  groups: NavGroup[];
  /** 머리 오른쪽 — "n/총 답함" 등 */
  summary: ReactNode;
  current: number;
  onJump: (i: number) => void;
  /** side = 넓은 화면 오른쪽 붙는 칸(36px 칸) · sheet = 좁은 화면 바텀 시트 안(44px 칸, 머리는 시트가 그린다) */
  variant: "side" | "sheet";
  /** 번호 칸 아래 각주(범례) */
  legend?: ReactNode;
  id?: string;
  className?: string;
};

export const NAV_TONE = {
  answered: "border-mint/40 bg-mint-soft text-mint-deep hover:bg-[#c9ede3]",
  idle: "border-line-3 bg-surface text-ink-3 hover:border-mint hover:bg-surface-2",
} as const;

const MARK = { ok: "bg-done", bad: "bg-warn" } as const;

/** 문항 이동 — 번호 칸(색·귀퉁이 표시 · 지금 문항) + 머리 요약 + 각주. 누르면 그 문항으로. 시험 응시(ExamNav)와 오답노트 상세가 같이 쓴다 */
export function QuestionNav({ groups, summary, current, onJump, variant, legend, id, className = "" }: NavProps) {
  const side = variant === "side";
  let at = 0;
  return (
    <nav id={id} aria-label="문항 이동" className={`flex flex-col gap-2 ${className}`}>
      {side && (
        <p className="m-0 flex items-baseline justify-between gap-2 px-[2px] text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2">문항 이동</span>
          <span>{summary}</span>
        </p>
      )}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-[6px]">
          {g.title && <p className="m-0 truncate px-[2px] text-[11px] font-semibold text-ink-3" title={g.title}>{g.title}</p>}
          <ol className={`m-0 grid list-none gap-[6px] p-0 ${side ? "grid-cols-5" : "grid-cols-[repeat(auto-fill,minmax(44px,1fr))]"}`}>
            {g.cells.map((c) => {
              const i = at++;
              const cur = i === current;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => onJump(i)}
                    aria-label={c.label}
                    title={c.label}
                    aria-current={cur ? "step" : undefined}
                    className={`relative grid w-full cursor-pointer place-items-center rounded-[9px] border text-[13px] font-semibold transition-[transform,box-shadow,background-color] hover:-translate-y-px hover:shadow-[0_3px_8px_rgba(27,34,48,.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${side ? "h-9" : "h-11"} ${c.tone} ${cur ? "ring-2 ring-navy ring-offset-1" : ""}`}
                  >
                    {c.text}
                    {c.star && (
                      <span aria-hidden="true" data-nav-star className="absolute -left-[3px] -top-[4px] text-[11px] leading-none text-amber-text [text-shadow:0_0_2px_var(--surface-2),0_0_2px_var(--surface-2)]">
                        ★
                      </span>
                    )}
                    {c.mark && (
                      <span aria-hidden="true" className={`absolute -right-[3px] -top-[3px] grid size-[13px] place-items-center rounded-full text-[8px] leading-none text-white ring-2 ring-surface-2 ${MARK[c.mark]}`}>
                        {c.mark === "ok" ? "✓" : "✗"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {legend}
    </nav>
  );
}

type SheetProps = Omit<NavProps, "variant" | "id" | "className"> & { id: string; onClose: () => void };

/**
 * 좁은 화면 문항 이동 바텀 시트 — 열 때만 그린다(body 포털). 의견 보내기 시트와 같은 결: 어두운 바탕(누르면 닫힘) ·
 * 핸들·제목·요약·닫기 머리 / 번호 칸만 스크롤(60dvh) / safe-area 아래 여백. Esc 닫기 · 포커스 트랩 · 바탕 스크롤 잠금.
 * 열면 지금 문항 칸에 포커스, 그냥 닫으면 연 버튼으로 돌린다(번호를 고르면 onJump 가 문항으로 포커스를 옮긴다)
 */
export function QuestionNavSheet({ id, onClose, summary, ...nav }: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onTrapKey = useFocusTrap(box);
  const tid = useId();
  const dismiss = () => {
    onClose();
    opener.current?.focus();
  };
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  const onEsc = useEffectEvent(dismiss);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEsc();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return createPortal(
    <div data-qnav-backdrop className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(27,34,48,.4)]" onClick={dismiss}>
      <div
        ref={box}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tid}
        onKeyDown={onTrapKey}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-48px)] w-full max-w-[560px] flex-col rounded-t-[18px] bg-surface shadow-[0_-8px_30px_rgba(27,34,48,.18)] motion-safe:animate-[notice-sheet_.22s_ease-out]"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-3" />
        <div className="flex shrink-0 items-center gap-2 border-b border-line-2 py-1 pl-4 pr-1">
          <h2 id={tid} className="m-0 text-[16px] font-bold text-ink">
            문항 이동
          </h2>
          <span className="text-[13px] text-ink-3">{summary}</span>
          <button type="button" aria-label="닫기" onClick={dismiss} className="ml-auto flex size-11 items-center justify-center rounded-full text-ink-3 hover:bg-bg hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {/* 지금 문항 링(2px+간격 1px)·귀퉁이 표시가 스크롤 칸에 잘리지 않게 안쪽 여백을 둔다 */}
        <div data-qnav-body className="thin-scroll max-h-[60dvh] min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <QuestionNav {...nav} summary={summary} variant="sheet" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  /** 문항별 답함 여부 — 화면 번호 순 */
  answered: boolean[];
  current: number;
  onJump: (i: number) => void;
  variant: "side" | "sheet";
  id?: string;
  className?: string;
};

/** 시험 응시 칸 묶음 + "n/총 답함" — 옆 칸·시트가 같이 쓴다 */
function examNavData(answered: boolean[]): Pick<NavProps, "groups" | "summary"> {
  const done = answered.filter(Boolean).length;
  const cells = answered.map((a, i) => ({ key: String(i), text: String(i + 1), label: `${i + 1}번 문항 · ${a ? "답함" : "안 답함"}`, tone: a ? NAV_TONE.answered : NAV_TONE.idle }));
  return {
    groups: [{ key: "all", cells }],
    summary: (
      <>
        <b className="font-bold text-ink">
          {done}/{answered.length}
        </b>{" "}
        답함
      </>
    ),
  };
}

/** 시험 응시 문항 이동 — 번호 칸(답함/안 답함 · 지금 문항) + "n/총 답함" */
export function ExamNav({ answered, ...rest }: Props) {
  return <QuestionNav {...rest} {...examNavData(answered)} />;
}

/** 시험 응시 좁은 화면 바텀 시트 */
export function ExamNavSheet({ answered, ...rest }: Omit<SheetProps, "groups" | "summary"> & { answered: boolean[] }) {
  return <QuestionNavSheet {...rest} {...examNavData(answered)} />;
}

/**
 * 지금 문항 — 화면 위쪽 띠(상단 고정 막대 아래 ~ 화면 45%)에 걸린 첫 문항. IntersectionObserver 가 없으면(jsdom) 0.
 * attr = 문항 요소의 data 속성(기본 data-qi, 오답노트 상세는 data-wn-idx). deps 가 바뀌면 다시 붙는다
 */
export function useCurrentQuestion(list: RefObject<HTMLElement | null>, deps: number | string, attr: "qi" | "wn-idx" = "qi"): [number, (i: number) => void] {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<number>();
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const i = Number((e.target as HTMLElement).getAttribute(`data-${attr}`));
          if (e.isIntersecting) seen.add(i);
          else seen.delete(i);
        }
        if (seen.size) setCurrent(Math.min(...seen));
      },
      { rootMargin: "-96px 0px -55% 0px" },
    );
    root.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [list, deps, attr]);
  return [current, setCurrent];
}
