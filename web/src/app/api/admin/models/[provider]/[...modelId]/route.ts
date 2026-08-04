import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { MAX_TAGS_PER_MODEL, MAX_TAG_LENGTH, normalizeTags, parseTags } from "@/lib/model-tags";
import { estimateUnitPrice, PROVIDER_META, toProviderId } from "@/lib/providers";

const patchSchema = z
  .object({
    is_active: z.boolean().optional(),
    is_recommended: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100000).optional(),
    credit_cost: z.number().int().min(1).max(100000).optional(),
    label: z.string().min(1).max(120).optional(),
    shelf: z.boolean().optional(),
    refresh_pricing: z.boolean().optional(),
    param_policy: z.union([z.string().max(20000), z.record(z.unknown())]).nullable().optional(),
    /** 手工类型标签；整组覆盖式提交 */
    tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_MODEL).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

function decodeModelId(parts: string[]): string {
  return parts.map((p) => decodeURIComponent(p)).join("/");
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ provider: string; modelId: string[] }> }
) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const routeParams = await ctx.params;
  const provider = toProviderId(routeParams.provider);
  const modelId = decodeModelId(routeParams.modelId || []);
  if (!modelId) return NextResponse.json({ error: "Invalid model id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const d = parsed.data;

  const catalog = await db.providerCatalogModel.findUnique({
    where: { provider_modelId: { provider, modelId } },
    include: { product: true },
  });
  if (!catalog) {
    return NextResponse.json(
      { error: `模型不在本地 ${PROVIDER_META[provider].label} 库，请先同步` },
      { status: 404 }
    );
  }

  if (d.refresh_pricing) {
    if (!PROVIDER_META[provider].supportsDynamicPricing) {
      return NextResponse.json(
        {
          error: `${PROVIDER_META[provider].label} 没有实时估价接口，成本以目录基准价 $${catalog.basePriceUsd} 为准`,
        },
        { status: 400 }
      );
    }
    const price = await estimateUnitPrice(provider, modelId, { prompt: "test" });
    return NextResponse.json({
      ok: true,
      last_unit_price_usd: price,
      base_price_usd: catalog.basePriceUsd,
    });
  }

  // 标签挂在目录模型上，未上架的模型也能贴，便于先分类再决定上架
  let tags = parseTags(catalog.tags);
  if (d.tags !== undefined) {
    tags = normalizeTags(d.tags);
    await db.providerCatalogModel.update({
      where: { id: catalog.id },
      data: { tags: JSON.stringify(tags) },
    });
  }

  let product = catalog.product;

  if (d.shelf === true || (d.is_active === true && !product)) {
    if (!product) {
      const defaultCost =
        d.credit_cost ??
        Math.max(1, Math.ceil((catalog.basePriceUsd || 0.05) * 100));
      product = await db.playthingProduct.create({
        data: {
          provider,
          modelId,
          catalogModelId: catalog.id,
          label: d.label || catalog.name || modelId,
          creditCost: defaultCost,
          isActive: true,
          isRecommended: d.is_recommended ?? false,
          sortOrder: d.sort_order ?? 100,
        },
      });
    } else if (d.shelf === true || d.is_active === true) {
      product = await db.playthingProduct.update({
        where: { id: product.id },
        data: { isActive: true },
      });
    }
  }

  if (d.shelf === false && product) {
    product = await db.playthingProduct.update({
      where: { id: product.id },
      data: { isActive: false },
    });
  }

  let paramPolicyStr: string | null | undefined;
  if (d.param_policy !== undefined) {
    if (d.param_policy === null) {
      paramPolicyStr = null;
    } else if (typeof d.param_policy === "string") {
      try {
        JSON.parse(d.param_policy || "{}");
      } catch {
        return NextResponse.json({ error: "param_policy 不是合法 JSON" }, { status: 400 });
      }
      paramPolicyStr = d.param_policy;
    } else {
      paramPolicyStr = JSON.stringify(d.param_policy);
    }
  }

  if (
    product &&
    (d.is_active !== undefined ||
      d.is_recommended !== undefined ||
      d.sort_order !== undefined ||
      d.credit_cost !== undefined ||
      d.label !== undefined ||
      paramPolicyStr !== undefined)
  ) {
    product = await db.playthingProduct.update({
      where: { id: product.id },
      data: {
        ...(d.is_active !== undefined ? { isActive: d.is_active } : {}),
        ...(d.is_recommended !== undefined ? { isRecommended: d.is_recommended } : {}),
        ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
        ...(d.credit_cost !== undefined ? { creditCost: d.credit_cost } : {}),
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(paramPolicyStr !== undefined ? { paramPolicy: paramPolicyStr } : {}),
      },
    });
  }

  if (
    !product &&
    (d.credit_cost !== undefined ||
      d.is_recommended !== undefined ||
      d.sort_order !== undefined ||
      paramPolicyStr !== undefined)
  ) {
    return NextResponse.json({ error: "请先上架该模型" }, { status: 400 });
  }

  await logAdminAction(
    admin.id,
    "plaything_product",
    { type: "PlaythingProduct", id: `${provider}:${modelId}` },
    d
  );

  return NextResponse.json({
    ok: true,
    tags,
    product: product
      ? {
          id: product.id,
          provider: toProviderId(product.provider),
          model_id: product.modelId,
          label: product.label,
          credit_cost: product.creditCost,
          is_active: product.isActive,
          is_recommended: product.isRecommended,
          sort_order: product.sortOrder,
          param_policy: safeJson(product.paramPolicy),
        }
      : null,
  });
}

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}
