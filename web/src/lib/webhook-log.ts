import "server-only";
import { db } from "./db";

export async function logWebhookEvent(params: {
  provider: "stripe" | "cryptomus";
  eventType?: string | null;
  externalId?: string | null;
  status: "ok" | "ignored" | "error";
  detail?: Record<string, unknown> | string;
}): Promise<void> {
  try {
    await db.webhookEventLog.create({
      data: {
        provider: params.provider,
        eventType: params.eventType ?? null,
        externalId: params.externalId ?? null,
        status: params.status,
        detail:
          typeof params.detail === "string"
            ? params.detail
            : params.detail
              ? JSON.stringify(params.detail)
              : null,
      },
    });
  } catch (err) {
    console.error("[webhook-log] failed to log:", err);
  }
}
