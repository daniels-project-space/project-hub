import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptsVaultPassword,
  createVaultSession,
  hasValidVaultSession,
} from "./vault-control";

afterEach(() => vi.unstubAllEnvs());

describe("vault control session", () => {
  it("accepts only the configured password and rejects modified or expired sessions", async () => {
    vi.stubEnv("PROJECT_HUB_VAULT_PASSWORD", "test-owner-password");
    vi.stubEnv("PROJECT_HUB_VAULT_SESSION_SECRET", "test-session-secret-that-is-long-enough");

    await expect(acceptsVaultPassword("test-owner-password")).resolves.toBe(true);
    await expect(acceptsVaultPassword("wrong-password")).resolves.toBe(false);

    const now = Date.UTC(2030, 0, 1);
    const session = createVaultSession(now);
    expect(hasValidVaultSession(session, now + 1)).toBe(true);
    expect(hasValidVaultSession(`${session}x`, now + 1)).toBe(false);
    expect(hasValidVaultSession(session, now + 8 * 60 * 60 * 1000)).toBe(false);
  });
});
