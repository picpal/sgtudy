import { rpc } from "@/lib/api/errors";
import type { RoomTagDto } from "@/lib/api/types";
import type { Tone } from "@/lib/palette";
import { cpLength } from "./validate";

/**
 * 방 태그 고르기 — 방 만들기(room_create p_tag_slugs)와 방 설정(room_tags_put)이 같이 쓴다.
 * 사전 태그(tags_search 결과)는 slug 가 있고, 자유 입력은 label 만 있다(서버 tag_slug_for 가 같은 라벨을 재사용하거나 새로 만든다).
 * auto = 진행목표 내용으로 자동으로 붙은 태그(room_tags.source = AUTO).
 */
export type TagItem = { slug?: string; label: string; tone?: Tone; auto?: boolean };

/** 서버 room_tags_put·room_create 의 상한 */
export const TAG_LIMIT = 8;
const LABEL_MAX = 20;

export const tagKey = (t: TagItem) => (t.slug ? `s:${t.slug}` : `l:${t.label.trim().toLowerCase()}`);

export function tagLabelError(label: string): string | null {
  const v = label.trim();
  if (!v) return "태그 이름을 입력해 주세요";
  if (cpLength(v) > LABEL_MAX) return `태그는 ${LABEL_MAX}자까지예요`;
  return null;
}

/** 끝에 붙인다. 같은 slug·같은 라벨(대소문자 무시)이 이미 있으면 그대로. 8개 초과·잘못된 라벨은 error */
export function addTag(list: TagItem[], item: TagItem): { list: TagItem[]; error?: string } {
  const t = item.slug ? item : { ...item, label: item.label.trim() };
  if (!t.slug) {
    const err = tagLabelError(t.label);
    if (err) return { list, error: err };
  }
  const label = t.label.trim().toLowerCase();
  if (list.some((x) => tagKey(x) === tagKey(t) || x.label.trim().toLowerCase() === label)) return { list };
  if (list.length >= TAG_LIMIT) return { list, error: `태그는 ${TAG_LIMIT}개까지예요` };
  return { list: [...list, t] };
}

export const removeTag = (list: TagItem[], key: string) => list.filter((t) => tagKey(t) !== key);

export function toPutArgs(list: TagItem[]): { slugs: string[]; freeLabels: string[] } {
  return { slugs: list.flatMap((t) => (t.slug ? [t.slug] : [])), freeLabels: list.flatMap((t) => (t.slug ? [] : [t.label.trim()])) };
}

/** 저장할 게 있나 — 순서까지(서버 sort_order). 자동 여부는 보지 않는다 */
export const sameTags = (a: TagItem[], b: TagItem[]) => a.length === b.length && a.every((t, i) => tagKey(t) === tagKey(b[i]));

export const fromDto = (t: RoomTagDto): TagItem => ({ slug: t.slug, label: t.label, tone: t.tone, auto: t.auto });

/* ── RPC ── */
export const searchTags = async (q: string) => (await rpc<{ items: RoomTagDto[] }>("tags_search", { p_q: q.trim() || null })).items;
/** 전체 교체(그룹장). 목록에서 뺀 자동 태그는 다시 자동으로 붙지 않고, 남긴 태그는 모두 직접 고른 태그가 된다(0009 room_tags_put) */
export const putRoomTags = async (slug: string, list: TagItem[]) => {
  const { slugs, freeLabels } = toPutArgs(list);
  return (await rpc<{ items: RoomTagDto[] }>("room_tags_put", { p_slug: slug, p_slugs: slugs, p_free_labels: freeLabels })).items;
};
