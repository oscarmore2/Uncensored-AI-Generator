import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generationSchema } from "@/lib/validators";
import { processGeneration } from "@/lib/generation-runner";
import {
  SpicyRequiresVipError,
  VipRankTooLowError,
  isVipActive,
  resolveGenerationQuote,
} from "@/lib/pricing";
import { generationOut } from "@/lib/serialize";
import { rateLimit } from "@/lib/rate-limit";
import { isAdultContent, isBlocked, reviewPrompt, safetyAudit } from "@/lib/content-safety";
import { hasAdultAccess } from "@/lib/adult-access";
import { generatedMediaExpiry } from "@/lib/media-retention";
import { resolveUndressPrompts } from "@/lib/undress-prompts";
import {
  hasUndressAdvancedAccess,
  normalizeUndressAdvanced,
} from "@/lib/undress-options";

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

  if (gen.mode === "undress" && !adultAccess) {
    return NextResponse.json(
      { error: "脱衣模式需要开启成人模式", code: "ADULT_MODE_REQUIRED" },
      { status: 403 }
    );
  }

  // 脱衣模式：忽略客户端 prompt，按性别 +（VIP2）高级选项注入系统预定正负向词
  let prompt = gen.prompt.trim();
  let negativePrompt = gen.negative_prompt;
  let undressOptions = null as ReturnType<typeof normalizeUndressAdvanced> | null;
  if (gen.mode === "undress") {
    const vipOk =
      gen.gender === "female" &&
      hasUndressAdvancedAccess(isVipActive(user), user.vipTier?.code);
    undressOptions = vipOk
      ? normalizeUndressAdvanced(gen.undress_options ?? null)
      : normalizeUndressAdvanced(null);
    const pair = resolveUndressPrompts(gen.gender!, undressOptions);
    prompt = pair.prompt;
    negativePrompt = pair.negative_prompt;
  }

  // 分级判定：擦边放行、露骨需成人模式、未成年/非自愿绝对拒绝。
  // 分类器全部不可用时 reviewPrompt 会回退本地规则结论，不再抛错阻断。
  const safety = await reviewPrompt({ mode: gen.mode, prompt });
  const isAdult = gen.mode === "undress" ? true : isAdultContent(safety);
  const safetyCategories = safetyAudit(safety);
  if (isBlocked(safety, adultAccess)) {
    return NextResponse.json(
      {
        error: `内容审查未通过：${safety.reason}`,
        code: "CONTENT_POLICY_REJECTED",
        level: safety.level,
        categories: safety.categories,
      },
      { status: 422 }
    );
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
    if (error instanceof SpicyRequiresVipError || error instanceof VipRankTooLowError) {
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

  // 复用历史参考图：必须是本人名下、且尚未被清理的那一条，
  // 否则等于开了一个「让服务端去下载任意 URL」的口子
  let reusedImageUrl: string | null = null;
  if (gen.image_url && !gen.image_base64) {
    const asset = await db.mediaAsset.findFirst({
      where: {
        userId: user.id,
        url: gen.image_url,
        kind: "upload",
        deletedAt: null,
      },
      select: { url: true },
    });
    if (!asset) {
      return NextResponse.json(
        { error: "所选参考图已不可用，请重新上传", code: "REUSED_IMAGE_UNAVAILABLE" },
        { status: 400 }
      );
    }
    reusedImageUrl = asset.url;
  }

  // 按字段提交的输入媒体走同一道校验：每条 URL 都必须是本人名下、未被清理的
  // MediaAsset，否则这个接口就成了「让服务端去抓任意外链」的口子
  const mediaFields: Record<string, string[]> = {};
  const allMediaUrls = Object.values(gen.media ?? {}).flat();
  if (allMediaUrls.length > 0) {
    const owned = await db.mediaAsset.findMany({
      where: {
        userId: user.id,
        url: { in: Array.from(new Set(allMediaUrls)) },
        kind: "upload",
        deletedAt: null,
      },
      select: { url: true },
    });
    const ownedSet = new Set(owned.map((a) => a.url));
    for (const [field, urls] of Object.entries(gen.media ?? {})) {
      const kept = urls.filter((u) => ownedSet.has(u));
      if (kept.length !== urls.length) {
        return NextResponse.json(
          { error: "部分输入媒体已不可用，请重新上传", code: "INPUT_MEDIA_UNAVAILABLE" },
          { status: 400 }
        );
      }
      if (kept.length) mediaFields[field] = kept;
    }
  }

  const cost = quote.cost;
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

  // schema 控件里的 strength / format / steps 等会随 body 一并提交；
  // zod 会剥掉未知键，这里从原始 body 回收可序列化的 UI 参数。
  const reserved = new Set([
    "mode",
    "tier",
    "spicy",
    "prompt",
    "negative_prompt",
    "gender",
    "undress_options",
    "ratio",
    "duration",
    "seed",
    "batch",
    "image_base64",
    "image_filename",
    "image_url",
    "media",
  ]);
  const extraUi: Record<string, unknown> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (reserved.has(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        extraUi[key] = value;
      }
    }
  }

  const record = await db.generation.create({
    data: {
      userId: user.id,
      mode: gen.mode,
      tier: quote.product.tier,
      spicy: quote.product.spicy,
      productId: quote.product.id,
      prompt,
      negativePrompt,
      params: JSON.stringify({
        ratio: gen.ratio,
        duration: gen.duration,
        seed: gen.seed,
        batch: gen.batch,
        image_base64: gen.image_base64 ?? null,
        ...(gen.image_filename ? { image_filename: gen.image_filename } : {}),
        ...(Object.keys(mediaFields).length ? { media_fields: mediaFields } : {}),
        // input_urls 是作品页缩略图与「套用」唯一的线索，按字段提交的媒体也要汇进来
        ...(reusedImageUrl || Object.keys(mediaFields).length
          ? {
              input_urls: [
                ...(reusedImageUrl ? [reusedImageUrl] : []),
                ...Object.values(mediaFields).flat(),
              ],
            }
          : {}),
        ...(gen.mode === "undress" && gen.gender ? { gender: gen.gender } : {}),
        ...(gen.mode === "undress" && undressOptions ? { undress_options: undressOptions } : {}),
        ...extraUi,
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
