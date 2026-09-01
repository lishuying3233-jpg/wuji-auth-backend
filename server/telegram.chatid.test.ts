import { describe, expect, it } from "vitest";

describe("Telegram chat configuration", () => {
  it("accepts a numeric Telegram chat ID without making a network request", () => {
    const chatId = process.env.TG_CHAT_ID?.trim();
    if (!chatId) return;

    expect(chatId).toMatch(/^-?\d+$/);
  });

  const liveTestEnabled = process.env.RUN_TELEGRAM_LIVE_TESTS === "1";
  (liveTestEnabled ? it : it.skip)("validates the configured chat ID with getChat", async () => {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    expect(token, "TG_BOT_TOKEN must be configured for live test").toBeTruthy();
    expect(chatId, "TG_CHAT_ID must be configured for live test").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId!)}`);
    const body = await response.json() as { ok?: boolean; result?: { id?: number | string } };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(String(body.result?.id)).toBe(String(chatId));
  }, 15000);
});

export {};
