import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createMediaEngineHandoff } from "./media-engine-handoff";

afterEach(() => vi.unstubAllEnvs());
it("mints a one-minute handoff bound to the fixed marketing audience with an independent secret", () => {
  const secret = "fixture-hub-media-secret-at-least-32-bytes",
    now = Date.now();
  vi.stubEnv("MEDIA_ENGINE_HUB_HANDOFF_SECRET", secret);
  const [version, expires, nonce, signature] =
    createMediaEngineHandoff(now).split(".");
  expect(version).toBe("hub1");
  expect(Number(expires)).toBe(Math.floor(now / 1000) + 60);
  expect(nonce).toMatch(/^[a-f0-9-]{36}$/);
  expect(signature).toBe(
    createHmac("sha256", secret)
      .update(`project-hub:media-engine:/marketing:${expires}:${nonce}`)
      .digest("base64url"),
  );
  expect(createMediaEngineHandoff(now)).not.toContain(nonce);
  vi.stubEnv("MEDIA_ENGINE_HUB_HANDOFF_SECRET", "");
  expect(() => createMediaEngineHandoff()).toThrow(/not configured/);
});
