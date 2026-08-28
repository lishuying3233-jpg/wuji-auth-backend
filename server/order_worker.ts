import * as db from "./db";
import { verifyTransaction } from "./blockchain";
import { sendTelegramMessage, TG_TEMPLATES } from "./telegram";

export async function processPendingOrders() {
  console.log(`[OrderWorker] Starting verification for pending orders...`);
  const orders = await db.getPendingOrders();
  if (orders.length === 0) return;

  const settings = await db.getPaymentSettings();
  const addressMap = new Map(settings.map(s => [`${s.network}`, s.address]));

  for (const order of orders) {
    if (!order.txHash) continue;

    const recipientAddress = addressMap.get(order.network);
    if (!recipientAddress) {
      console.warn(`[OrderWorker] No active address for network ${order.network}, skipping order #${order.id}`);
      continue;
    }

    try {
      const result = await verifyTransaction(
        order.network as "ERC20" | "TRC20",
        order.txHash,
        recipientAddress,
        order.amount
      );

      if (result.success && result.confirmed) {
        // 核验通过，自动发码
        const prefix = order.machineId.slice(-3).toUpperCase();
        const random = Math.random().toString(36).substring(2, 10).toUpperCase();
        const finalCode = `${prefix}-${random}`;

        await db.createActivationCode({
          code: finalCode,
          status: 'active',
          durationDays: order.durationDays,
          machineId: order.machineId, // 自动绑定
          note: `自动发码订单 #${order.id} (USDT ${order.amount} ${order.network})`
        });

        await db.updateOrderStatus(order.id, "completed", finalCode);
        void sendTelegramMessage(TG_TEMPLATES.orderVerified(order, finalCode));
        console.log(`[OrderWorker] Order #${order.id} verified and completed. Code: ${finalCode}`);
      } else if (result.confirmed === false) {
        // 尚未确认（确认数不足），保持 pending
        await db.updateOrderStatus(order.id, "pending", undefined, result.message);
        console.log(`[OrderWorker] Order #${order.id} verification pending: ${result.message}`);
      } else {
        // 明确失败（如金额不匹配、地址不匹配、交易失败）
        await db.updateOrderStatus(order.id, "failed", undefined, result.message);
        void sendTelegramMessage(TG_TEMPLATES.orderFailed(order, result.message));
        console.log(`[OrderWorker] Order #${order.id} verification failed: ${result.message}`);
      }
    } catch (e: any) {
      console.error(`[OrderWorker] Error processing order #${order.id}:`, e.message);
    }
  }
}
