import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { encryptSecret } from "@/lib/secret-crypto";
import { logAdminAction } from "@/lib/admin-audit";

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    api_key: z.string().trim().min(8).max(500).optional(),
    ipn_secret: z.string().trim().min(8).max(500).optional(),
    base_url: z.string().url().max(500).optional(),
    activate: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

function accountId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const id = accountId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数无效" },
      { status: 400 }
    );
  }
  const existing = await db.nowPaymentsAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  const data = parsed.data;
  if (data.ipn_secret !== undefined) {
    const pendingOrders = await db.nowPayment.count({
      where: {
        nowPaymentsAccountId: id,
        credited: false,
        status: {
          in: [
            "creating",
            "waiting",
            "confirming",
            "confirmed",
            "sending",
            "partially_paid",
          ],
        },
      },
    });
    if (pendingOrders > 0) {
      return NextResponse.json(
        {
          error: `该配置仍有 ${pendingOrders} 笔未完成订单；请新增并激活另一配置，不要覆盖旧 IPN Secret`,
        },
        { status: 409 }
      );
    }
  }
  const account = await db.$transaction(async (tx) => {
    if (data.activate === true) {
      await tx.nowPaymentsAccount.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }
    return tx.nowPaymentsAccount.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.api_key !== undefined
          ? { apiKeyEnc: encryptSecret(data.api_key) }
          : {}),
        ...(data.ipn_secret !== undefined
          ? { ipnSecretEnc: encryptSecret(data.ipn_secret) }
          : {}),
        ...(data.base_url !== undefined
          ? { baseUrl: data.base_url.replace(/\/+$/, "") }
          : {}),
        ...(data.activate !== undefined ? { isActive: data.activate } : {}),
      },
    });
  });
  await logAdminAction(
    admin.id,
    "nowpayments_account",
    { type: "nowpayments_account", id },
    { operation: "update", active: account.isActive, label: account.label }
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const id = accountId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const existing = await db.nowPaymentsAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  const referencedPayments = await db.nowPayment.count({
    where: { nowPaymentsAccountId: id },
  });
  if (referencedPayments > 0) {
    return NextResponse.json(
      {
        error: `该配置关联 ${referencedPayments} 笔订单，不能删除；请停用以保留旧订单 IPN 验签`,
      },
      { status: 409 }
    );
  }
  await db.nowPaymentsAccount.delete({ where: { id } });
  await logAdminAction(
    admin.id,
    "nowpayments_account",
    { type: "nowpayments_account", id },
    { operation: "delete", label: existing.label }
  );
  return NextResponse.json({ ok: true });
}
