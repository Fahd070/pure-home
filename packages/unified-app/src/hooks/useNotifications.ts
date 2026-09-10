import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import type { Socket } from "socket.io-client";

/**
 * The shared notification data layer for all three departments.
 *
 * Every badge, banner and critical alert in the product reads from the queries
 * defined here, so "how many unread?" and "which critical alerts are still
 * outstanding?" each have exactly one answer per department instead of one per
 * component. Departments differ only in which axios client and cache scope they
 * pass in -- the rules are identical.
 *
 * Deliberately built on the existing TanStack Query setup rather than a second
 * fetching mechanism, and deliberately socket-driven: the 30-second polls the
 * sidebars used to run are kept only as a slow safety net for a dropped socket.
 */

export type NotifScope = "admin" | "sched" | "tech";

export interface UnreadCounts {
  total: number;
  byType: Record<string, number>;
}

export interface NotificationRow {
  id: string;
  /** Plain default-language (Arabic) display text -- see resolveNotificationText. */
  title: string;
  body: string;
  /** Optional English counterparts; absent on every pre-Phase-2 row. */
  titleEn?: string | null;
  bodyEn?: string | null;
  type: string;
  severity: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * Cache keys.
 *
 * The unread key keeps the exact string the three Sidebars and Notifications
 * pages already invalidate (`notif-unread-tech`, ...), so no existing
 * invalidation silently stops working. Only the SHAPE behind it changed, from a
 * bare number to the server's `{ total, byType }` -- and nothing
 * outside this module ever read that number directly.
 */
export const notifUnreadKey = (scope: NotifScope) => [`notif-unread-${scope}`];
export const notifCriticalKey = (scope: NotifScope) => [`notif-critical-${scope}`];

const EMPTY_COUNTS: UnreadCounts = { total: 0, byType: {} };

/**
 * Unread counts for the navigation badges.
 *
 * One request returns the total AND the per-type breakdown, which is what lets
 * several badges on different destinations be driven without a request each.
 * This replaces fetching up to 50 full notification rows on a timer purely to
 * call `.filter(n => !n.isRead).length` in the browser.
 */
export function useUnreadCounts(api: AxiosInstance, scope: NotifScope) {
  return useQuery<UnreadCounts>({
    queryKey: notifUnreadKey(scope),
    queryFn: () =>
      api.get("/notifications/unread-count").then((r) => ({
        total: Number(r.data?.data?.total) || 0,
        // Tolerated as absent so a client running against an older backend
        // still renders badges instead of crashing.
        byType: r.data?.data?.byType || {},
      })),
    refetchInterval: 30000,
    initialData: EMPTY_COUNTS,
  });
}

/**
 * The unread CRITICAL notifications, newest first -- the queue behind the
 * centred alert and the technician urgent banner.
 *
 * Filtered server-side. Filtering client-side would be wrong, not merely
 * wasteful: the list endpoint returns the newest 50 rows, and the reminder cron
 * writes an INFO row per user per appointment, so a genuinely critical alert
 * older than 50 unread reminders would never be surfaced at all.
 */
export function useUnreadCritical(api: AxiosInstance, scope: NotifScope) {
  return useQuery<NotificationRow[]>({
    queryKey: notifCriticalKey(scope),
    queryFn: () =>
      api.get("/notifications", { params: { unread: "true", severity: "CRITICAL" } }).then((r) => r.data?.data || []),
    refetchInterval: 60000,
    initialData: [],
  });
}

/**
 * Acknowledge one notification.
 *
 * The server is the authority on read state: this only reports success once the
 * PATCH has actually succeeded, and it refreshes from the server rather than
 * optimistically rewriting the cache. That is deliberate -- an alert that
 * silently "disappeared" on a failed write would be a critical alert the
 * operator believes they have dealt with and never sees again.
 */
export function useMarkNotificationRead(api: AxiosInstance, scope: NotifScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`).then((r) => r.data?.data),
    onSuccess: () => invalidateNotifications(qc, scope),
  });
}

/** Refreshes every notification-derived surface for one department. */
export function invalidateNotifications(qc: ReturnType<typeof useQueryClient>, scope: NotifScope) {
  qc.invalidateQueries({ queryKey: notifUnreadKey(scope) });
  qc.invalidateQueries({ queryKey: notifCriticalKey(scope) });
  // The department's own Notifications list page, where one exists.
  qc.invalidateQueries({ queryKey: [`notifications-${scope}`] });
}

/**
 * Keeps every notification surface live.
 *
 * `notification:new` arrives only in the recipient's own per-user room, and
 * `notification:read` only in their own room too -- so a second device
 * belonging to the same person drops its badge and closes its alert when the
 * first one acknowledges. Both simply invalidate: the server stays the single
 * source of truth for counts and read state, and no client-side counter can
 * drift away from it.
 *
 * Takes a `getSocket` accessor rather than a socket, and retries until one
 * exists. The department socket hooks store the connection in a module-level
 * singleton assigned inside an effect, so a component that merely reads it
 * during render can be mounted before the connection exists and would never
 * re-render to notice it arriving. This is the same attach-and-retry approach
 * `NotificationBar` already uses for the same reason.
 */
export function useNotificationRealtime(getSocket: () => Socket | null, scope: NotifScope) {
  const qc = useQueryClient();
  useEffect(() => {
    let detach: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => invalidateNotifications(qc, scope);

    const attach = () => {
      const s = getSocket();
      if (!s || detach) return;
      s.on("notification:new", refresh);
      s.on("notification:read", refresh);
      detach = () => {
        s.off("notification:new", refresh);
        s.off("notification:read", refresh);
      };
      if (timer) { clearInterval(timer); timer = null; }
      // A socket that connects after a period offline may have missed events,
      // so re-read counts once on attach rather than trusting the last render.
      refresh();
    };

    attach();
    if (!detach) timer = setInterval(attach, 500);
    return () => {
      if (timer) clearInterval(timer);
      if (detach) detach();
    };
  }, [getSocket, qc, scope]);
}
