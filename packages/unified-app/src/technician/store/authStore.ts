import { useAppStore } from "../../store/appStore";

export function useAuthStore() {
  const store = useAppStore();
  return {
    user: store.technicianAuth?.user ?? null,
    token: store.technicianAuth?.token ?? null,
    serverUrl: store.serverUrl,
    login: (user: any, token: string) => store.setTechnicianAuth(user, token),
    logout: () => store.clearTechnicianAuth(),
  };
}
export const getAuthState = () => {
  const s = useAppStore.getState();
  return { token: s.technicianAuth?.token ?? null, serverUrl: s.serverUrl };
};