import { useAppStore } from "../../store/appStore";

/**
 * Deliberately has NO `logout`. Ending a session clears every department's
 * token, socket and cached data at once -- see src/session.ts. A
 * department-scoped logout here would leave another slot authenticated and
 * let the Department Selector walk straight into that workspace without
 * code entry. Use useLogout() for the button, endApplicationSession()
 * everywhere else.
 */
export function useAuthStore() {
  const store = useAppStore();
  return {
    user: store.technicianAuth?.user ?? null,
    token: store.technicianAuth?.token ?? null,
    serverUrl: store.serverUrl,
    login: (user: any, token: string) => store.setTechnicianAuth(user, token),
  };
}
export const getAuthState = () => {
  const s = useAppStore.getState();
  return { token: s.technicianAuth?.token ?? null, serverUrl: s.serverUrl };
};