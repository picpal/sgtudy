import type { MentionPick } from "@/lib/mention";

/* 댓글 작성 중 글 — 이 기기 localStorage 에만 둔다(D24). 이탈 가드에는 넣지 않는다: 짧은 글이라 화면 이동을 무겁게 하지 않고 돌아오면 복원 */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
export type CommentDraft = { text: string; picks: MentionPick[] };
/** 이보다 오래된 임시 저장은 읽을 때 지운다 — 노드마다 키가 쌓이고 공용 기기에 남지 않게 */
export const DRAFT_TTL_MS = 14 * 86_400_000;

export const commentDraftKey = (nodeId: string, userId: string) => `sgtudy.cdraft.v1:${nodeId}:${userId}`;

/** 저장소 — 사파리 사생활 보호 등에서 접근만으로 던질 수 있다 */
export function draftStore(): Store {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCommentDraft(store: Store, key: string, now = Date.now()): CommentDraft | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as (Partial<CommentDraft> & { at?: number }) | null;
    if (!d || typeof d.text !== "string" || !Array.isArray(d.picks)) return null;
    if (typeof d.at === "number" && now - d.at > DRAFT_TTL_MS) {
      store?.removeItem(key);
      return null;
    }
    const picks = d.picks.filter((p): p is MentionPick => !!p && typeof p.userId === "string" && typeof p.nickname === "string");
    return { text: d.text, picks };
  } catch {
    return null;
  }
}

/** 빈 글이면 지운다 */
export function writeCommentDraft(store: Store, key: string, d: CommentDraft): void {
  try {
    if (d.text.trim() === "") store?.removeItem(key);
    else store?.setItem(key, JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* 저장소 없음·가득 참 — 없어도 동작 */
  }
}

export function clearCommentDraft(store: Store, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* noop */
  }
}
