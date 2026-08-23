import { createHmac, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export const VAULT_SESSION_COOKIE = "project-hub-vault-session";
export const VAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_SERVICE = "project-hub";
const PASSWORD_KEY = "PROJECT_HUB_VAULT_PASSWORD";

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

function runtimeVaultClient(): { client: ConvexHttpClient; token: string } | null {
  const token = process.env.PROJECT_HUB_VAULT_RUNTIME_TOKEN;
  if (!token) return null;
  const url = requiredEnvironment("NEXT_PUBLIC_CONVEX_URL");
  return { client: new ConvexHttpClient(url), token };
}

async function currentVaultPassword(): Promise<string> {
  const runtime = runtimeVaultClient();
  // The static value is a short-lived migration fallback only. Production uses
  // the least-privilege runtime client below, which enables an owner-initiated
  // rotation without publishing a general provider credential into this app.
  if (!runtime) return requiredEnvironment(PASSWORD_KEY);
  const record = await runtime.client.query(api.secrets.getOne, {
    vaultToken: runtime.token,
    service: PASSWORD_SERVICE,
    keyName: PASSWORD_KEY,
  });
  if (!record?.value) throw new VaultControlConfigurationError();
  return record.value;
}

export async function acceptsVaultPassword(password: string): Promise<boolean> {
  return constantTimeEqual(password, await currentVaultPassword());
}

export async function rotateVaultPassword(password: string): Promise<void> {
  if (password.length < 16 || Buffer.byteLength(password) > 1024) {
    throw new Error("Choose a password between 16 and 1,024 bytes.");
  }
  const runtime = runtimeVaultClient();
  if (!runtime) throw new VaultControlConfigurationError();
  await runtime.client.mutation(api.secrets.upsertOne, {
    vaultToken: runtime.token,
    service: PASSWORD_SERVICE,
    keyName: PASSWORD_KEY,
    value: password,
    description: "Project Hub owner vault-control password",
    scopes: [PASSWORD_SERVICE],
    aliases: [],
    sourceFiles: ["project-hub/vault-control"],
  });
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
