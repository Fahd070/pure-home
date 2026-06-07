import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const RENDER_URL = "https://wfm-system.onrender.com";

export interface AuthUser { id: string; name: string; email: string; role: string; }
interface DeptAuth { user: AuthUser; token: string; }

interface AppStore {
  serverUrl: string;
  adminAuth: DeptAuth | null;
  schedulingAuth: DeptAuth | null;
  technicianAuth: DeptAuth | null;
  adminLoginTime: number;
  schedulingLoginTime: number;
  technicianLoginTime: number;
  setServerUrl: (url: string) => void;
  setAdminAuth: (user: AuthUser, token: string) => void;
  setSchedulingAuth: (user: AuthUser, token: string) => void;
  setTechnicianAuth: (user: AuthUser, token: string) => void;
  clearAdminAuth: () => void;
  clearSchedulingAuth: () => void;
  clearTechnicianAuth: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      serverUrl: RENDER_URL,
      adminAuth: null, schedulingAuth: null, technicianAuth: null,
      adminLoginTime: 0, schedulingLoginTime: 0, technicianLoginTime: 0,
      setServerUrl: (serverUrl) => set({ serverUrl }),
      setAdminAuth: (user, token) => set({ adminAuth: { user, token }, adminLoginTime: Date.now() }),
      setSchedulingAuth: (user, token) => set({ schedulingAuth: { user, token }, schedulingLoginTime: Date.now() }),
      setTechnicianAuth: (user, token) => set({ technicianAuth: { user, token }, technicianLoginTime: Date.now() }),
      clearAdminAuth: () => set({ adminAuth: null }),
      clearSchedulingAuth: () => set({ schedulingAuth: null }),
      clearTechnicianAuth: () => set({ technicianAuth: null }),
    }),
    {
      name: "wfm-unified",
      version: 2,
      migrate: (state: any, version: number) => {
        if (version < 2) {
          // Migrate existing installs from local/Tailscale URL to Render
          state.serverUrl = RENDER_URL;
        }
        return state;
      },
    }
  )
);