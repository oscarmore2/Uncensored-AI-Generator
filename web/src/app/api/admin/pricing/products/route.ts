import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { ensurePricingSeeded, productAdminOut } from "@/lib/pricing";
import { rebindGenerationProducts } from "@/lib/pricing-seed";
import { ZC_STARTER_USD_PER_CREDIT } from "@/lib/generation-catalog";

/**
 * 档位矩阵是固定的（5 模式 × 档位 × 普通/Spicy），不开放任意增删，
 * 管理端只做「绑定模型 / 调价 / 上下架」。
 */
export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();

  const products = await db.generationProduct.findMany({
    orderBy: [{ mode: "asc" }, { spicy: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  // 用已同步的模型价格算毛利，方便直接看出哪个档位在亏
  const modelIds = products.map((p) => p.providerModelId).filter(Boolean);
  const catalog = modelIds.length
    ? await db.waveSpeedCatalogModel.findMany({
        where: { modelId: { in: modelIds } },
        select: { modelId: true, name: true, basePriceUsd: true, lastUnitPriceUsd: true },
      })
    : [];
  const byModel = new Map(catalog.map((c) => [c.modelId, c]));

  return NextResponse.json({
    products: products.map((p) => {
      const base = productAdminOut(p);
      const model = byModel.get(p.providerModelId);
      const costUsd = model?.lastUnitPriceUsd ?? model?.basePriceUsd ?? null;
      return {
        ...base,
        provider_model_name: model?.name ?? null,
        provider_cost_usd: costUsd,
        margin_percent:
          costUsd && costUsd > 0 && base.retail_usd > 0
            ? Number((((base.retail_usd - costUsd) / base.retail_usd) * 100).toFixed(1))
            : null,
      };
    }),
    credit_usd_value: ZC_STARTER_USD_PER_CREDIT,
    unbound: products.filter((p) => !p.providerModelId.trim()).length,
    catalog_synced: await db.waveSpeedCatalogModel.count(),
  });
}

/** 重新解析未绑定档位的桥接模型（WaveSpeed 目录同步后使用） */
export async function POST() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensurePricingSeeded();

  const result = await rebindGenerationProducts();
  await logAdminAction(admin.id, "pricing_product", { type: "GenerationProduct", id: "all" }, {
    action: "rebind",
    ...result,
  });
  return NextResponse.json({ ok: true, ...result });
}
