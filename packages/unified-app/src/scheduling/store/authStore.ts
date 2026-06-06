import { useAppStore } from "../../store/appStore";

export function useAuthStore() {
  const store = useAppStore();
  return {
    user: store.schedulingAuth?.user ?? null,
    token: store.schedulingAuth?.token ?? null,
    serverUrl: store.serverUrl,
    login: (user: any, token: string) => store.setSchedulingAuth(user, token),
    logout: () => store.clearSchedulingAuth(),
  };
}
export const getAuthState = () => {
  const s = useAppStore.getState();
  return { token: s.schedulingAuth?.token ?? null, serverUrl: s.serverUrl };
};