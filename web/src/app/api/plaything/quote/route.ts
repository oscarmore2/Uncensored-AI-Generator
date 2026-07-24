import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import {
  inputsForPricing,
  resolvePlaythingQuoteDynamic,
} from "@/lib/wavespeed";
import { assertTierValue, type SchemaProp } from "@/lib/plaything-param-policy";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  product_id: z.number().int().positive(),
  inputs: z.record(z.string(), z.unknown()).optional().default({}),
});

function parseProps(raw: string | null | undefined): Record<string, SchemaProp> {
  if (!raw) return {};
  try {
    const root = JSON.parse(raw) as {
      api_schemas?: Array<{ request_schema?: { properties?: Record<string, SchemaProp> } }>;
      properties?: Record<string, SchemaProp>;
    };
    return root.api_schemas?.[0]?.request_schema?.properties || root.properties || {};
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  if (!rateLimit(`plaything-quote:${user.id}`, 40, 60_000)) {
    return NextResponse.json({ error: "询价过于频繁" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const product = await db.waveSpeedProduct.findFirst({
    where: { id: parsed.data.product_id, isActive: true },
    include: { catalogModel: { select: { apiSchema: true } } },
  });
  if (!product) return NextResponse.json({ error: "模型未上架" }, { status: 404 });

  const properties = parseProps(product.paramSchemaOverride || product.catalogModel?.apiSchema);
  for (const [k, v] of Object.entries(parsed.data.inputs)) {
    const err = assertTierValue(k, v, properties, product.paramPolicy);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  try {
    const quote = await resolvePlaythingQuoteDynamic({
      productId: product.id,
      inputs: inputsForPricing(parsed.data.inputs),
    });
    return NextResponse.json({
      cost: quote.cost,
      unit_price_usd: quote.unit_price_usd,
      base_price_usd: quote.base_price_usd,
      credit_cost_base: quote.credit_cost_base,
      source: quote.source,
      discount_bps: 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "询价失败" },
      { status: 400 }
    );
  }
}
