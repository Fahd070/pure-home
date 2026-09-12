import { useAppStore } from "./store/appStore";
import { queryClient } from "./queryClient";
import { disconnectSocket as disconnectAdminSocket } from "./admin/hooks/useSocket";
import { disconnectSocket as disconnectSchedulingSocket } from "./scheduling/hooks/useSocket";
import { disconnectSocket as disconnectTechnicianSocket } from "./technician/hooks/useSocket";

export type Department = "admin" | "scheduling" | "technician";

type AppStoreState = ReturnType<typeof useAppStore.getState>;

/** Per-department teardown: the socket to drop, and the session slot to clear. */
const TEARDOWN: Record<Department, { disconnect: () => void; clearAuth: (s: AppStoreState) => void }> = {
  admin:      { disconnect: disconnectAdminSocket,      clearAuth: (s) => s.clearAdminAuth() },
  scheduling: { disconnect: disconnectSchedulingSocket, clearAuth: (s) => s.clearSchedulingAuth() },
  technician: { disconnect: disconnectTechnicianSocket, clearAuth: (s) => s.clearTechnicianAuth() },
};

const ALL_DEPARTMENTS = Object.keys(TEARDOWN) as Department[];

/**
 * v4 Requirement #13: ending the authenticated APPLICATION session.
 *
 * WHY THIS IS GLOBAL AND NOT PER-DEPARTMENT
 * -----------------------------------------
 * Auth is stored as three independent slots (admin / scheduling / technician),
 * so a device can hold a valid token for a department nobody is currently
 * looking at. Clearing only the visible one made Logout a lie:
 *
 *   technician signs in -> later someone signs into Administration on the same
 *   machine -> Logout from Administration -> Department Selector appears ->
 *   they press "Technicians" -> the stale technician token is still there, the
 *   route guard is satisfied, and the workspace opens WITHOUT code entry.
 *
 * On the shared shop-floor machines this product runs on, that is a bypass of
 * the code-entry screen, not a convenience. Leaving the workspace therefore
 * ends every department session on the device, not just the one on screen.
 *
 * The same reasoning applies to an automatic auth failure: a 401 also returns
 * the user to the Department Selector, so it must leave the device in the same
 * posture -- no department still silently authenticated behind the selector.
 * Both paths call this one function; there is no second teardown to drift.
 *
 * Navigation is NOT done here. Clearing the auth slots is enough: the route
 * guards in App.tsx observe the store and send an unauthenticated user to the
 * Department Selector on their own, which is what makes this safe to call from
 * an axios interceptor that has no router access.
 *
 * What is deliberately NOT cleared: device/UX preferences (theme, language,
 * density, interface scale) and the configured server URL. Those are not
 * user-scoped in this architecture. Ending a session is not wiping the device,
 * and this must never become "clear all localStorage".
 */
export function endApplicationSession(): void {
  // 1. Stop every authenticated socket first, so no further events for the
  //    outgoing user can arrive mid-teardown. destroySocket() is a no-op for a
  //    department that never connected, so this is safe to run unconditionally.
  for (const department of ALL_DEPARTMENTS) TEARDOWN[department].disconnect();

  // 2. Drop every session identity on the device. A token left in any slot is
  //    a token that still satisfies a route guard.
  const store = useAppStore.getState();
  for (const department of ALL_DEPARTMENTS) TEARDOWN[department].clearAuth(store);

  // 3. Cancel anything still in flight, then drop every cached result.
  //    Cancelling first matters: a request already on the wire would otherwise
  //    resolve afterwards carrying the previous user's data.
  queryClient.cancelQueries();
  queryClient.clear();
}
