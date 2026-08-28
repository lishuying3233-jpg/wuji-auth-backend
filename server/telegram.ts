export async function sendTelegramMessage(text: string) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Telegram] Notification skipped: Bot Token or Chat ID not configured.");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`[Telegram] Failed to send message: ${res.status} ${error}`);
    }
  } catch (e: any) {
    console.error(`[Telegram] Error sending notification: ${e.message}`);
  }
}

export const TG_TEMPLATES = {
  orderCreated: (order: any) => `
<b>🆕 新订单提醒</b>
━━━━━━━━━━━━━━
<b>套餐:</b> ${order.planName} (${order.durationDays}天)
<b>金额:</b> ${order.amount} USDT
<b>网络:</b> ${order.network}
<b>HWID:</b> <code>${order.machineId}</code>
<b>TxHash:</b> <code>${order.txHash || "未提交"}</code>
<b>状态:</b> 自动核验中...
  `.trim(),

  orderVerified: (order: any, code: string) => `
<b>✅ 支付核验通过</b>
━━━━━━━━━━━━━━
<b>订单:</b> #${order.id}
<b>HWID:</b> <code>${order.machineId}</code>
<b>发码:</b> <code>${code}</code>
<b>状态:</b> 激活码已自动发放并绑定
  `.trim(),

  orderFailed: (order: any, reason: string) => `
<b>❌ 支付核验失败</b>
━━━━━━━━━━━━━━
<b>订单:</b> #${order.id}
<b>HWID:</b> <code>${order.machineId}</code>
<b>金额:</b> ${order.amount} USDT
<b>原因:</b> <pre>${reason}</pre>
<b>建议:</b> 请检查 TxHash 是否正确或等待链上确认
  `.trim(),

  licenseActivated: (code: any, machineId: string) => `
<b>🔑 激活码核销通知</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${code.code}</code>
<b>设备:</b> <code>${machineId}</code>
<b>期限:</b> ${code.durationDays} 天
<b>状态:</b> 首次激活成功并已锁定设备
  `.trim(),

  licenseDisabled: (code: string, admin: string) => `
<b>⚠️ 授权禁用提醒</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${code}</code>
<b>操作人:</b> ${admin}
<b>状态:</b> 授权已强制禁用，客户端将锁定
  `.trim(),

  licenseRenewed: (code: string, days: number, admin: string) => `
<b>➕ 授权续期通知</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${code}</code>
<b>续期:</b> ${days} 天
<b>操作人:</b> ${admin}
  `.trim(),
};
