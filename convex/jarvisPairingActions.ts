"use node";

import { ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

const JARVIS_PAIRING_ENDPOINT = "https://jarvis-orcin-six.vercel.app/api/auth/pairing/request";
type VaultSecret = { keyName: string; value: string };

export const requestLink = action({
  args: {},
  handler: async (ctx): Promise<{ ok: true; delivery: "telegram"; expiresAt: number }> => {
    const requestId = await ctx.runMutation(internal.jarvisPairing.claimRequest, {});
    try {
      const requestToken = process.env.JARVIS_PAIRING_REQUEST_TOKEN;
      const vaultToken = process.env.VAULT_ACCESS_TOKEN;
      if (!requestToken || !vaultToken) throw new Error("pairing_configuration");

      const pairingResponse = await fetch(JARVIS_PAIRING_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${requestToken}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!pairingResponse.ok) throw new Error(`jarvis_${pairingResponse.status}`);
      const pairing = await pairingResponse.json() as { url?: string; expiresAt?: number };
      if (!pairing.url || !pairing.expiresAt) throw new Error("jarvis_invalid_response");

      const rows = await ctx.runQuery(api.secrets.listByService, {
        service: "telegram",
        vaultToken,
      }) as VaultSecret[];
      const secrets = Object.fromEntries(rows.map((row) => [row.keyName, row.value]));
      const botToken = secrets.TELEGRAM_BOT_TOKEN;
      const chatId = secrets.TELEGRAM_OPERATOR_CHAT_ID
        ?? secrets.TELEGRAM_CHAT_ID_DANIEL
        ?? secrets.TELEGRAM_ADMIN_CHAT_ID;
      if (!botToken || !chatId) throw new Error("telegram_configuration");

      const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: [
            "🔐 <b>Jarvis browser trust</b>",
            "",
            "Open this on the browser you want to trust. It is one-use and expires in 10 minutes:",
            pairing.url,
          ].join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "Trust this browser", url: pairing.url }]],
          },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const telegram = await telegramResponse.json().catch(() => null) as { ok?: boolean } | null;
      if (!telegramResponse.ok || telegram?.ok !== true) throw new Error(`telegram_${telegramResponse.status}`);

      await ctx.runMutation(internal.jarvisPairing.finishRequest, {
        id: requestId,
        status: "delivered",
      });
      return { ok: true, delivery: "telegram", expiresAt: pairing.expiresAt };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "unknown";
      await ctx.runMutation(internal.jarvisPairing.finishRequest, {
        id: requestId,
        status: "failed",
        errorCode,
      });
      throw new ConvexError("Could not send the Jarvis trust link. Try again shortly.");
    }
  },
});
