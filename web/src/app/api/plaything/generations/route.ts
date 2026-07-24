import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPlaythingAccess } from "@/lib/plaything-access";
import { processWaveSpeedGeneration, resolvePlaythingQuote } from "@/lib/wavespeed";
import { playthingGenerationOut, playthingProductInclude } from "@/lib/plaything-serialize";
import { rateLimit } from "@/lib/rate-limit";

const createSchema = z.object({
  product_id: z.number().int().positive(),
  prompt: z.string().max(8000).optional().default(""),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  image_base64: z.string().max(12_000_000).nullable().optional(),
});

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
    include: { catalogModel: { select: { type: true } } },
  });
  if (!product) {
    return NextResponse.json({ error: "模型未上架或不存在" }, { status: 404 });
  }

  const { cost } = resolvePlaythingQuote(product.creditCost);
  const prompt = parsed.data.prompt.trim();
  const params: Record<string, unknown> = { ...(parsed.data.params ?? {}) };
  if (parsed.data.image_base64) {
    params.image_base64 = parsed.data.image_base64;
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
