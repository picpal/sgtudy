import type { FileMeta } from "@/lib/api/types";

/* 이 기기 임시 저장 — localStorage 에만 둔다. 서버(submission_upsert)를 부르지 않는다:
   처음 호출이 곧 제출이라 시각·지각이 고정된다 (스펙 Review Focus 1) */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
export type Draft = { body: string; links: string[]; files: FileMeta[]; at: string };
type Saved = { bodyMd: string; links: string[]; files: Pick<FileMeta, "id">[] };

export const draftKey = (nodeId: string, userId: string) => `sgtudy.subdraft.v1:${nodeId}:${userId}`;

export function readDraft(store: Store, key: string): Draft | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft> | null;
    if (!d || typeof d.body !== "string" || !Array.isArray(d.links) || !Array.isArray(d.files)) return null;
    return { body: d.body, links: d.links, files: d.files, at: typeof d.at === "string" ? d.at : "" };
  } catch {
    return null;
  }
}

/** 쓰기 — 저장소가 없거나 가득 차면 false (나가기 확인의 [임시저장]은 실패를 알리고 머문다) */
export function writeDraft(store: Store, key: string, d: Draft): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    /* 저장소 없음·가득 참 — 자동 임시본은 없어도 동작 */
    return false;
  }
}

export function clearDraft(store: Store, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* noop */
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 작성 내용이 기준(저장된 제출 · 이어 쓴 임시본)과 다른가 — 본문은 앞뒤 공백을 빼고 본다. 기준이 없으면 공백 아닌 내용이 하나라도 있을 때 true */
export function contentDiffers(c: { body: string; links: string[]; fileIds: string[] }, base: { body: string; links: string[]; fileIds: string[] } | null): boolean {
  if (!base) return c.body.trim() !== "" || c.links.length > 0 || c.fileIds.length > 0;
  return c.body.trim() !== base.body.trim() || !sameList(c.links, base.links) || !sameList(c.fileIds, base.fileIds);
}

/** 임시본이 저장된 제출과 다른가 — 저장본이 없으면 내용이 하나라도 있을 때 true */
export function draftDiffers(d: Draft, saved: Saved | null): boolean {
  if (!saved) return d.body !== "" || d.links.length > 0 || d.files.length > 0;
  return d.body !== saved.bodyMd || !sameList(d.links, saved.links) || !sameList(d.files.map((f) => f.id), saved.files.map((f) => f.id));
}
