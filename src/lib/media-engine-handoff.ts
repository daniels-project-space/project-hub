import { createHmac, randomUUID } from "node:crypto";

export function createMediaEngineHandoff(now = Date.now()): string {
  const secret = process.env.MEDIA_ENGINE_HUB_HANDOFF_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Media Engine access is not configured");
  const expires = Math.floor(now / 1000) + 60,
    nonce = randomUUID();
  const signature = createHmac("sha256", secret)
    .update(`project-hub:media-engine:/marketing:${expires}:${nonce}`)
    .digest("base64url");
  return `hub1.${expires}.${nonce}.${signature}`;
}
