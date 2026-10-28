import { NextRequest, NextResponse } from "next/server";
import {
  hasValidVaultSession,
  VAULT_SESSION_COOKIE,
} from "@/lib/vault-control";
import { createMediaEngineHandoff } from "@/lib/media-engine-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Same-origin request required" },
      { status: 403, headers },
    );
  try {
    if (!hasValidVaultSession(request.cookies.get(VAULT_SESSION_COOKIE)?.value))
      return NextResponse.json(
        { error: "Owner login required" },
        { status: 401, headers },
      );
    const handoff = createMediaEngineHandoff();
    // Fixed destination only. Never accept caller-supplied redirect URLs.
    return NextResponse.json(
      {
        url: `https://media-engine-seven.vercel.app/operator/access#handoff=${encodeURIComponent(handoff)}`,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Media Engine access is temporarily unavailable" },
      { status: 503, headers },
    );
  }
}
