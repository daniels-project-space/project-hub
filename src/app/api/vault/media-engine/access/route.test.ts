import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { createVaultSession, VAULT_SESSION_COOKIE } from "@/lib/vault-control";

afterEach(() => vi.unstubAllEnvs());
it("requires an owner session and same-origin POST before returning the fixed Media Engine destination", async () => {
  vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", "fixture-owner-session-secret-at-least-32-bytes");
  vi.stubEnv("MEDIA_ENGINE_HUB_HANDOFF_SECRET", "fixture-hub-handoff-secret-at-least-32-bytes");
  const origin = "https://project-hub.example", url = `${origin}/api/vault/media-engine/access`;
  expect((await POST(new NextRequest(url, { method: "POST", headers: { origin } }))).status).toBe(401);
  const cookie = `${VAULT_SESSION_COOKIE}=${createVaultSession()}`;
  expect((await POST(new NextRequest(url, { method: "POST", headers: { origin: "https://foreign.example", cookie } }))).status).toBe(403);
  const response = await POST(new NextRequest(url, { method: "POST", headers: { origin, cookie } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const destination = new URL((await response.json()).url);
  expect(destination.origin).toBe("https://media-engine-seven.vercel.app");
  expect(destination.pathname).toBe("/operator/access");
  expect(destination.search).toBe("");
  expect(destination.hash).toMatch(/^#handoff=hub1\./);
});
