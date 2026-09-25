// Lead Pulse client API — JWT access token + transparent refresh on 401.
"use client";

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export type LpUser = {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "manager" | "employee" | "viewer";
  department?: string | null;
  phone?: string | null;
};

export function setToken(token: string | null) {
  accessToken = token;
}
export function getToken() {
  return accessToken;
}

async function refresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/lp/auth/refresh", { method: "POST" });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    scheduleRefresh(data.expiresIn);
    return true;
  } catch {
    return false;
  }
}

function scheduleRefresh(expiresIn: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), Math.max(30, (expiresIn - 60)) * 1000);
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...init } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  if (!skipAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res = await fetch(path, { ...init, headers, cache: "no-store" });
  if (res.status === 401 && !skipAuth && !path.includes("/auth/")) {
    const ok = await refresh();
    if (ok) {
      headers.Authorization = `Bearer ${accessToken}`;
      res = await fetch(path, { ...init, headers, cache: "no-store" });
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as any).error || `Request failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data as T;
}

export async function login(email: string, password: string): Promise<LpUser> {
  const data = await api<{ accessToken: string; user: LpUser }>("/api/lp/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
  accessToken = data.accessToken;
  scheduleRefresh(data.expiresIn);
  return data.user;
}

export async function logout() {
  try { await api("/api/lp/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  accessToken = null;
  if (refreshTimer) clearTimeout(refreshTimer);
}

/** Try to restore a session from the refresh cookie on page load. */
export async function tryRestore(): Promise<LpUser | null> {
  const ok = await refresh();
  if (!ok) return null;
  const me = await api<{ user: LpUser }>("/api/lp/auth/me");
  return me.user;
}
