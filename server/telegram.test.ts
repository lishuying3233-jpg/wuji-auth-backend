import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendTelegramMessage, TG_TEMPLATES } from "./telegram";

describe("Telegram Notifications", () => {
  beforeEach(() => {
    vi.stubEnv("TG_BOT_TOKEN", "MOCK_TOKEN");
    vi.stubEnv("TG_CHAT_ID", "MOCK_CHAT_ID");
    vi.clearAllMocks();
  });

  it("should format order created message correctly", () => {
    const order = {
      planName: "月卡",
      durationDays: 30,
      amount: "5.88",
      network: "TRC20",
      machineId: "HWID123",
      txHash: "HASH123"
    };
    const message = TG_TEMPLATES.orderCreated(order);
    expect(message).toContain("新订单提醒");
    expect(message).toContain("5.88 USDT");
    expect(message).toContain("HWID123");
  });

  it("should format order verified message correctly", () => {
    const order = { id: 123, machineId: "HWID123" };
    const code = "CODE-123";
    const message = TG_TEMPLATES.orderVerified(order, code);
    expect(message).toContain("支付核验通过");
    expect(message).toContain("#123");
    expect(message).toContain("CODE-123");
  });

  it("escapes user-controlled fields before HTML delivery", () => {
    const message = TG_TEMPLATES.orderFailed(
      { id: 1, machineId: "<HWID>", amount: "1.99" },
      "<script>alert(1)</script>"
    );
    expect(message).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(message).not.toContain("<script>alert(1)</script>");
  });

  it("should call telegram API when sending message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    });
    vi.stubGlobal("fetch", mockFetch);

    await sendTelegramMessage("Test Message");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("botMOCK_TOKEN/sendMessage"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Test Message")
      })
    );
  });
});
