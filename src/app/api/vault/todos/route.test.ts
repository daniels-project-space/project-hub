import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultSession, VAULT_SESSION_COOKIE } from "@/lib/vault-control";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

import { GET, POST } from "./route";

const SESSION_SECRET = "s".repeat(48);

function ownerRequest(
  path: string,
  init: RequestInit = {},
): NextRequest {
  return new NextRequest(`https://project-hub.test${path}`, {
    ...init,
    headers: {
      cookie: `${VAULT_SESSION_COOKIE}=${createVaultSession()}`,
      ...init.headers,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://hub.convex.cloud");
  convex.query.mockReset();
  convex.mutation.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("owner Todo proxy", () => {
  it("rejects requests without the HttpOnly owner session before touching Convex", async () => {
    const response = await GET(new NextRequest("https://project-hub.test/api/vault/todos"));

    expect(response.status).toBe(401);
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("forwards a validated owner session server-side for a Todo read", async () => {
    convex.query.mockResolvedValue([{ _id: "todo-1", text: "private", done: false }]);

    const response = await GET(ownerRequest("/api/vault/todos"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      todos: [{ _id: "todo-1", text: "private", done: false }],
    });
    expect(convex.query).toHaveBeenCalledWith(expect.anything(), {
      vaultSession: expect.any(String),
    });
    expect(convex.query.mock.calls[0][1]).not.toHaveProperty("vaultToken");
  });

  it("blocks cross-site writes and caller-supplied privilege fields", async () => {
    const crossSite = await POST(ownerRequest(
      "/api/vault/todos",
      {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "blocked" }),
      },
    ));
    expect(crossSite.status).toBe(403);

    const injected = await POST(ownerRequest("/api/vault/todos", {
      method: "POST",
      headers: {
        origin: "https://project-hub.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "blocked", ownerId: "other-owner" }),
    }));
    expect(injected.status).toBe(400);
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
