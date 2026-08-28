import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE,
  requirePrivateCreationAssetV2CredentialRead,
} from "./vaultAuth";

const R2_ENDPOINT_KEY = "R2_ENDPOINT";
const R2_ACCESS_KEY_ID_KEY = "R2_ACCESS_KEY_ID";
const R2_SECRET_ACCESS_KEY_KEY = "R2_SECRET_ACCESS_KEY";
const R2_SESSION_TOKEN_KEY = "R2_SESSION_TOKEN";
const REQUIRED_R2_KEYS = [
  R2_ENDPOINT_KEY,
  R2_ACCESS_KEY_ID_KEY,
  R2_SECRET_ACCESS_KEY_KEY,
] as const;
const ALLOWED_R2_KEYS = [...REQUIRED_R2_KEYS, R2_SESSION_TOKEN_KEY] as const;
const R2_ENDPOINT_HOST = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/;
const MAX_R2_CREDENTIAL_CHARS = 1024;

type R2CredentialKey = (typeof ALLOWED_R2_KEYS)[number];

function assertR2CredentialValue(value: string, keyName: R2CredentialKey): string {
  if (value.length === 0 || value.length > MAX_R2_CREDENTIAL_CHARS) {
    throw new Error(`Invalid ${keyName} credential`);
  }
  return value;
}

function canonicalR2Endpoint(value: string): string {
  assertR2CredentialValue(value, R2_ENDPOINT_KEY);
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    !R2_ENDPOINT_HOST.test(endpoint.hostname)
  ) {
    throw new Error("R2_ENDPOINT must be an approved Cloudflare R2 HTTPS endpoint");
  }

  return endpoint.origin;
}

function exactR2CredentialRows(rows: Array<{ keyName: string; value: string }>) {
  if (rows.length < REQUIRED_R2_KEYS.length || rows.length > ALLOWED_R2_KEYS.length) {
    throw new Error("Private creation asset V2 credentials require only the fixed R2 keys");
  }

  const values = new Map(rows.map((row) => [row.keyName, row.value]));
  if (
    values.size !== rows.length ||
    rows.some((row) => !ALLOWED_R2_KEYS.includes(row.keyName as R2CredentialKey)) ||
    REQUIRED_R2_KEYS.some((keyName) => !values.has(keyName))
  ) {
    throw new Error("Private creation asset V2 credentials require only the fixed R2 keys");
  }

  const secrets: {
    R2_ENDPOINT: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_SESSION_TOKEN?: string;
  } = {
    R2_ENDPOINT: canonicalR2Endpoint(values.get(R2_ENDPOINT_KEY)!),
    R2_ACCESS_KEY_ID: assertR2CredentialValue(values.get(R2_ACCESS_KEY_ID_KEY)!, R2_ACCESS_KEY_ID_KEY),
    R2_SECRET_ACCESS_KEY: assertR2CredentialValue(values.get(R2_SECRET_ACCESS_KEY_KEY)!, R2_SECRET_ACCESS_KEY_KEY),
  };
  const sessionToken = values.get(R2_SESSION_TOKEN_KEY);
  if (sessionToken !== undefined) {
    secrets.R2_SESSION_TOKEN = assertR2CredentialValue(sessionToken, R2_SESSION_TOKEN_KEY);
  }

  return {
    service: PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE,
    secrets,
  };
}

/**
 * Fixed, read-only V2 vault capability. Convex wraps the return value in its
 * standard `{ status: "success", value }` HTTP envelope. The inner value has
 * no caller-selected service/key and exposes only the fixed service marker and
 * allowlisted R2 credentials; the V2 bucket is pinned locally by Jarvis.
 */
export const credentials = query({
  args: { v2VaultToken: v.string() },
  handler: async (ctx, { v2VaultToken }) => {
    await requirePrivateCreationAssetV2CredentialRead(ctx, { vaultToken: v2VaultToken });
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", PRIVATE_CREATION_ASSET_V2_VAULT_SERVICE))
      .collect();
    return exactR2CredentialRows(rows);
  },
});
