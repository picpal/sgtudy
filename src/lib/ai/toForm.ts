import type { TagItem } from "@/components/room-new/tags";
import type { NewRoomValues } from "@/components/room-new/validate";
import type { Tone } from "@/lib/palette";
import type { Draft } from "./schema";

/* 인터뷰 초안 ↔ 수동 폼 값(D13). 두 모드가 같은 values·tags 를 공유하고, 인터뷰에는 "채운 칸" 만 초안으로 보낸다 */

const TONES: readonly string[] = ["mint", "blue", "peach", "lav", "amber", "slate"];

/** 초안을 폼 값 위에 얹는다 — 초안에 없는 칸은 base 그대로 */
export function toNewRoomValues(d: Draft, base: NewRoomValues): NewRoomValues {
  const v = { ...base };
  for (const k of ["title", "intro", "startDate", "endDate", "descriptionMd", "rulesMd"] as const) if (d[k] !== undefined) v[k] = d[k]!;
  if (d.maxMembers !== undefined) v.maxMembers = String(d.maxMembers);
  if (d.minMembers !== undefined) v.minMembers = d.minMembers === null ? "" : String(d.minMembers);
  if (d.isPublic !== undefined) v.isPublic = d.isPublic;
  if (d.joinMode !== undefined) v.joinMode = d.joinMode;
  if (d.leaderDoesTasks !== undefined) v.leaderDoesTasks = d.leaderDoesTasks;
  return v;
}

export function toTagItems(d: Draft, base: TagItem[]): TagItem[] {
  if (!d.tags) return base;
  return d.tags.map((t) => ({ ...(t.slug ? { slug: t.slug } : {}), label: t.label, ...(t.tone && TONES.includes(t.tone) ? { tone: t.tone as Tone } : {}) }));
}

/** 폼 칸 이름 → 초안 키. 공개·참가 방식은 한 묶음(isPublic) */
export type FilledKey = keyof NewRoomValues | "tags";

/**
 * 폼 값 → 인터뷰에 보낼 초안. filled(사용자가 고쳤거나 인터뷰가 채운 칸)만 담는다 —
 * 기본값(최대 인원 6, 공개·바로 참가)을 "이미 채움" 으로 보내면 AI 가 묻지 않고 넘어가기 때문
 */
export function fromNewRoomValues(v: NewRoomValues, tags: TagItem[], filled: ReadonlySet<FilledKey>): Draft {
  const d: Draft = {};
  const has = (k: FilledKey) => filled.has(k);
  for (const k of ["title", "intro", "startDate", "endDate", "descriptionMd", "rulesMd"] as const) if (has(k) && v[k].trim()) d[k] = v[k];
  if (has("maxMembers") && /^\d+$/.test(v.maxMembers.trim())) d.maxMembers = Number(v.maxMembers);
  if (has("minMembers")) d.minMembers = /^\d+$/.test(v.minMembers.trim()) ? Number(v.minMembers) : null;
  if (has("isPublic") || has("joinMode")) {
    d.isPublic = v.isPublic;
    d.joinMode = v.joinMode;
  }
  if (has("leaderDoesTasks")) d.leaderDoesTasks = v.leaderDoesTasks;
  if (has("tags") || tags.length) d.tags = tags.map((t) => ({ ...(t.slug ? { slug: t.slug } : {}), label: t.label }));
  return d;
}

/** 초안이 채운 칸 이름들 — filled 에 더한다 */
export function draftKeys(d: Draft): FilledKey[] {
  return (Object.keys(d) as (keyof Draft)[]).filter((k) => d[k] !== undefined) as FilledKey[];
}

/** 두 폼 값에서 바뀐 칸 */
export function changedKeys(a: NewRoomValues, b: NewRoomValues): (keyof NewRoomValues)[] {
  return (Object.keys(b) as (keyof NewRoomValues)[]).filter((k) => a[k] !== b[k]);
}
