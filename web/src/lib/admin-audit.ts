import "server-only";
import { db } from "./db";

export type AdminAuditAction =
  | "crypto_manual_credit"
  | "user_vip"
  | "user_balance"
  | "user_role"
  | "user_disable"
  | "mod_grant"
  | "mod_toggle"
  | "pricing_product"
  | "pricing_param_mapping"
  | "pricing_credit_package"
  | "pricing_vip_tier"
  | "pricing_vip_plan";

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
