import { NextRequest, NextResponse } from "next/server";
import {
  hasValidVaultSession,
  rotateVaultPassword,
  VAULT_SESSION_COOKIE,
  VaultControlConfigurationError,
} from "@/lib/vault-control";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function signedIn(request: NextRequest): boolean {
  return hasValidVaultSession(request.cookies.get(VAULT_SESSION_COOKIE)?.value);
}

export async function POST(request: NextRequest) {
  if (!signedIn(request)) {
    return NextResponse.json({ error: "Vault sign-in required." }, { status: 401, headers: noStore });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site password changes are blocked." }, { status: 403, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter and confirm a new password." }, { status: 400, headers: noStore });
  }
  const entry = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const password = typeof entry?.password === "string" ? entry.password : null;
  const confirmation = typeof entry?.confirmation === "string" ? entry.confirmation : null;
  if (!password || password !== confirmation) {
    return NextResponse.json({ error: "The new passwords do not match." }, { status: 400, headers: noStore });
  }

  try {
    await rotateVaultPassword(password);
    return NextResponse.json({ changed: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof VaultControlConfigurationError) {
      return NextResponse.json({ error: "Vault password rotation is not configured yet." }, { status: 503, headers: noStore });
    }
    const message = error instanceof Error ? error.message : "Password rotation could not be completed.";
    return NextResponse.json({ error: message }, { status: 400, headers: noStore });
  }
}
