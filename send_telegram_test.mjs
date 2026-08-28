const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;
if (!token || !chatId) throw new Error("Telegram credentials are not configured");

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: "✅ <b>M7社媒助手 Telegram 追踪机器人测试成功</b>\n\n机器人已连接云端后台。后续订单创建、链上核验、激活码发放和核销等事件会发送到此对话。",
    parse_mode: "HTML",
  }),
});

const body = await response.json();
if (!response.ok || !body.ok) throw new Error(`Telegram API failed: ${body.description || response.status}`);
console.log("Telegram test notification sent successfully.");
