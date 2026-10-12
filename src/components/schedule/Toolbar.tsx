import { STUDIES, type StudyId } from "@/data/schedule";

export type View = "month" | "list";

type Props = {
  y: number;
  m: number;
  view: View;
  off: StudyId[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onToggle: (id: StudyId) => void;
  onView: (v: View) => void;
};

const roundBtn = "flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2";

export function Toolbar({ y, m, view, off, onPrev, onNext, onToday, onToggle, onView }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="m-0 min-w-[150px] text-[26px] font-bold tracking-[-0.02em]">
        {y}년 {m + 1}월
      </h1>
      <div className="flex items-center gap-[6px]">
        <button type="button" aria-label="이전 달" className={roundBtn} onClick={onPrev}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <button type="button" aria-label="다음 달" className={roundBtn} onClick={onNext}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToday}
          className="h-10 rounded-[20px] border border-line bg-surface px-[14px] text-[13px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2"
        >
          오늘
        </button>
      </div>
      <div className="flex-[1_1_20px]" />
      <div role="group" aria-label="스터디 필터" className="flex flex-wrap gap-[6px]">
        {STUDIES.map((s) => {
          const active = !off.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(s.id)}
              className="inline-flex h-[34px] items-center gap-[6px] rounded-[17px] border px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2"
              style={{
                borderColor: active ? s.dot : "#D9E2DF",
                background: active ? s.bg : "#FFFFFF",
                color: active ? s.fg : "#7A8594",
                fontWeight: active ? 600 : 500,
              }}
            >
              <span className="h-[9px] w-[9px] rounded-full" style={{ background: active ? s.dot : "#C9D1D6" }} />
              {s.name}
            </button>
          );
        })}
      </div>
      <div role="tablist" aria-label="보기 방식" className="flex rounded-[12px] bg-bg p-[3px]">
        {(
          [
            ["month", "월간"],
            ["list", "목록"],
          ] as [View, string][]
        ).map(([id, label]) => {
          const a = view === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={a}
              onClick={() => onView(id)}
              className={`h-[34px] rounded-[9px] px-[14px] text-[13px] focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2 ${
                a ? "bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(27,34,48,.12)]" : "bg-transparent font-medium text-muted"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
