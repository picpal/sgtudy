import { clampCp, maxEndDate } from "@/components/room-new/validate";
import { TAG_LIMIT } from "@/components/room-new/tags";
import { ACCESS_VALUES, MD_MAX, REQUIRED_FIELDS, type Draft, type DraftTag, type Dropped, type Field, type RequiredField } from "./schema";

/* 모델·클라이언트가 낸 값을 수동 폼 규칙(validate.ts)으로 정규화한다(D10). 길이는 자르고, 범위 밖 값은 버리고 dropped 로 알린다 */

/** 태그 사전(tags_search) — slug 로 고정 */
export type TagDict = { slug: string; label: string; tone?: string }[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 실제로 있는 날짜인가(2026-02-30 같은 값 거름) */
export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const toInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\s*\d{1,6}\s*$/.test(v)) return Number(v);
  return null;
};
const str = (v: unknown) => (typeof v === "string" ? v : null);
/** 제어문자 제거(줄바꿈·탭은 남김) */
export const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, "");

const REASON = {
  startDate: "시작일은 오늘부터 1년 안의 날짜예요",
  endDate: "종료일은 시작일부터 1년 안이에요",
  maxMembers: "최대 인원은 2~100명이에요",
  minMembers: "최소 인원은 1명 이상, 최대 인원 이하예요",
  tags: `태그는 ${TAG_LIMIT}개까지예요`,
} as const;

/** 태그 목록 정규화 — 사전 slug·같은 라벨이면 사전 태그로, 아니면 자유 라벨(20자). 중복 제거, 8개 초과는 버림 */
function normalizeTags(raw: unknown, dict: TagDict, dropped: Dropped[]): DraftTag[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DraftTag[] = [];
  const seen = new Set<string>();
  let over = false;
  for (const item of raw) {
    const s = typeof item === "string" ? item : str((item as { slug?: unknown })?.slug) ?? str((item as { label?: unknown })?.label);
    const label0 = typeof item === "object" && item ? str((item as { label?: unknown }).label) : null;
    if (!s?.trim()) continue;
    const key = s.trim().toLowerCase();
    const hit = dict.find((t) => t.slug === s.trim() || t.label.toLowerCase() === key || (label0 && t.label.toLowerCase() === label0.trim().toLowerCase()));
    const tag: DraftTag = hit ? { slug: hit.slug, label: hit.label, ...(hit.tone ? { tone: hit.tone } : {}) } : { label: clampCp(stripControl(label0 ?? s).trim(), 20) };
    if (!tag.label) continue;
    const k = tag.slug ? `s:${tag.slug}` : `l:${tag.label.toLowerCase()}`;
    if (seen.has(k) || out.some((t) => t.label.toLowerCase() === tag.label.toLowerCase())) continue;
    if (out.length >= TAG_LIMIT) {
      over = true;
      continue;
    }
    seen.add(k);
    out.push(tag);
  }
  if (over) dropped.push({ field: "tags", reason: REASON.tags });
  return out;
}

/**
 * patch(모델 출력 또는 클라이언트 초안)를 base 위에 얹을 수 있는 값만 남긴다.
 * 범위 확인은 base 와 합친 값(시작일·최대 인원)을 기준으로 한다. 순수 함수.
 */
export function normalizePatch(patch: Record<string, unknown>, base: Draft, today: string, dict: TagDict): { patch: Draft; dropped: Dropped[] } {
  const out: Draft = {};
  const dropped: Dropped[] = [];
  const text = (k: "title" | "intro" | "descriptionMd" | "rulesMd", max: number) => {
    const v = str(patch[k]);
    if (v === null) return;
    const t = clampCp(stripControl(v).trim(), max);
    if (t) out[k] = t;
  };
  text("title", 60);
  text("intro", 100);
  text("descriptionMd", MD_MAX);
  text("rulesMd", MD_MAX);

  if (patch.startDate !== undefined) {
    const s = patch.startDate;
    if (isYmd(s) && s >= today && s <= addDays(today, 365)) out.startDate = s;
    else dropped.push({ field: "startDate", reason: REASON.startDate });
  }
  if (patch.endDate !== undefined) {
    const e = patch.endDate;
    const start = out.startDate ?? base.startDate;
    const ok = isYmd(e) && (start ? e >= start && e <= maxEndDate(start) : e >= today);
    if (ok) out.endDate = e as string;
    else dropped.push({ field: "endDate", reason: REASON.endDate });
  }
  if (patch.maxMembers !== undefined) {
    const n = toInt(patch.maxMembers);
    if (n !== null && n >= 2 && n <= 100) out.maxMembers = n;
    else dropped.push({ field: "maxMembers", reason: REASON.maxMembers });
  }
  if (patch.minMembers !== undefined) {
    if (patch.minMembers === null || patch.minMembers === "") out.minMembers = null;
    else {
      const n = toInt(patch.minMembers);
      const max = out.maxMembers ?? base.maxMembers ?? 100;
      if (n !== null && n >= 1 && n <= max) out.minMembers = n;
      else dropped.push({ field: "minMembers", reason: REASON.minMembers });
    }
  }
  for (const k of ["isPublic", "leaderDoesTasks"] as const) if (typeof patch[k] === "boolean") out[k] = patch[k] as boolean;
  if (patch.joinMode === "direct" || patch.joinMode === "approval") out.joinMode = patch.joinMode;
  const tags = normalizeTags(patch.tags, dict, dropped);
  if (tags) out.tags = tags;
  return { patch: out, dropped };
}

