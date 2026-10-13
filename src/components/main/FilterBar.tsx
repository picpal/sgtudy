export type Tab = "public" | "mine" | "created";
export type StatusFilter = "all" | "recruit" | "active" | "ended";

export const TABS: { key: Tab; label: string }[] = [
  { key: "public", label: "전체 공개 방" },
  { key: "mine", label: "내가 참가한 방" },
  { key: "created", label: "내가 만든 방" },
];

const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "recruit", label: "모집중" },
  { key: "active", label: "진행중" },
  { key: "ended", label: "종료" },
];

type Props = {
  tab: Tab;
  tabCounts: Record<Tab, number>;
  onTab: (t: Tab) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  /** 서버 tagFacets — label 표시, slug 로 선택 */
  tagCounts: { slug: string; tag: string; count: number }[];
  /** 선택된 slug */
  tags: string[];
  onToggleTag: (slug: string) => void;
  onResetTags: () => void;
  /** 비로그인: 전체 공개 방 탭만 */
  anonymous?: boolean;
};

export function FilterBar({ tab, tabCounts, onTab, status, onStatus, tagCounts, tags, onToggleTag, onResetTags, anonymous }: Props) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div role="tablist" aria-label="방 범위" className="flex gap-1">
          {TABS.filter((t) => !anonymous || t.key === "public").map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTab(t.key)}
                className={`-mb-px flex h-12 items-center gap-[6px] whitespace-nowrap border-b-2 bg-transparent px-[14px] text-[15px] ${
                  on ? "border-ink font-bold text-ink" : "border-transparent font-medium text-muted"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-[10px] px-[7px] py-px text-[12px] font-semibold ${
                    on ? "bg-ink text-white" : "bg-slate-soft text-ink-3"
                  }`}
                >
                  {tabCounts[t.key]}
                </span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-[6px] pb-[10px]">
          {STATUSES.map((s) => {
            const on = s.key === status;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => onStatus(s.key)}
                className={`flex h-[34px] items-center whitespace-nowrap rounded-[17px] border px-[14px] text-[13px] ${
                  on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="group" aria-label="태그 필터" className="-mt-2 mb-6 flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1 text-[13px] font-semibold text-ink-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
            <circle cx="7.5" cy="7.5" r="1.3" />
          </svg>
          태그
        </span>
        {tagCounts.map(({ slug, tag, count }) => {
          const on = tags.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleTag(slug)}
              className={`flex h-8 items-center gap-[6px] whitespace-nowrap rounded-2xl border px-3 text-[13px] ${
                on ? "border-mint bg-mint-soft font-semibold text-mint-deep" : "border-line-3 bg-surface font-medium text-ink-2"
              }`}
            >
              #{tag}
              <span className={`text-[11px] font-semibold ${on ? "text-mint-deep" : "text-faint"}`}>{count}</span>
            </button>
          );
        })}
        {tags.length > 0 && (
          <button
            type="button"
            onClick={onResetTags}
            className="flex h-8 items-center gap-1 border-0 bg-transparent px-[10px] text-[13px] font-semibold text-mint"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            초기화
          </button>
        )}
      </div>
    </>
  );
}
