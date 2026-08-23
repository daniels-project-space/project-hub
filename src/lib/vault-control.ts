import { createHmac, timingSafeEqual } from "node:crypto";

export const VAULT_SESSION_COOKIE = "project-hub-vault-session";
export const VAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export class VaultControlConfigurationError extends Error {
  constructor() {
    super("Vault control is not configured");
    this.name = "VaultControlConfigurationError";
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new VaultControlConfigurationError();
  return value;
}

function sessionSecret(): string {
  const value = requiredEnvironment("PROJECT_HUB_VAULT_SESSION_SECRET");
  if (Buffer.byteLength(value) < 32) throw new VaultControlConfigurationError();
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

export function acceptsVaultPassword(password: string): boolean {
  return constantTimeEqual(password, requiredEnvironment("PROJECT_HUB_VAULT_PASSWORD"));
}

export function createVaultSession(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ expiresAt: now + VAULT_SESSION_TTL_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function hasValidVaultSession(session: string | undefined, now = Date.now()): boolean {
  if (!session) return false;
  const [payload, signature, ...extra] = session.split(".");
  if (!payload || !signature || extra.length > 0 || !constantTimeEqual(signature, sign(payload))) return false;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded === "object"
      && decoded !== null
      && "expiresAt" in decoded
      && typeof decoded.expiresAt === "number"
      && Number.isFinite(decoded.expiresAt)
      && decoded.expiresAt > now;
  } catch {
    return false;
  }
}
