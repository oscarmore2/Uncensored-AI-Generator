import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";

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
        },
      },
    },
    orderBy: [{ isRecommended: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    note: "玩物专区点数不享受 VIP 折扣",
    products: products.map((p) => ({
      id: p.id,
      model_id: p.modelId,
      label: p.label,
      credit_cost: p.creditCost,
      is_recommended: p.isRecommended,
      sort_order: p.sortOrder,
      type: p.catalogModel?.type ?? "",
      description: p.catalogModel?.description ?? "",
      thumbnail_url: p.catalogModel?.thumbnailUrl ?? null,
      param_schema: parseSchema(p.paramSchemaOverride || p.catalogModel?.apiSchema),
    })),
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
