import { NextRequest, NextResponse } from "next/server";
import {
  acceptsVaultPassword,
  createVaultSession,
  VAULT_SESSION_COOKIE,
  VAULT_SESSION_TTL_SECONDS,
  VaultControlConfigurationError,
} from "@/lib/vault-control";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function invalidRequest() {
  return NextResponse.json({ error: "A password is required." }, { status: 400, headers: noStore });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  const password = typeof body === "object" && body !== null && "password" in body && typeof body.password === "string"
    ? body.password
    : null;
  if (!password) return invalidRequest();

  try {
    if (!acceptsVaultPassword(password)) {
      return NextResponse.json({ error: "The password is not valid." }, { status: 401, headers: noStore });
    }
    const response = NextResponse.json({ authenticated: true }, { headers: noStore });
    response.cookies.set({
      name: VAULT_SESSION_COOKIE,
      value: createVaultSession(),
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/vault",
      maxAge: VAULT_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof VaultControlConfigurationError) {
      return NextResponse.json({ error: "Vault control is not configured yet." }, { status: 503, headers: noStore });
    }
    return NextResponse.json({ error: "Vault access is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: noStore });
  response.cookies.set({
    name: VAULT_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/vault",
    maxAge: 0,
  });
  return response;
}
