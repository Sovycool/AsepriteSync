"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authApi, type LoginResult } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** True while the initial refresh check is running. */
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// SessionStorage helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "auth_session";

function saveSession(user: AuthUser, accessToken: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, accessToken }));
  } catch {
    // sessionStorage unavailable (e.g. private mode restriction)
  }
}

function loadSession(): Pick<AuthState, "user" | "accessToken"> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Pick<AuthState, "user" | "accessToken">;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// JWT exp decoder (no library needed)
// ---------------------------------------------------------------------------

function getTokenExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof decoded.exp !== "number") return null;
    return decoded.exp * 1000;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

function fromLoginResult(result: LoginResult): Pick<AuthState, "user" | "accessToken"> {
  return { user: result.user, accessToken: result.accessToken };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seed state from sessionStorage immediately to avoid loading flash on F5
  const cached = typeof window !== "undefined" ? loadSession() : null;

  const [state, setState] = useState<AuthState>({
    user: cached?.user ?? null,
    accessToken: cached?.accessToken ?? null,
    loading: true,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback((token: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const expMs = getTokenExpMs(token);
    if (!expMs) return;

    // Refresh 60 s before expiry, or immediately if already past that point
    const delay = Math.max(expMs - Date.now() - 60_000, 0);

    refreshTimerRef.current = setTimeout(() => {
      authApi
        .refresh()
        .then((result) => {
          const session = fromLoginResult(result);
          setState((s) => ({ ...s, ...session }));
          if (session.user && session.accessToken) {
            saveSession(session.user, session.accessToken);
            scheduleRefresh(session.accessToken);
          }
        })
        .catch(() => {
          // Refresh cookie expired — sign the user out silently
          clearSession();
          setState({ user: null, accessToken: null, loading: false });
        });
    }, delay);
  }, []);

  // On mount: validate session against the server (rotates the refresh cookie)
  useEffect(() => {
    authApi
      .refresh()
      .then((result) => {
        const session = fromLoginResult(result);
        if (session.user && session.accessToken) {
          saveSession(session.user, session.accessToken);
          scheduleRefresh(session.accessToken);
        }
        setState({ ...session, loading: false });
      })
      .catch(() => {
        clearSession();
        setState({ user: null, accessToken: null, loading: false });
      });

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    const session = fromLoginResult(result);
    if (session.user && session.accessToken) {
      saveSession(session.user, session.accessToken);
      scheduleRefresh(session.accessToken);
    }
    setState({ ...session, loading: false });
  }, [scheduleRefresh]);

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      await authApi.register(username, email, password);
    },
    [],
  );

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    await authApi.logout().catch(() => undefined);
    clearSession();
    setState({ user: null, accessToken: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
