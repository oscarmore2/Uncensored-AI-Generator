import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import {
  PLAYTHING_CATEGORIES,
  resolvePlaythingCategory,
  type PlaythingCategoryId,
} from "@/lib/plaything-categories";
import { parseParamPolicy, resolveParamControls, type SchemaProp } from "@/lib/plaything-param-policy";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  const products = await db.waveSpeedProduct.findMany({
    where: { isActive: true },
    include: {
      catalogModel: {
        select: {
          type: true,
          description: true,
          thumbnailUrl: true,
          apiSchema: true,
          basePriceUsd: true,
        },
      },
    },
    orderBy: [{ isRecommended: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  const mapped = products.map((p) => {
    const type = p.catalogModel?.type ?? "";
    const { category, media_kind } = resolvePlaythingCategory(type, p.modelId);
    const param_schema = parseSchema(p.paramSchemaOverride || p.catalogModel?.apiSchema);
    const properties = (param_schema?.properties ?? {}) as Record<string, SchemaProp>;
    const controls = resolveParamControls(properties, p.paramPolicy);
    return {
      id: p.id,
      model_id: p.modelId,
      label: p.label,
      credit_cost: p.creditCost,
      base_price_usd: p.catalogModel?.basePriceUsd ?? 0,
      is_recommended: p.isRecommended,
      sort_order: p.sortOrder,
      type,
      description: p.catalogModel?.description ?? "",
      thumbnail_url: p.catalogModel?.thumbnailUrl ?? null,
      category,
      media_kind,
      param_schema,
      param_policy: parseParamPolicy(p.paramPolicy),
      controls,
    };
  });

  const countByCat = new Map<PlaythingCategoryId, number>();
  for (const p of mapped) {
    countByCat.set(p.category, (countByCat.get(p.category) ?? 0) + 1);
  }

  const categories = PLAYTHING_CATEGORIES.filter((c) => (countByCat.get(c.id) ?? 0) > 0).map(
    (c) => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      media_kind: c.mediaKind,
      count: countByCat.get(c.id) ?? 0,
    })
  );

  return NextResponse.json({
    note: "玩物专区点数不享受 VIP 折扣；报价随参数动态变化",
    categories,
    products: mapped,
  });
}

function parseSchema(raw: string | null | undefined): {
  properties: Record<string, unknown>;
  required: string[];
} | null {
  if (!raw) return null;
  try {
    const root = JSON.parse(raw) as {
      api_schemas?: Array<{
        request_schema?: { properties?: Record<string, unknown>; required?: string[] };
      }>;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const schema = root.api_schemas?.[0]?.request_schema;
    if (schema?.properties) {
      return {
        properties: schema.properties,
        required: schema.required ?? [],
      };
    }
    if (root.properties) {
      return { properties: root.properties, required: root.required ?? [] };
    }
  } catch {
    /* ignore */
  }
  return null;
}
