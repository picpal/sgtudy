"use client";

import { useEffect, useState, type RefObject } from "react";

type Props = {
  /** 문항별 답함 여부 — 화면 번호 순 */
  answered: boolean[];
  current: number;
  onJump: (i: number) => void;
  /** side = 넓은 화면 오른쪽 붙는 칸(36px 칸) · sheet = 좁은 화면 하단 막대 위로 펼치는 판(44px 칸) */
  variant: "side" | "sheet";
  id?: string;
  className?: string;
};

/** 문항 이동 — 번호 칸(답함/안 답함 · 지금 문항) + "n/총 답함". 누르면 그 문항으로 */
export function ExamNav({ answered, current, onJump, variant, id, className = "" }: Props) {
  const done = answered.filter(Boolean).length;
  const side = variant === "side";
  return (
    <nav id={id} aria-label="문항 이동" className={`flex flex-col gap-2 ${className}`}>
      <p className="m-0 flex items-baseline justify-between gap-2 px-[2px] text-[12px] text-ink-3">
        <span className="font-semibold text-ink-2">문항 이동</span>
        <span>
          <b className="font-bold text-ink">
            {done}/{answered.length}
          </b>{" "}
          답함
        </span>
      </p>
      <ol className={`m-0 grid list-none gap-[6px] p-0 ${side ? "grid-cols-5" : "grid-cols-[repeat(auto-fill,minmax(44px,1fr))]"}`}>
        {answered.map((a, i) => {
          const cur = i === current;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-label={`${i + 1}번 문항 · ${a ? "답함" : "안 답함"}`}
                aria-current={cur ? "step" : undefined}
                className={`grid w-full cursor-pointer place-items-center rounded-[9px] border text-[13px] font-semibold transition-[transform,box-shadow,background-color] hover:-translate-y-px hover:shadow-[0_3px_8px_rgba(27,34,48,.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${side ? "h-9" : "h-11"} ${
                  a ? "border-mint/40 bg-mint-soft text-mint-deep hover:bg-[#c9ede3]" : "border-line-3 bg-surface text-ink-3 hover:border-mint hover:bg-surface-2"
                } ${cur ? "ring-2 ring-navy ring-offset-1" : ""}`}
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 지금 문항 — 화면 위쪽 띠(상단 고정 막대 아래 ~ 화면 45%)에 걸린 첫 문항. IntersectionObserver 가 없으면(jsdom) 0 */
export function useCurrentQuestion(list: RefObject<HTMLElement | null>, count: number): [number, (i: number) => void] {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<number>();
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const i = Number((e.target as HTMLElement).dataset.qi);
          if (e.isIntersecting) seen.add(i);
          else seen.delete(i);
        }
        if (seen.size) setCurrent(Math.min(...seen));
      },
      { rootMargin: "-96px 0px -55% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-qi]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [list, count]);
  return [current, setCurrent];
}
