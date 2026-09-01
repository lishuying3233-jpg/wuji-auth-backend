import { describe, expect, it } from "vitest";

describe("Telegram credentials", () => {
  it("accepts the optional server-side bot token without exposing it", () => {
    const token = process.env.TG_BOT_TOKEN?.trim();
    if (!token) return;

    expect(token).toMatch(/^[^:\s]+:[A-Za-z0-9_-]+$/);
  });

  const liveTestEnabled = process.env.RUN_TELEGRAM_LIVE_TESTS === "1";
  (liveTestEnabled ? it : it.skip)("validates the configured bot token with getMe", async () => {
    const token = process.env.TG_BOT_TOKEN;
    expect(token, "TG_BOT_TOKEN must be configured for live test").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await response.json() as { ok?: boolean; result?: { is_bot?: boolean } };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
  }, 15000);
});

export {};
