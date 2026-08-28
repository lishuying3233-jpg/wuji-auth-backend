import { describe, it, expect } from "vitest";

describe("Telegram chat configuration", () => {
  it("validates the configured chat ID with getChat", async () => {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    expect(token, "TG_BOT_TOKEN must be configured").toBeTruthy();
    expect(chatId, "TG_CHAT_ID must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId!)}`);
    const body = await response.json() as { ok?: boolean; result?: { id?: number | string } };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(String(body.result?.id)).toBe(String(chatId));
  }, 15000);
});