/** 합치기 — patch 의 키만 덮는다. 시작일이 바뀌어 기존 종료일이 범위 밖이 되면 종료일을 비운다(다시 묻게) */
export function mergeDraft(base: Draft, patch: Draft): Draft {
  const next: Draft = { ...base, ...patch };
  if (next.startDate && next.endDate && (next.endDate < next.startDate || next.endDate > maxEndDate(next.startDate))) delete next.endDate;
  if (next.minMembers != null && next.maxMembers != null && next.minMembers > next.maxMembers) delete next.minMembers;
  return next;
}

/** 클라이언트가 보낸 초안(위조 가능) — 정규화를 통과한 값만. 버린 값은 조용히 뺀다(사용자가 다시 채운다) */
export function normalizeDraft(raw: Record<string, unknown>, today: string, dict: TagDict): Draft {
  // 시작일이 오늘 이전이어도(어제 연 탭) 버리고 다시 묻는다 — 수동 폼 검증과 같다
  const { patch } = normalizePatch(raw, {}, today, dict);
  return mergeDraft({}, patch);
}

/** 필수 6개 중 비었거나 유효하지 않은 것(D11) — 서버가 계산한다 */
export function computeMissing(d: Draft, today: string): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => {
    switch (f) {
      case "title":
      case "intro":
        return !d[f]?.trim();
      case "startDate":
        return !isYmd(d.startDate) || d.startDate < today;
      case "endDate":
        return !isYmd(d.endDate) || !d.startDate || d.endDate < d.startDate || d.endDate > maxEndDate(d.startDate);
      case "maxMembers":
        return !(typeof d.maxMembers === "number" && d.maxMembers >= 2 && d.maxMembers <= 100);
      case "isPublic":
        return typeof d.isPublic !== "boolean" || !d.joinMode;
    }
  });
}

/**
 * 칩·직접 입력 답(answer) → 실제 필드 patch(§5.2 파생 필드). 서버가 모델보다 먼저 반영해 모델은 결과만 본다.
 * style·extra 는 글로 모델에 넘긴다(설명·규칙 초안은 모델이 쓴다) — 여기서는 빈 patch.
 */
export function deriveAnswer(answer: { field: Field; value: string } | null | undefined, draft: Draft): Record<string, unknown> {
  if (!answer) return {};
  const v = answer.value.trim();
  switch (answer.field) {
    case "access":
      if (!(ACCESS_VALUES as readonly string[]).includes(v)) return {};
      return v === "private" ? { isPublic: false, joinMode: draft.joinMode ?? "direct" } : { isPublic: true, joinMode: v === "public-approval" ? "approval" : "direct" };
    case "durationWeeks": {
      const n = toInt(v);
      if (n === null || n < 1) return { endDate: "invalid" }; // → dropped(종료일)
      return draft.startDate ? { endDate: addDays(draft.startDate, n * 7 - 1) } : {}; // 시작일 전이면 모델이 시작일부터 다시 묻는다
    }
    case "startDate":
    case "endDate":
    case "title":
    case "intro":
      return { [answer.field]: v };
    case "maxMembers":
    case "minMembers":
      return { [answer.field]: toInt(v) ?? v };
    case "isPublic":
    case "leaderDoesTasks":
      return v === "true" || v === "false" ? { [answer.field]: v === "true" } : {};
    case "joinMode":
      return { joinMode: v };
    default:
      return {};
  }
}
