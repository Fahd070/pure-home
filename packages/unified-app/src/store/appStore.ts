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
//
// Named separately from RENDER_URL (rather than only using the literal
// inline) so the v4->v5 store migration below can target the exact old and
// new URLs regardless of what VITE_API_URL happens to be at migration time.
const OLD_OREGON_URL = "https://wfm-system.onrender.com";
const SINGAPORE_URL = "https://pure-home-singapore.onrender.com";
const RENDER_URL = import.meta.env.VITE_API_URL || SINGAPORE_URL;

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
      version: 5,
      migrate: (state: any, version: number) => {
        if (version < 4) {
          // Ensure all installs use the shared backend; clear stale tokens
          state.serverUrl = RENDER_URL;
          state.adminAuth = null;
          state.schedulingAuth = null;
          state.technicianAuth = null;
        }
        if (version < 5) {
          // Production backend moved from Render Oregon to Render Singapore
          // (closer to the Supabase Tokyo database). Only touch serverUrl if
          // it is exactly the old Oregon production URL -- never a custom
          // Server Setup URL, localhost, or an already-Singapore/other
          // value -- and never clear auth tokens for this migration alone.
          if (state.serverUrl === OLD_OREGON_URL) {
            state.serverUrl = SINGAPORE_URL;
          }
        }
        return state;
      },
    }
  )
);