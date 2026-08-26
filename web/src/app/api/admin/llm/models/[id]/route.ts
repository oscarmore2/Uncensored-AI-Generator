import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { LLM_TIERS } from "@/lib/llm/models";

const patchSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    provider_model_id: z.string().min(1).max(200).optional(),
    tier_code: z.enum(LLM_TIERS).optional(),
    input_usd_per_mtok: z.number().min(0).max(1000).optional(),
    output_usd_per_mtok: z.number().min(0).max(1000).optional(),
    price_multiplier_bps: z.number().int().min(10000).max(100000).optional(),
    context_tokens: z.number().int().min(1000).max(2_000_000).optional(),
    supports_streaming: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
    uncensored: z.boolean().optional(),
    requires_vip_rank: z.number().int().min(0).max(10).optional(),
    requires_adult: z.boolean().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;

  const current = await db.llmModel.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "模型不存在" }, { status: 404 });

  /*
   * uncensored 的模型必须同时要求成人验证（规划 7.3）。
   * 这道校验放在保存时而不是调用时：调用时才发现配错，意味着这段时间里
   * 未验证的用户已经用上了。判定复用与 Spicy 档同一条 hasAdultAccess。
   */
  const uncensored = data.uncensored ?? current.uncensored;
  const requiresAdult = data.requires_adult ?? current.requiresAdult;
  if (uncensored && !requiresAdult) {
    return NextResponse.json(
      { error: "uncensored 模型必须同时要求成人验证" },
      { status: 400 }
    );
  }

  const updated = await db.llmModel.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.provider_model_id !== undefined ? { providerModelId: data.provider_model_id } : {}),
      ...(data.tier_code !== undefined ? { tierCode: data.tier_code } : {}),
      ...(data.input_usd_per_mtok !== undefined ? { inputUsdPerMTok: data.input_usd_per_mtok } : {}),
      ...(data.output_usd_per_mtok !== undefined
        ? { outputUsdPerMTok: data.output_usd_per_mtok }
        : {}),
      ...(data.price_multiplier_bps !== undefined
        ? { priceMultiplierBps: data.price_multiplier_bps }
        : {}),
      ...(data.context_tokens !== undefined ? { contextTokens: data.context_tokens } : {}),
      ...(data.supports_streaming !== undefined
        ? { supportsStreaming: data.supports_streaming }
        : {}),
      ...(data.supports_vision !== undefined ? { supportsVision: data.supports_vision } : {}),
      ...(data.uncensored !== undefined ? { uncensored: data.uncensored } : {}),
      ...(data.requires_vip_rank !== undefined ? { requiresVipRank: data.requires_vip_rank } : {}),
      ...(data.requires_adult !== undefined ? { requiresAdult: data.requires_adult } : {}),
      ...(data.is_active !== undefined ? { isActive: data.is_active } : {}),
      ...(data.sort_order !== undefined ? { sortOrder: data.sort_order } : {}),
      // 人工改过价就不该再显示「同步于某时」——那个时间戳只属于自动同步
      ...(data.input_usd_per_mtok !== undefined || data.output_usd_per_mtok !== undefined
        ? { priceSyncedAt: null }
        : {}),
    },
  });

  await logAdminAction(admin.id, "llm_model_price", { type: "llm_model", id }, {
    key: current.key,
    before: {
      input: current.inputUsdPerMTok,
      output: current.outputUsdPerMTok,
      multiplier_bps: current.priceMultiplierBps,
      is_active: current.isActive,
    },
    after: data,
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
