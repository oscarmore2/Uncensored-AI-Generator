import "server-only";
import { db } from "./db";

export type AdminAuditAction =
  | "crypto_manual_credit"
  | "user_vip"
  | "user_balance"
  | "user_role"
  | "user_disable"
  | "user_plaything"
  | "mod_grant"
  | "mod_toggle"
  | "pricing_product"
  | "pricing_param_mapping"
  | "pricing_credit_package"
  | "pricing_vip_tier"
  | "pricing_vip_plan"
  // 旧值：迁移到多渠道之前写下的历史记录仍在库里，审计页要能显示
  | "wavespeed_sync"
  | "wavespeed_product"
  | "provider_sync"
  | "provider_account"
  | "plaything_product"
  | "system_signup_credits"
  | "system_ai_token_rate"
  | "nowpayments_account"
  | "openai_account"
  | "llm_account"
  | "llm_model_price"
  | "skill_edit"
  | "skill_restore";

export async function logAdminAction(
  adminId: number,
  action: AdminAuditAction,
  target?: { type: string; id: string | number },
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: target?.type ?? null,
        targetId: target?.id !== undefined ? String(target.id) : null,
        detail: detail ? JSON.stringify(detail) : null,
      },
    });
  } catch (err) {
    console.error("[admin-audit] failed to log:", err);
  }
}
