import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser { id: string; name: string; email: string; role: string; }
interface AuthState {
  user: AuthUser | null; token: string | null; serverUrl: string;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  setServerUrl: (url: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null, token: null, serverUrl: 'http://localhost:3001',
      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
      setServerUrl: (serverUrl) => set({ serverUrl }),
    }),
    { name: 'wfm-technician-auth' }
  )
);
