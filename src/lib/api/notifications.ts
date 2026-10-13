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
