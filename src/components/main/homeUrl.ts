import type { StatusFilter, Tab } from "./FilterBar";

/**
 * 방 둘러보기(/) 필터 ↔ 주소. ?tab=mine&status=recruit&q=aws&tag=aws&tag=cloud — 기본값은 주소에서 뺀다.
 * 서버 페이지가 같은 규칙으로 읽어 첫 화면을 그 조건으로 그리고(새로고침·공유), 화면은 history API 로만 주소를 고친다(서버 왕복 없음).
 */
export type HomeFilters = { scope: Tab; status: StatusFilter; q: string; tags: string[] };

export const DEFAULT_FILTERS: HomeFilters = { scope: "public", status: "all", q: "", tags: [] };

const SCOPES: readonly Tab[] = ["public", "mine", "created"];
const STATUSES: readonly StatusFilter[] = ["all", "recruit", "active", "ended"];
const MAX_TAGS = 10;
const MAX_Q = 50;

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;

const all = (sp: Raw, k: string): string[] => {
  if (sp instanceof URLSearchParams) return sp.getAll(k);
  const v = sp[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

export function parseHomeFilters(sp: Raw): HomeFilters {
  const tab = all(sp, "tab")[0];
  const status = all(sp, "status")[0];
  const tags = [...new Set(all(sp, "tag").map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TAGS);
  return {
    scope: SCOPES.includes(tab as Tab) ? (tab as Tab) : DEFAULT_FILTERS.scope,
    status: STATUSES.includes(status as StatusFilter) ? (status as StatusFilter) : DEFAULT_FILTERS.status,
    q: (all(sp, "q")[0] ?? "").trim().slice(0, MAX_Q),
    tags,
  };
}

export function homeHref(f: HomeFilters): string {
  const sp = new URLSearchParams();
  if (f.scope !== DEFAULT_FILTERS.scope) sp.set("tab", f.scope);
  if (f.status !== DEFAULT_FILTERS.status) sp.set("status", f.status);
  if (f.q.trim()) sp.set("q", f.q.trim());
  for (const t of f.tags) sp.append("tag", t);
  const s = sp.toString();
  return s ? `/?${s}` : "/";
}

export const sameFilters = (a: HomeFilters, b: HomeFilters) =>
  a.scope === b.scope && a.status === b.status && a.q === b.q && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);

/** 주소 갱신 방식 — 검색어만 바뀌면 replace(글자마다 기록이 쌓이지 않게), 탭·상태·태그가 바뀌면 push(뒤로 가기 = 직전 필터) */
export function urlStep(from: HomeFilters, to: HomeFilters): "none" | "replace" | "push" {
  if (sameFilters(from, to)) return "none";
  return sameFilters({ ...from, q: to.q }, to) ? "replace" : "push";
}

/** 둘러보기 필터를 이어받은 방 상세 주소 — 상세 화면 왼쪽 목록이 같은 조건으로 그려진다 (시나리오 QA #19) */
export function roomHrefWith(slug: string, f: HomeFilters): string {
  const q = homeHref(f).slice(1); // "/?a=b" → "?a=b", "/" → ""
  return `/rooms/${slug}${q}`;
}

/** 왼쪽 목록 머리 아래 안내 — 검색어·태그로 거른 목록일 때만 (상태는 칩이 보여 준다) */
export function filtersNote(f: HomeFilters, tagLabels: string[]): string | null {
  const parts = [f.q.trim() ? `‘${f.q.trim()}’` : "", tagLabels.map((t) => `#${t}`).join(" ")].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} 로 거른 목록` : null;
}
