import { describe, it, expect } from "vitest";

describe("Telegram credentials", () => {
  it("validates the configured bot token with getMe", async () => {
    const token = process.env.TG_BOT_TOKEN;
    expect(token, "TG_BOT_TOKEN must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await response.json() as { ok?: boolean; result?: { is_bot?: boolean } };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
  }, 15000);
});
