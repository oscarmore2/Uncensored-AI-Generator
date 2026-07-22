import "server-only";
import { env } from "./env";

export function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/**
 * 发送 Telegram 通知（fire-and-forget）。
 * 未配置时静默跳过；失败只记 warn，绝不影响主流程。
 */
export function sendTelegram(text: string): void {
  if (!telegramConfigured()) return;

  void fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        console.warn(`[telegram] sendMessage failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
      }
    })
    .catch((err) => {
      console.warn("[telegram] sendMessage error:", err);
    });
}

// 按 key 去重的告警（进程内），同一 key 在窗口期内只发一次，避免刷屏
const alertSentAt = new Map<string, number>();
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sendTelegramAlertOnce(key: string, text: string): void {
  const last = alertSentAt.get(key);
  if (last && Date.now() - last < ALERT_WINDOW_MS) return;
  alertSentAt.set(key, Date.now());
  sendTelegram(text);
}
