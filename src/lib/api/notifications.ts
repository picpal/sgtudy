import { rpc } from "@/lib/api/errors";
import type { NotificationList } from "@/lib/api/types";
import { addDays } from "@/lib/date";

export const fetchUnreadCount = async () => (await rpc<{ count: number }>("notifications_unread_count")).count;
export const fetchNotifications = (cursor?: string | null) => rpc<NotificationList>("notifications_list", { p_cursor: cursor ?? null, p_limit: 20 });
export const markRead = (id: string) => rpc<null>("notifications_read", { p_id: id }).then(() => undefined);
export const markAllRead = async () => (await rpc<{ updated: number }>("notifications_read_all")).updated;

const KST_MS = 9 * 3600_000;
const kstDate = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);

/** cross-cutting §3 알림 상대시간. 24시간 안은 분·시간, 그 밖은 KST 달력일 기준 어제 / M월 D일 */
export function relativeTime(iso: string, now: Date): string {
  const t = new Date(iso);
  const diff = Math.max(0, now.getTime() - t.getTime());
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  const d = kstDate(t);
  if (d === addDays(kstDate(now), -1)) return "어제";
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

const PANEL_W = 360;
const GUTTER = 16;

/** 벨 오른쪽 끝(anchorRight)에 right-0 으로 붙인 패널이 왼쪽 16px 여백 안에 들도록 오른쪽으로 밀 거리 */
export function panelShift(anchorRight: number, viewport: number): number {
  const w = Math.min(PANEL_W, viewport - GUTTER * 2);
  return Math.max(0, GUTTER - (anchorRight - w));
}

/** 본문이 방 제목과 같으면 메타 줄(방 제목 · 시간)과 겹치므로 숨긴다 — 백엔드 문구는 그대로(Q1-14) */
export function visibleBody(n: { body: string | null; room: { title: string } | null }): string {
  const body = n.body?.trim() ?? "";
  return body && body !== n.room?.title.trim() ? body : "";
}

/**
 * 로컬 변경(낙관적 읽음 처리) 뒤에 시작하지 않은 조회 결과는 버린다.
 * bump() 는 로컬 변경 때와 그 서버 반영이 끝났을 때 부른다 — 사이에 시작한 폴링은 커밋 전 값을 받을 수 있다.
 */
export function pollGuard() {
  let seq = 0;
  return {
    bump: () => {
      seq++;
    },
    run: <T>(p: Promise<T>) => {
      const at = seq;
      return p.then((value) => ({ fresh: at === seq, value }));
    },
  };
}
