import { useAppStore } from "../../store/appStore";

export function useAuthStore() {
  const store = useAppStore();
  return {
    user: store.adminAuth?.user ?? null,
    token: store.adminAuth?.token ?? null,
    serverUrl: store.serverUrl,
    login: (user: any, token: string) => store.setAdminAuth(user, token),
    logout: () => store.clearAdminAuth(),
  };
}
export const getAuthState = () => {
  const s = useAppStore.getState();
  return { token: s.adminAuth?.token ?? null, serverUrl: s.serverUrl };
};