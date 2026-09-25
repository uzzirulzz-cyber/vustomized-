import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const SECRET = process.env.AUTH_SECRET || "playbeat-admin-dev-secret-change-me";
export const STAFF_COOKIE = "pb_session";
export const CUSTOMER_COOKIE = "pb_customer";

export type SessionPayload = {
  id: string;
  email: string;
  name: string;
  kind: "staff" | "customer";
  exp: number; // epoch ms
};

// ── passwords ──────────────────────────────────────────────────────────────
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const candidate = scryptSync(pw, salt, 64);
    const original = Buffer.from(hash, "hex");
    return candidate.length === original.length && timingSafeEqual(candidate, original);
  } catch {
    return false;
  }
}

// ── tokens ─────────────────────────────────────────────────────────────────
function b64u(s: Buffer | string): string {
  return Buffer.from(s).toString("base64url");
}

export function signToken(payload: SessionPayload): string {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function makeToken(kind: "staff" | "customer", id: string, email: string, name: string, days = 7): string {
  return signToken({ kind, id, email, name, exp: Date.now() + days * 86400_000 });
}

// ── sessions ───────────────────────────────────────────────────────────────
export async function setSessionCookie(kind: "staff" | "customer", token: string) {
  const jar = await cookies();
  jar.set(kind === "staff" ? STAFF_COOKIE : CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 7 * 86400,
  });
}

export async function clearSessionCookie(kind: "staff" | "customer") {
  const jar = await cookies();
  jar.set(kind === "staff" ? STAFF_COOKIE : CUSTOMER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export type StaffSession = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  role: { id: string; key: string; name: string; rank: number; permissions: string[] };
};

export async function getStaff(): Promise<StaffSession | null> {
  const jar = await cookies();
  const payload = verifyToken(jar.get(STAFF_COOKIE)?.value);
  if (!payload || payload.kind !== "staff") return null;
  const staff = await db.staffUser.findUnique({
    where: { id: payload.id },
    include: { role: { include: { permissions: true } } },
  });
  if (!staff || staff.status !== "ACTIVE") return null;
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    title: staff.title,
    role: {
      id: staff.role.id,
      key: staff.role.key,
      name: staff.role.name,
      rank: staff.role.rank,
      permissions: staff.role.permissions.map((p) => p.key),
    },
  };
}

export async function getCustomer() {
  const jar = await cookies();
  const payload = verifyToken(jar.get(CUSTOMER_COOKIE)?.value);
  if (!payload || payload.kind !== "customer") return null;
  const customer = await db.customer.findUnique({ where: { id: payload.id } });
  if (!customer || customer.status !== "ACTIVE") return null;
  return customer;
}

// ── API guards ─────────────────────────────────────────────────────────────
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

export const apiError = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

/**
 * Returns the authenticated staff member or throws a Response.
 * Usage: const staff = await requireStaff("orders.read") — the helper
 * returns either the session or a Response the caller should return.
 */
export async function requireStaff(permission?: string): Promise<StaffSession | Response> {
  const staff = await getStaff();
  if (!staff) return apiError("Unauthorized", 401);
  if (permission && !staff.role.permissions.includes(permission)) {
    return apiError("Forbidden — missing permission " + permission, 403);
  }
  return staff;
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

// ── audit trail ────────────────────────────────────────────────────────────
export async function audit(
  actor: { name: string; email: string },
  action: string,
  entity: string,
  detail: string,
  entityId?: string
) {
  await db.auditLog.create({
    data: { actorName: actor.name, actorEmail: actor.email, action, entity, entityId, detail },
  });
}
