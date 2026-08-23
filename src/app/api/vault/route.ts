import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import {
  hasValidVaultSession,
  VAULT_SESSION_COOKIE,
  VaultControlConfigurationError,
} from "@/lib/vault-control";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function unauthorized() {
  return NextResponse.json({ error: "Vault sign-in required." }, { status: 401, headers: noStore });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function isVaultEntry(value: unknown): value is {
  service: string;
  keyName: string;
  value: string;
  description?: string;
  scopes?: string[];
  aliases?: string[];
  sourceFiles?: string[];
} {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.service === "string"
    && typeof entry.keyName === "string"
    && typeof entry.value === "string"
    && (entry.description === undefined || typeof entry.description === "string")
    && [entry.scopes, entry.aliases, entry.sourceFiles].every(
      (items) => items === undefined || (Array.isArray(items) && items.every((item) => typeof item === "string")),
    );
}

function vaultClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new VaultControlConfigurationError();
  return new ConvexHttpClient(url);
}

function errorResponse(error: unknown) {
  if (error instanceof VaultControlConfigurationError) {
    return NextResponse.json({ error: "Vault control is not configured yet." }, { status: 503, headers: noStore });
  }
  return NextResponse.json({ error: "Vault operation could not be completed." }, { status: 400, headers: noStore });
}

function signedIn(request: NextRequest): string | undefined {
  const session = request.cookies.get(VAULT_SESSION_COOKIE)?.value;
  return hasValidVaultSession(session) ? session : undefined;
}

export async function GET(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  try {
    const entries = await vaultClient().query(api.secrets.catalog, { vaultSession });
    return NextResponse.json({ entries }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site vault writes are blocked." }, { status: 403, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid vault entry." }, { status: 400, headers: noStore });
  }
  if (!isVaultEntry(body)) {
    return NextResponse.json({ error: "Invalid vault entry." }, { status: 400, headers: noStore });
  }

  try {
    const entry = await vaultClient().mutation(api.secrets.upsertOne, {
      vaultSession,
      service: body.service,
      keyName: body.keyName,
      value: body.value,
      description: body.description,
      scopes: body.scopes ?? [],
      aliases: body.aliases ?? [],
      sourceFiles: body.sourceFiles ?? [],
    });
    return NextResponse.json(entry, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
