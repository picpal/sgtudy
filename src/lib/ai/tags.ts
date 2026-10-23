import "server-only";
import { rpc, type Db } from "@/lib/api/errors";
import type { RoomTagDto } from "@/lib/api/types";
import { createAnonClient } from "@/lib/supabase/anon";
import type { TagDict } from "./normalize";

/* 태그 사전(§5.3) — 세션 없는 anon 으로 tags_search(null) 을 읽어 모듈 캐시(5분).
   사용자 세션으로 읽으면 그 사람만 보이는 비공개 방의 자유 태그가 캐시를 타고 다른 사람 프롬프트로 샐 수 있다 */

const TTL_MS = 5 * 60_000;
let cached: { at: number; dict: TagDict } | null = null;

export async function loadTagDict(now = Date.now()): Promise<TagDict> {
  if (cached && now - cached.at < TTL_MS) return cached.dict;
  try {
    const { items } = await rpc<{ items: RoomTagDto[] }>("tags_search", { p_q: null }, createAnonClient() as unknown as Db);
    const dict = items.map((t) => ({ slug: t.slug, label: t.label, tone: t.tone })).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    cached = { at: now, dict };
    return dict;
  } catch {
    return cached?.dict ?? []; // 사전 없이도 인터뷰는 된다(자유 라벨)
  }
}
