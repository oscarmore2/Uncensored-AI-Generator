import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseTags } from "@/lib/model-tags";
import { PROVIDER_LIST, toProviderId } from "@/lib/providers/meta";

/**
 * 模型库列表：一次只看一个渠道。
 * 两家的 model_id 命名空间是独立的，混在一张列表里既没法排序也没法上架。
 */

function catalogOut(
  c: {
    id: number;
    provider: string;
    modelId: string;
    name: string;
    type: string;
    description: string;
    basePriceUsd: number;
    lastUnitPriceUsd: number | null;
    thumbnailUrl: string | null;
    tags: string;
    syncedAt: Date;
  },
  product: {
    id: number;
    label: string;
    creditCost: number;
    isActive: boolean;
    isRecommended: boolean;
    sortOrder: number;
    paramPolicy: string | null;
  } | null
) {
  return {
    id: c.id,
    provider: toProviderId(c.provider),
    model_id: c.modelId,
    name: c.name,
    type: c.type,
    description: c.description,
    base_price_usd: c.basePriceUsd,
    last_unit_price_usd: c.lastUnitPriceUsd,
    thumbnail_url: c.thumbnailUrl,
    tags: parseTags(c.tags),
    synced_at: c.syncedAt,
    product: product
      ? {
          id: product.id,
          label: product.label,
          credit_cost: product.creditCost,
          is_active: product.isActive,
          is_recommended: product.isRecommended,
          sort_order: product.sortOrder,
          param_policy: safeJson(product.paramPolicy),
        }
      : null,
  };
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const provider = toProviderId(url.searchParams.get("provider"));
  const q = (url.searchParams.get("q") || "").trim();
  const type = (url.searchParams.get("type") || "").trim();
  const tag = (url.searchParams.get("tag") || "").trim();
  const shelved = url.searchParams.get("shelved"); // "1" | "0" | null
  const adult = url.searchParams.get("adult") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") || 24) || 24));

  const and: Prisma.ProviderCatalogModelWhereInput[] = [{ provider }];
  if (type) and.push({ type });
  // tags 存的是 JSON 数组字符串，按带引号的整词匹配避免 "高档" 命中 "高档次"
  if (tag) and.push({ tags: { contains: `"${tag}"`, mode: "insensitive" } });
  if (q) {
    and.push({
      OR: [
        { modelId: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (adult) {
    and.push({
      OR: [
        { modelId: { contains: "spicy", mode: "insensitive" } },
        { name: { contains: "spicy", mode: "insensitive" } },
        { modelId: { contains: "nsfw", mode: "insensitive" } },
        { modelId: { contains: "breast", mode: "insensitive" } },
        { modelId: { contains: "uncensored", mode: "insensitive" } },
        { description: { contains: "uncensored", mode: "insensitive" } },
      ],
    });
  }
  if (shelved === "1") and.push({ product: { isNot: null } });
  else if (shelved === "0") and.push({ product: { is: null } });

  const where: Prisma.ProviderCatalogModelWhereInput = { AND: and };

  const [total, rows, lastSync, types, tagRows, counts] = await Promise.all([
    db.providerCatalogModel.count({ where }),
    db.providerCatalogModel.findMany({
      where,
      include: { product: true },
      orderBy: [{ basePriceUsd: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.providerCatalogModel.findFirst({
      where: { provider },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    db.providerCatalogModel.findMany({
      where: { provider },
      distinct: ["type"],
      select: { type: true },
      orderBy: { type: "asc" },
      take: 200,
    }),
    // 已用过的标签，供筛选下拉与快捷输入
    db.providerCatalogModel.findMany({
      where: { provider, NOT: { tags: "[]" } },
      select: { tags: true },
      take: 2000,
    }),
    db.providerCatalogModel.groupBy({ by: ["provider"], _count: { _all: true } }),
  ]);

  const allTags = Array.from(
    new Set(tagRows.flatMap((r) => parseTags(r.tags)))
  ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const countByProvider = new Map(counts.map((c) => [toProviderId(c.provider), c._count._all]));

  return NextResponse.json({
    provider,
    total,
    page,
    page_size: pageSize,
    last_synced_at: lastSync?.syncedAt ?? null,
    types: types.map((t) => t.type).filter(Boolean),
    tags: allTags,
    models: rows.map((r) => catalogOut(r, r.product)),
    // 每个 tab 上都要显示各自的已同步数量，所以一次把全部渠道的计数带回去
    providers: PROVIDER_LIST.map((p) => ({
      id: p.id,
      label: p.label,
      short_label: p.shortLabel,
      supports_dynamic_pricing: p.supportsDynamicPricing,
      synced_count: countByProvider.get(p.id) ?? 0,
    })),
  });
}
