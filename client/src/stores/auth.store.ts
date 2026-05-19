import { create } from 'zustand';
import { setAccessToken } from '../api/http';
import type { AuthResult, AuthUser } from '../api/auth.api';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  setSession: (result: AuthResult) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  isAuthenticated: false,
  setSession: (result) => {
    const expiresAt = Date.now() + result.expiresInSeconds * 1000;
    setAccessToken(result.accessToken);
    set({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
      isAuthenticated: true,
    });
  },
  clearSession: () => {
    setAccessToken(null);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: false,
    });
  },
}));
