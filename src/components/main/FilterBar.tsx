export type Tab = "public" | "mine" | "created";
export type StatusFilter = "all" | "recruit" | "active" | "ended";

export const TABS: { key: Tab; label: string }[] = [
  { key: "public", label: "전체 공개 방" },
  { key: "mine", label: "내가 참가한 방" },
  { key: "created", label: "내가 만든 방" },
];

/** 누르는 영역 44px — 보이는 크기는 그대로, 가상 요소로만 세로를 키운다(my-study/bits.tsx HIT_Y 와 같은 클래스) */
const HIT = "relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

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
        {/* 390 폭에서 탭 3개가 358px 를 넘는다 — 페이지가 아니라 탭 줄만 가로로 스크롤(Q1-03). pb-px: -mb-px 밑줄이 세로 스크롤을 만들지 않게 */}
        {/* ≤640: 스크롤 줄을 화면 끝까지 늘려(-mx-4·px-4) 잘린 탭이 본문 여백 한가운데가 아니라 화면 가장자리에서 넘어가게 — 더 있다는 게 보인다 */}
        <div role="tablist" aria-label="방 범위" className="thin-scroll flex min-w-0 max-w-full gap-1 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:max-w-none max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-px">
          {TABS.filter((t) => !anonymous || t.key === "public").map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTab(t.key)}
                className={`-mb-px flex h-12 shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 bg-transparent px-[14px] text-[15px] max-sm:px-[10px] max-sm:text-[14px] ${
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
        {/* 칩은 보이는 34px 그대로, 누르는 영역만 가상 요소로 44px(HIT). 줄바꿈되면 세로 간격 10(= 44 − 34)이라 겹치지 않는다 */}
        <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-x-[6px] gap-y-[10px] pb-[10px]">
          {STATUSES.map((s) => {
            const on = s.key === status;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => onStatus(s.key)}
                className={`${HIT} flex h-[34px] items-center whitespace-nowrap rounded-[17px] border px-[14px] text-[13px] ${
                  on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 태그 칩·초기화는 보이는 32px, 누르는 영역 44px — 줄 간격 12(= 44 − 32). 위 상태 칩과는 구분선·여백 26px 이라 겹치지 않는다.
          ≤640: 태그가 많으면 칩이 여러 줄을 차지해 방 목록이 한참 밀린다 — 칩만 한 줄 가로 스크롤(화면 끝까지), 44px 누름 영역은 py 로 안에 둔다 */}
      <div role="group" aria-label="태그 필터" className="-mt-2 mb-6 flex flex-wrap items-center gap-x-2 gap-y-3 max-sm:mb-4 max-sm:-mt-3 max-sm:gap-y-1">
        <span className="mr-1 flex items-center gap-1 text-[13px] font-semibold text-ink-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
            <circle cx="7.5" cy="7.5" r="1.3" />
          </svg>
          태그
        </span>
        <div className="thin-scroll contents max-sm:-mr-4 max-sm:flex max-sm:min-w-0 max-sm:flex-1 max-sm:gap-2 max-sm:overflow-x-auto max-sm:py-[6px] max-sm:pr-4">
        {tagCounts.map(({ slug, tag, count }) => {
          const on = tags.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleTag(slug)}
              className={`${HIT} flex h-8 items-center gap-[6px] whitespace-nowrap rounded-2xl border px-3 text-[13px] ${
                on ? "border-mint bg-mint-soft font-semibold text-mint-deep" : "border-line-3 bg-surface font-medium text-ink-2"
              }`}
            >
              #{tag}
              <span className={`text-[11px] font-semibold ${on ? "text-mint-deep" : "text-faint"}`}>{count}</span>
            </button>
          );
        })}
        </div>
        {tags.length > 1 && (
          // 서버는 고른 태그 중 하나라도 가진 방을 돌려준다(OR) — 좁히는 게 아니라 넓힌다는 걸 알린다(Q3-4)
          <span data-tag-hint className="basis-full text-[12px] text-muted">
            고른 태그 중 하나라도 있는 방을 보여줘요
          </span>
        )}
        {tags.length > 0 && (
          <button
            type="button"
            onClick={onResetTags}
            className={`${HIT} flex h-8 items-center gap-1 border-0 bg-transparent px-[10px] text-[13px] font-semibold text-mint`}
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
