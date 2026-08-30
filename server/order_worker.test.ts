import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPendingOrders } from "./order_worker";
import * as db from "./db";
import * as blockchain from "./blockchain";

vi.mock("./db");
vi.mock("./blockchain");
vi.mock("./telegram", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(undefined),
  TG_TEMPLATES: {
    orderVerified: () => "verified",
    orderFailed: () => "failed"
  }
}));

describe("OrderWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should process pending orders and create activation codes on success", async () => {
    const mockOrder = {
      id: 1,
      machineId: "TEST-MACHINE-A306",
      planName: "月卡",
      durationDays: 30,
      amount: "5.88",
      network: "TRC20",
      txHash: "MOCK_HASH",
      status: "pending"
    };

    const mockSetting = {
      network: "TRC20",
      address: "T_MOCK_ADDRESS",
      status: "active"
    };

    vi.mocked(db.getPendingOrders).mockResolvedValue([mockOrder as any]);
    vi.mocked(db.claimPendingOrder).mockResolvedValue(true);
    vi.mocked(db.getPaymentSettings).mockResolvedValue([mockSetting as any]);
    vi.mocked(blockchain.verifyTransaction).mockResolvedValue({
      success: true,
      confirmed: true,
      message: "核验通过"
    });

    await processPendingOrders();

    // 验证是否创建了激活码
    expect(db.createActivationCode).toHaveBeenCalledWith(expect.objectContaining({
      durationDays: 30,
      machineId: "TEST-MACHINE-A306",
      note: expect.stringContaining("自动发码订单 #1")
    }));

    // 验证订单状态是否更新为已完成
    expect(db.updateOrderStatus).toHaveBeenCalledWith(1, "completed", expect.any(String));
  });

  it("should update error reason but stay pending if not confirmed", async () => {
    const mockOrder = {
      id: 2,
      machineId: "TEST-MID",
      amount: "1.99",
      network: "ERC20",
      txHash: "HASH_2",
      status: "pending"
    };

    vi.mocked(db.getPendingOrders).mockResolvedValue([mockOrder as any]);
    vi.mocked(db.claimPendingOrder).mockResolvedValue(true);
    vi.mocked(db.getPaymentSettings).mockResolvedValue([{ network: "ERC20", address: "0x_ADDR", status: "active" } as any]);
    vi.mocked(blockchain.verifyTransaction).mockResolvedValue({
      success: false,
      confirmed: false,
      message: "确认数不足 (1/2)"
    });

    await processPendingOrders();

    expect(db.createActivationCode).not.toHaveBeenCalled();
    expect(db.updateOrderStatus).toHaveBeenCalledWith(2, "pending", undefined, "确认数不足 (1/2)");
  });

  it("should mark as failed if verification fails definitively", async () => {
    const mockOrder = {
      id: 3,
      machineId: "TEST-MID",
      amount: "1.99",
      network: "TRC20",
      txHash: "BAD_HASH",
      status: "pending"
    };

    vi.mocked(db.getPendingOrders).mockResolvedValue([mockOrder as any]);
    vi.mocked(db.claimPendingOrder).mockResolvedValue(true);
    vi.mocked(db.getPaymentSettings).mockResolvedValue([{ network: "TRC20", address: "T_ADDR", status: "active" } as any]);
    vi.mocked(blockchain.verifyTransaction).mockResolvedValue({
      success: false,
      message: "金额不匹配: 预期 1.99, 实际 0.01"
    });

    await processPendingOrders();

    expect(db.updateOrderStatus).toHaveBeenCalledWith(3, "failed", undefined, "金额不匹配: 预期 1.99, 实际 0.01");
  });
});
