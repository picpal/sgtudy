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

export function writeDraft(store: Store, key: string, d: Draft): void {
  try {
    store?.setItem(key, JSON.stringify(d));
  } catch {
    /* 저장소 없음·가득 참 — 없어도 동작 */
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

/** 임시본이 저장된 제출과 다른가 — 저장본이 없으면 내용이 하나라도 있을 때 true */
export function draftDiffers(d: Draft, saved: Saved | null): boolean {
  if (!saved) return d.body !== "" || d.links.length > 0 || d.files.length > 0;
  return d.body !== saved.bodyMd || !sameList(d.links, saved.links) || !sameList(d.files.map((f) => f.id), saved.files.map((f) => f.id));
}
