import { create } from 'zustand';
import { rawApi } from '@/lib/api';

export type User = {
  id: number;
  email: string;
  username: string;
  display_name: string;
  phone: string | null;
  real_name: string | null;
  student_id: string | null;
  github_id: string | null;
  github_name: string | null;
  user_group: 'super_admin' | 'admin' | 'teacher' | 'server_manager' | 'user';
  avatar_hash: string | null;
  email_verified: boolean;
  is_banned: boolean;
  banned_until: number | null;
};

type State = {
  user: User | null;
  loading: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  logout: () => void;
};

export const useUserStore = create<State>((set, get) => ({
  user: null,
  loading: false,
  loaded: false,
  hydrate: async () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('vustb_token');
    if (!token) {
      set({ user: null, loading: false, loaded: true });
      return;
    }
    set({ loading: true });
    try {
      const r = await rawApi.get<User>('/api/me');
      set({ user: r.data, loading: false, loaded: true });
    } catch {
      localStorage.removeItem('vustb_token');
      set({ user: null, loading: false, loaded: true });
    }
  },
  setToken: async (token: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('vustb_token', token);
    // Force fresh fetch even if a previous hydrate is in-flight by resetting flags.
    set({ user: null, loaded: false, loading: false });
    await get().hydrate();
  },
  logout: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('vustb_token');
    set({ user: null, loaded: true });
  },
}));
