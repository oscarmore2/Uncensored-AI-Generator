import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import {
  inputsForPricing,
  processWaveSpeedGeneration,
  resolvePlaythingQuoteDynamic,
} from "@/lib/wavespeed";
import { playthingGenerationOut, playthingProductInclude } from "@/lib/plaything-serialize";
import { assertTierValue, type SchemaProp } from "@/lib/plaything-param-policy";
import { rateLimit } from "@/lib/rate-limit";
import { reviewPromptWithHarness } from "@/lib/content-safety";
import { isVipActive } from "@/lib/pricing";

const createSchema = z.object({
  product_id: z.number().int().positive(),
  prompt: z.string().max(8000).optional().default(""),
  params: z.record(z.string(), z.unknown()).optional().default({}),
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

function assertMediaUrls(params: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(params)) {
    if (!/image|video|audio|mask|reference/i.test(k)) continue;
    const urls = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    for (const u of urls) {
      if (typeof u !== "string") return `${k} 媒体地址无效`;
      if (u.startsWith("data:")) return `${k} 请使用上传接口，勿提交 base64`;
      if (!/^https?:\/\//i.test(u)) return `${k} 需要 http(s) URL`;
    }
  }
  return null;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  if (!rateLimit(`plaything:${user.id}`, 8, 60_000)) {
    return NextResponse.json({ error: "生成请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const product = await db.waveSpeedProduct.findFirst({
    where: { id: parsed.data.product_id, isActive: true },
    include: {
      catalogModel: { select: { type: true, apiSchema: true, basePriceUsd: true } },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "模型未上架或不存在" }, { status: 404 });
  }

  const prompt = parsed.data.prompt.trim();
  const params: Record<string, unknown> = { ...(parsed.data.params ?? {}) };

  if (!isVipActive(user) && prompt) {
    try {
      const safety = await reviewPromptWithHarness({ mode: product.modelId, prompt });
      if (!safety.allowed) {
        return NextResponse.json(
          {
            error: `内容审查未通过：${safety.reason}`,
            code: "CONTENT_POLICY_REJECTED",
            categories: safety.categories,
          },
          { status: 422 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "内容审查服务暂不可用" },
        { status: 503 }
      );
    }
  }

  const properties = parseProps(product.paramSchemaOverride || product.catalogModel?.apiSchema);
  for (const [k, v] of Object.entries(params)) {
    const err = assertTierValue(k, v, properties, product.paramPolicy);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const mediaErr = assertMediaUrls(params);
  if (mediaErr) return NextResponse.json({ error: mediaErr }, { status: 400 });

  const pricingInputs = inputsForPricing({
    ...params,
    ...(prompt ? { prompt } : {}),
  });

  let cost: number;
  try {
    const quote = await resolvePlaythingQuoteDynamic({
      productId: product.id,
      inputs: pricingInputs,
    });
    cost = quote.cost;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "报价失败" },
      { status: 400 }
    );
  }

  const charged = await db.user.updateMany({
    where: { id: user.id, balance: { gte: cost } },
    data: { balance: { decrement: cost } },
  });
  if (charged.count === 0) {
    return NextResponse.json({ error: "点数不足，请先充值" }, { status: 400 });
  }

  await db.transaction.create({
    data: {
      userId: user.id,
      type: "plaything",
      amount: -cost,
      method: product.modelId,
    },
  });

  const record = await db.waveSpeedGeneration.create({
    data: {
      userId: user.id,
      productId: product.id,
      prompt,
      params: JSON.stringify(params),
      cost,
      status: "pending",
    },
    include: { product: { select: playthingProductInclude } },
  });

  void processWaveSpeedGeneration(record.id);

  return NextResponse.json(playthingGenerationOut(record), { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlaythingAccess(user)) {
    return NextResponse.json({ error: "无玩物专区访问权限" }, { status: 403 });
  }

  const gens = await db.waveSpeedGeneration.findMany({
    where: { userId: user.id },
    include: { product: { select: playthingProductInclude } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  return NextResponse.json(gens.map(playthingGenerationOut));
}
