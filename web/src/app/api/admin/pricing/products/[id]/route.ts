import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { productAdminOut } from "@/lib/pricing";
import { deriveCreditCost } from "@/lib/generation-catalog";
import { PROVIDER_IDS, PROVIDER_META, toProviderId } from "@/lib/providers/meta";

const patchSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    description: z.string().max(300).optional(),
    /** 绑定的上游 model_id；空串表示解绑（该档位对用户隐藏） */
    provider_model_id: z.string().max(160).optional(),
    /** 绑定的渠道；与 provider_model_id 成对提交，缺省沿用档位当前渠道 */
    provider: z.enum(PROVIDER_IDS).optional(),
    credit_cost: z.number().int().positive().max(100000).optional(),
    ref_credits: z.number().int().min(0).max(100000).optional(),
    ref_label: z.string().max(160).optional(),
    /** 13000 = 130%；改动后按 ref_credits 重算 credit_cost（除非同时显式传了 credit_cost） */
    price_multiplier_bps: z.number().int().min(100).max(100000).optional(),
    batch_four_multiplier: z.number().positive().max(10).optional(),
    default_inputs: z.record(z.string(), z.unknown()).optional(),
    requires_vip: z.boolean().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(-9999).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;

  const existing = await db.generationProduct.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "档位不存在" }, { status: 404 });

  // 换绑模型时渠道必须一起定下来：同一个 model_id 在两家上游都可能存在，
  // 只改 id 不改渠道会把请求发给错误的上游，而且要到用户点生成时才暴露
  const nextProvider = toProviderId(d.provider ?? existing.provider);
  if (d.provider_model_id) {
    const known = await db.providerCatalogModel.findUnique({
      where: { provider_modelId: { provider: nextProvider, modelId: d.provider_model_id } },
      select: { modelId: true },
    });
    if (!known) {
      return NextResponse.json(
        {
          error: `该 model_id 不在已同步的 ${PROVIDER_META[nextProvider].label} 目录中，请先同步该渠道的模型库`,
        },
        { status: 400 }
      );
    }
  }

  // 只调倍率时按对标点数重算价格，省得运营手工换算
  const refCredits = d.ref_credits ?? existing.refCredits;
  const multiplierBps = d.price_multiplier_bps ?? existing.priceMultiplierBps;
  const recomputed =
    d.credit_cost === undefined &&
    (d.price_multiplier_bps !== undefined || d.ref_credits !== undefined) &&
    refCredits > 0
      ? deriveCreditCost(refCredits, multiplierBps)
      : undefined;

  const product = await db.generationProduct.update({
    where: { id },
    data: {
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.provider_model_id !== undefined
        ? { providerModelId: d.provider_model_id.trim(), provider: nextProvider }
        : d.provider !== undefined
          ? { provider: nextProvider }
          : {}),
      ...(d.credit_cost !== undefined
        ? { creditCost: d.credit_cost }
        : recomputed !== undefined
          ? { creditCost: recomputed }
          : {}),
      ...(d.ref_credits !== undefined ? { refCredits: d.ref_credits } : {}),
      ...(d.ref_label !== undefined ? { refLabel: d.ref_label } : {}),
      ...(d.price_multiplier_bps !== undefined
        ? { priceMultiplierBps: d.price_multiplier_bps }
        : {}),
      ...(d.batch_four_multiplier !== undefined
        ? { batchFourMultiplier: d.batch_four_multiplier }
        : {}),
      ...(d.default_inputs !== undefined
        ? { defaultInputs: JSON.stringify(d.default_inputs) }
        : {}),
      ...(d.requires_vip !== undefined ? { requiresVip: d.requires_vip } : {}),
      ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
      ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
    },
  });

  await logAdminAction(admin.id, "pricing_product", { type: "GenerationProduct", id }, {
    action: "patch",
    mode: existing.mode,
    tier: existing.tier,
    spicy: existing.spicy,
    ...d,
  });

  return NextResponse.json({ ok: true, product: productAdminOut(product) });
}
