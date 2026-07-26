import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generationSchema } from "@/lib/validators";
import { processGeneration } from "@/lib/generation-runner";
import { SpicyRequiresVipError, isVipActive, resolveGenerationQuote } from "@/lib/pricing";
import { generationOut } from "@/lib/serialize";
import { rateLimit } from "@/lib/rate-limit";
import { hasAlwaysBlockedCategory, reviewPromptWithHarness } from "@/lib/content-safety";
import { hasAdultAccess } from "@/lib/adult-access";
import { generatedMediaExpiry } from "@/lib/media-retention";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`gen:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "生成请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = generationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const gen = parsed.data;
  const adultAccess = hasAdultAccess(user);
  let isAdult = false;
  let safetyCategories: string[] = [];
  try {
    const safety = await reviewPromptWithHarness({
      mode: gen.mode,
      prompt: gen.prompt,
    });
    isAdult = !safety.allowed;
    safetyCategories = safety.categories;
    if (isAdult && (!adultAccess || hasAlwaysBlockedCategory(safety.categories))) {
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
    if (!adultAccess) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "内容审查服务暂不可用" },
        { status: 503 }
      );
    }
    // 成人模式不因分类器不可用而阻断；保守标记为 18+。
    isAdult = true;
    safetyCategories = ["unclassified_adult_mode"];
  }

  let quote;
  try {
    quote = await resolveGenerationQuote({
      mode: gen.mode,
      tier: gen.tier,
      spicy: gen.spicy,
      batch: gen.batch,
      durationSeconds: gen.duration != null ? Number(gen.duration) : null,
      user,
    });
  } catch (error) {
    if (error instanceof SpicyRequiresVipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "档位不可用" },
      { status: 400 }
    );
  }

  if (!quote.product.providerModelId.trim()) {
    return NextResponse.json(
      { error: "该档位暂未开放，请稍后再试", code: "TIER_UNAVAILABLE" },
      { status: 503 }
    );
  }

  const cost = quote.cost;
  const prompt = gen.prompt.trim();
  const ownerVipAtCreation = isVipActive(user);
  const mediaExpiresAt = await generatedMediaExpiry("main", ownerVipAtCreation);

  const charged = await db.user.updateMany({
    where: { id: user.id, balance: { gte: cost } },
    data: { balance: { decrement: cost } },
  });
  if (charged.count === 0) {
    return NextResponse.json(
      { error: "点数不足，请先充值", code: "INSUFFICIENT_CREDITS" },
      { status: 400 }
    );
  }

  const record = await db.generation.create({
    data: {
      userId: user.id,
      mode: gen.mode,
      tier: quote.product.tier,
      spicy: quote.product.spicy,
      productId: quote.product.id,
      prompt,
      negativePrompt: gen.negative_prompt,
      params: JSON.stringify({
        ratio: gen.ratio,
        duration: gen.duration,
        seed: gen.seed,
        batch: gen.batch,
        image_base64: gen.image_base64 ?? null,
      }),
      cost,
      isAdult,
      safetyCategories: JSON.stringify(safetyCategories),
      ownerVipAtCreation,
      retentionAssigned: true,
      mediaExpiresAt,
      status: "pending",
    },
  });

  void processGeneration(record.id);

  return NextResponse.json(generationOut(record), { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gens = await db.generation.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(gens.map(generationOut));
}
