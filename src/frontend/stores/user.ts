import { create } from 'zustand';
import { api } from '@/lib/api';

export type User = {
  id: number;
  email: string;
  username: string;
  user_group: 'super_admin' | 'admin' | 'teacher' | 'user';
  avatar_hash: string | null;
  email_verified: boolean;
};

type State = {
  user: User | null;
  loading: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setToken: (token: string) => void;
  logout: () => void;
};

export const useUserStore = create<State>((set, get) => ({
  user: null,
  loading: false,
  loaded: false,
  hydrate: async () => {
    if (get().loading) return;
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('vustb_token');
    if (!token) {
      set({ loaded: true });
      return;
    }
    set({ loading: true });
    try {
      const r = await api.get<User>('/users/me');
      set({ user: r.data, loading: false, loaded: true });
    } catch {
      localStorage.removeItem('vustb_token');
      set({ user: null, loading: false, loaded: true });
    }
  },
  setToken: (token: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('vustb_token', token);
    get().hydrate();
  },
  logout: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('vustb_token');
    set({ user: null, loaded: true });
  },
}));
