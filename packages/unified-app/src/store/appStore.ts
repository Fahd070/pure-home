import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// For the web build (packages/web, deployed as a static site on Render/Vercel),
// VITE_API_URL is inlined by Vite at build time and is the actual source of
// truth -- render.yaml already declares it. For the Electron desktop app,
// there is no build-time VITE_API_URL configured (each employee's PC can
// point at a different backend at runtime via Settings -> Server Setup,
// which calls setServerUrl() and persists the override to localStorage) --
// this constant is only ever that build's *initial* default, never a hard
// requirement, so the fallback below is intentional and safe in both cases.
const RENDER_URL = import.meta.env.VITE_API_URL || "https://wfm-system.onrender.com";

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
      version: 4,
      migrate: (state: any, version: number) => {
        if (version < 4) {
          // Ensure all installs use the shared backend; clear stale tokens
          state.serverUrl = RENDER_URL;
          state.adminAuth = null;
          state.schedulingAuth = null;
          state.technicianAuth = null;
        }
        return state;
      },
    }
  )
);