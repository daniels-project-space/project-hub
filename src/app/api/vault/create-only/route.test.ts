import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mutation;
  },
}));

import { POST } from "./route";
import { createVaultSession, VAULT_SESSION_COOKIE } from "@/lib/vault-control";

const SESSION_SECRET = "s".repeat(48);

function request(body: unknown, options: { session?: string; origin?: string } = {}) {
  return new NextRequest("https://hub.example/api/vault/create-only", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? "https://hub.example",
      ...(options.session ? { cookie: `${VAULT_SESSION_COOKIE}=${options.session}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/vault/create-only", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://hub.example.convex.site");
    mutation.mockReset().mockResolvedValue({ created: true });
  });

  it("requires an owner session and same-origin write", async () => {
    const body = { service: "music-house", keyName: "RENDER_ENGINE_PROJECT_TOKEN", value: "a".repeat(64) };
    expect((await POST(request(body))).status).toBe(401);
    const session = createVaultSession();
    expect((await POST(request(body, { session, origin: "https://attacker.example" }))).status).toBe(403);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("always forwards the create-only flag to the Convex vault mutation", async () => {
    const session = createVaultSession();
    const body = {
      service: "music-house",
      keyName: "RENDER_ENGINE_PROJECT_TOKEN",
      value: "a".repeat(64),
      scopes: ["music-house", "render-engine"],
    };
    const response = await POST(request(body, { session }));
    expect(response.status).toBe(200);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][1]).toMatchObject({
      service: body.service,
      keyName: body.keyName,
      value: body.value,
      createOnly: true,
    });
  });
});
