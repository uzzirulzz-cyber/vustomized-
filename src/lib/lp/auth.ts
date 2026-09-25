// Lead Pulse auth — JWT (HMAC-SHA256) + scrypt password hashing + RBAC.
// Zero external deps: uses node:crypto only.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

const JWT_SECRET = process.env.LP_JWT_SECRET || "lp-dev-secret-change-me";
export const ACCESS_TTL_SEC = 60 * 30; // 30 min
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export type Role = "super_admin" | "admin" | "manager" | "employee" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string | null;
  phone: string | null;
};

// ─── Passwords (scrypt) ───────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const candidate = scryptSync(password, salt, 64);
    return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

// ─── JWT (HS256) ──────────────────────────────────────────────────────────────

const b64u = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const b64uDecode = (str: string) =>
  Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");

type JwtPayload = { sub: string; typ: "access" | "refresh"; ver: number; iat: number; exp: number };

export function signToken(userId: string, typ: "access" | "refresh", ver: number, ttlSec: number): string {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { sub: userId, typ, ver, iat: now, exp: now + ttlSec };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, typ: "access" | "refresh"): JwtPayload | null {
  try {
    const [header, body, sig] = token.split(".");
    const expected = b64u(createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest());
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(b64uDecode(body).toString()) as JwtPayload;
    if (payload.typ !== typ) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Request auth ─────────────────────────────────────────────────────────────

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  let token: string | null = null;
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) token = authz.slice(7);
  if (!token) {
    const cookie = req.headers.get("cookie") || "";
    const m = cookie.match(/lp_refresh=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  // Accept the access token (SPA sends Bearer); the refresh cookie also works
  // for /api/lp/auth/refresh and page-ish GETs.
  const payload = verifyToken(token, "access") || verifyToken(token, "refresh");
  if (!payload) return null;
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "active") return null;
  if (user.refreshVer !== payload.ver) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    department: user.department,
    phone: user.phone,
  };
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

export const PERMISSIONS: Record<string, Role[]> = {
  "leads.read": ["super_admin", "admin", "manager", "employee", "viewer"],
  "leads.write": ["super_admin", "admin", "manager", "employee"],
  "leads.assign": ["super_admin", "admin", "manager"],
  "leads.bulk": ["super_admin", "admin", "manager"],
  "leads.delete": ["super_admin", "admin"],
  "import.run": ["super_admin", "admin", "manager", "employee"],
  "conversations.read": ["super_admin", "admin", "manager", "employee", "viewer"],
  "conversations.send": ["super_admin", "admin", "manager", "employee"],
  "calls.write": ["super_admin", "admin", "manager", "employee"],
  "campaigns.read": ["super_admin", "admin", "manager", "employee", "viewer"],
  "campaigns.manage": ["super_admin", "admin", "manager"],
  "templates.read": ["super_admin", "admin", "manager", "employee", "viewer"],
  "templates.manage": ["super_admin", "admin", "manager"],
  "templates.approve": ["super_admin", "admin"],
  "followups.write": ["super_admin", "admin", "manager", "employee"],
  "employees.read": ["super_admin", "admin", "manager"],
  "employees.manage": ["super_admin", "admin"],
  "analytics.read": ["super_admin", "admin", "manager", "viewer"],
  "integrations.read": ["super_admin", "admin"],
  "integrations.manage": ["super_admin"],
  "compliance.manage": ["super_admin", "admin"],
  "audit.read": ["super_admin", "admin"],
};

export function can(role: Role | undefined, perm: keyof typeof PERMISSIONS | string): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[perm as string];
  return Boolean(allowed?.includes(role));
}
