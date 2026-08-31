function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export async function sendTelegramMessage(text: string, force?: boolean, config?: { botToken?: string, chatId?: string }) {
  let token = config?.botToken || process.env.TG_BOT_TOKEN;
  let chatId = config?.chatId || process.env.TG_CHAT_ID;
  let isEnabled = true;

  if (!config?.botToken || !config?.chatId) {
    try {
      const { getTelegramSettings } = await import("./db");
      const settings = await getTelegramSettings();
      if (settings) {
        if (!config?.botToken && settings.botToken) token = settings.botToken;
        if (!config?.chatId && settings.chatId) chatId = settings.chatId;
        isEnabled = settings.isEnabled === 1;
      }
    } catch (err) {
      // Ignore
    }
  }

  if (!force && !isEnabled) return { success: false, error: "Disabled" };
  if (!token || !chatId) {
    const msg = "Bot Token or Chat ID not configured.";
    console.warn(`[Telegram] Notification skipped: ${msg}`);
    return { success: false, error: msg };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ description: "Unknown error" }));
      const errorMsg = errorData.description || `HTTP ${res.status}`;
      console.error(`[Telegram] Failed to send message: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
    return { success: true };
  } catch (e: any) {
    const errorMsg = e.name === "TimeoutError" ? "Request timeout (8s)" : e.message;
    console.error(`[Telegram] Error sending notification: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export const TG_TEMPLATES = {
  orderCreated: (order: any) => `
<b>🆕 新订单提醒</b>
━━━━━━━━━━━━━━
<b>套餐:</b> ${escapeHtml(order.planName)} (${escapeHtml(order.durationDays)}天)
<b>金额:</b> ${escapeHtml(order.amount)} USDT
<b>网络:</b> ${escapeHtml(order.network)}
<b>HWID:</b> <code>${escapeHtml(order.machineId)}</code>
<b>TxHash:</b> <code>${escapeHtml(order.txHash || "未提交")}</code>
<b>状态:</b> 自动核验中...
  `.trim(),

  orderVerified: (order: any, code: string) => `
<b>✅ 支付核验通过</b>
━━━━━━━━━━━━━━
<b>订单:</b> #${escapeHtml(order.id)}
<b>HWID:</b> <code>${escapeHtml(order.machineId)}</code>
<b>发码:</b> <code>${escapeHtml(code)}</code>
<b>状态:</b> 激活码已自动发放并绑定
  `.trim(),

  orderFailed: (order: any, reason: string) => `
<b>❌ 支付核验失败</b>
━━━━━━━━━━━━━━
<b>订单:</b> #${escapeHtml(order.id)}
<b>HWID:</b> <code>${escapeHtml(order.machineId)}</code>
<b>金额:</b> ${escapeHtml(order.amount)} USDT
<b>原因:</b> <pre>${escapeHtml(reason)}</pre>
<b>建议:</b> 请检查 TxHash 是否正确或等待链上确认
  `.trim(),

  licenseActivated: (code: any, machineId: string) => `
<b>🔑 激活码核销通知</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${escapeHtml(code.code)}</code>
<b>设备:</b> <code>${escapeHtml(machineId)}</code>
<b>期限:</b> ${escapeHtml(code.durationDays)} 天
<b>状态:</b> 首次激活成功并已锁定设备
  `.trim(),

  licenseDisabled: (code: string, admin: string) => `
<b>⚠️ 授权禁用提醒</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${escapeHtml(code)}</code>
<b>操作人:</b> ${escapeHtml(admin)}
<b>状态:</b> 授权已强制禁用，客户端将锁定
  `.trim(),

  licenseRenewed: (code: string, days: number, admin: string) => `
<b>➕ 授权续期通知</b>
━━━━━━━━━━━━━━
<b>代码:</b> <code>${escapeHtml(code)}</code>
<b>续期:</b> ${escapeHtml(days)} 天
<b>操作人:</b> ${escapeHtml(admin)}
  `.trim(),
};
