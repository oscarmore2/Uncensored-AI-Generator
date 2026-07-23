import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

function catalogOut(
  c: {
    id: number;
    modelId: string;
    name: string;
    type: string;
    description: string;
    basePriceUsd: number;
    lastUnitPriceUsd: number | null;
    thumbnailUrl: string | null;
    syncedAt: Date;
    updatedAt: Date;
  },
  product: {
    id: number;
    label: string;
    creditCost: number;
    isActive: boolean;
    isRecommended: boolean;
    sortOrder: number;
  } | null
) {
  return {
    id: c.id,
    model_id: c.modelId,
    name: c.name,
    type: c.type,
    description: c.description,
    base_price_usd: c.basePriceUsd,
    last_unit_price_usd: c.lastUnitPriceUsd,
    thumbnail_url: c.thumbnailUrl,
    synced_at: c.syncedAt,
    product: product
      ? {
          id: product.id,
          label: product.label,
          credit_cost: product.creditCost,
          is_active: product.isActive,
          is_recommended: product.isRecommended,
          sort_order: product.sortOrder,
        }
      : null,
  };
}

export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = (url.searchParams.get("type") || "").trim();
  const shelved = url.searchParams.get("shelved"); // "1" | "0" | null
  const adult = url.searchParams.get("adult") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") || 24) || 24));

  const and: Prisma.WaveSpeedCatalogModelWhereInput[] = [];
  if (type) and.push({ type });
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

  const where: Prisma.WaveSpeedCatalogModelWhereInput = and.length ? { AND: and } : {};

  const [total, rows, lastSync, types] = await Promise.all([
    db.waveSpeedCatalogModel.count({ where }),
    db.waveSpeedCatalogModel.findMany({
      where,
      include: { product: true },
      orderBy: [{ basePriceUsd: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.waveSpeedCatalogModel.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    db.waveSpeedCatalogModel.findMany({
      distinct: ["type"],
      select: { type: true },
      orderBy: { type: "asc" },
      take: 100,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    page_size: pageSize,
    last_synced_at: lastSync?.syncedAt ?? null,
    types: types.map((t) => t.type).filter(Boolean),
    models: rows.map((r) => catalogOut(r, r.product)),
  });
}
