import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * v4 Requirement #14: the one "sync now" action, shared by every department.
 *
 * WHAT IT DOES, AND WHY THAT SHAPE
 * --------------------------------
 * `invalidateQueries()` with no key marks EVERY cached query stale and, with
 * `refetchType: "active"`, refetches only the ones currently mounted. That is
 * exactly the requested semantic, and it is why there is no hand-maintained
 * list of query keys here: a list would have to be updated every time a screen
 * gains a query, and would be silently wrong the moment somebody forgot. The
 * screen the user is looking at reloads immediately; everything else reloads
 * the next time it is opened rather than firing a burst of requests for pages
 * nobody is on.
 *
 * It deliberately does NOT:
 *   * reload the window -- that would throw away the whole React tree, the
 *     current route, open filters, pagination and half-typed forms;
 *   * clear the cache -- `clear()` would blank every screen to a loading state
 *     instead of refreshing it in place;
 *   * mutate anything, or touch the router.
 *
 * It complements the Phase 2 realtime layer rather than replacing it: sockets
 * push changes as they happen, this is the manual pull for when a user wants to
 * be certain. No second socket, no polling loop, no parallel store.
 *
 * Unauthenticated screens are not affected because the button that calls this
 * lives inside AppFrame, which only renders behind a route guard; the
 * Department Selector's own health check is a bare axios call and is not a
 * React Query query at all.
 */
export function useGlobalRefresh() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Holds the in-flight refresh so repeated clicks join it instead of starting
  // another wave. A ref, not state, because the guard has to be correct
  // synchronously within a single click handler -- a state update would not
  // have landed yet on a fast double click.
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;

    setIsRefreshing(true);
    const run = queryClient
      .invalidateQueries({ refetchType: "active" })
      // The button reports "no longer refreshing", not "refresh succeeded":
      // a failed refetch surfaces through each screen's own error state, which
      // is where a partial failure can actually be described. Swallowing the
      // rejection here only stops it becoming an unhandled rejection -- it is
      // never reported as success.
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = null;
        setIsRefreshing(false);
      });

    inFlight.current = run;
    return run;
  }, [queryClient]);

  return { refresh, isRefreshing };
}
