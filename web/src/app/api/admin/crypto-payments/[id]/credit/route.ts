import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { creditCryptoPayment } from "@/lib/cryptomus";
import { logAdminAction } from "@/lib/admin-audit";

const bodySchema = z.object({
  credits_override: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

/** Admin 人工确认加密订单入账（Webhook 丢失 / wrong_amount 等） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const paymentId = Number(id);
  if (!Number.isInteger(paymentId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const payment = await db.cryptoPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  if (payment.credited) return NextResponse.json({ error: "订单已入账" }, { status: 400 });

  const credits = parsed.data.credits_override ?? payment.credits;
  const ok = await creditCryptoPayment(payment, {
    creditsOverride: credits,
    methodSuffix: "manual",
    skipTelegram: false,
    telegramExtra: parsed.data.note ? `备注: ${parsed.data.note}` : "人工入账",
  });

  if (!ok) {
    return NextResponse.json({ error: "入账失败（可能已被其他操作抢先入账）" }, { status: 409 });
  }

  await logAdminAction(admin.id, "crypto_manual_credit", { type: "crypto_payment", id: paymentId }, {
    order_id: payment.orderId,
    user_id: payment.userId,
    credits,
    note: parsed.data.note,
  });

  const updated = await db.cryptoPayment.findUnique({ where: { id: paymentId } });
  return NextResponse.json({
    ok: true,
    payment: {
      id: updated!.id,
      order_id: updated!.orderId,
      credited: updated!.credited,
      credits,
    },
  });
}
