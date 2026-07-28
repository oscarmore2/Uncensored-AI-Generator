import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseTags } from "@/lib/model-tags";

/** 档位 → 模型库里合适的关键词，仅用于给候选排序，不做过滤 */
const MODE_HINTS: Record<string, RegExp> = {
  txt2img: /(text-to-image|t2i)/i,
  img2img: /(image-to-image|i2i|edit)/i,
  imgedit: /(edit|kontext|inpaint)/i,
  undress: /(edit|image-to-image|kontext|inpaint)/i,
  txt2vid: /(text-to-video|t2v)/i,
  img2vid: /(image-to-video|i2v)/i,
};

/** 档位 → 管理端可能贴的标签，命中则大幅提权 */
const MODE_TAG_HINTS: Record<string, string[]> = {
  txt2img: ["文生图"],
  img2img: ["图生图"],
  imgedit: ["图片编辑"],
  undress: ["图片编辑", "图生图"],
  txt2vid: ["文生视频"],
  img2vid: ["图生视频"],
};

const TIER_TAG_HINTS: Record<string, string[]> = {
  low: ["低档"],
  mid: ["中档"],
  high: ["高档"],
};

/**
 * 管理端绑定模型时的候选列表。
 * 仅管理员可见 —— 生成端任何接口都不返回 model_id。
 * 排序会优先照顾「玩物专区 → 模型库」里手工贴的标签。
 */
export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = (url.searchParams.get("mode") ?? "").trim();
  const tier = (url.searchParams.get("tier") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const spicy = url.searchParams.get("spicy") === "1";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));

  const and = [];
  if (q) {
    and.push({
      OR: [
        { modelId: { contains: q, mode: "insensitive" as const } },
        { name: { contains: q, mode: "insensitive" as const } },
        { type: { contains: q, mode: "insensitive" as const } },
      ],
    });
  }
  // tags 存 JSON 数组字符串，带引号整词匹配，避免 "高档" 命中 "高档次"
  if (tag) and.push({ tags: { contains: `"${tag}"`, mode: "insensitive" as const } });

  const models = await db.waveSpeedCatalogModel.findMany({
    where: and.length ? { AND: and } : undefined,
    select: {
      modelId: true,
      name: true,
      type: true,
      tags: true,
      basePriceUsd: true,
      lastUnitPriceUsd: true,
    },
    orderBy: { modelId: "asc" },
    take: 800,
  });

  const modeHint = MODE_HINTS[mode];
  const modeTags = (MODE_TAG_HINTS[mode] ?? []).map((t) => t.toLowerCase());
  const tierTags = (TIER_TAG_HINTS[tier] ?? []).map((t) => t.toLowerCase());

  const scored = models
    .map((m) => {
      const tags = parseTags(m.tags);
      const lowerTags = tags.map((t) => t.toLowerCase());
      const haystack = `${m.modelId} ${m.name} ${m.type}`;

      let score = 0;
      // 手工标签的权重高于模型名猜测：运营贴过的分类最可信
      if (modeTags.some((t) => lowerTags.includes(t))) score += 40;
      if (tierTags.some((t) => lowerTags.includes(t))) score += 20;
      if (spicy && lowerTags.includes("spicy")) score += 25;
      if (!spicy && lowerTags.includes("spicy")) score -= 25;

      if (modeHint?.test(haystack)) score += 10;
      if (spicy && /(spicy|uncensored|nsfw)/i.test(haystack)) score += 5;
      if (!spicy && /(spicy|uncensored|nsfw)/i.test(haystack)) score -= 3;

      return { ...m, tags, score };
    })
    .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId))
    .slice(0, limit);

  const allTags = Array.from(new Set(models.flatMap((m) => parseTags(m.tags)))).sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN")
  );

  return NextResponse.json({
    models: scored.map((m) => ({
      model_id: m.modelId,
      name: m.name,
      type: m.type,
      tags: m.tags,
      base_price_usd: m.basePriceUsd,
      last_unit_price_usd: m.lastUnitPriceUsd,
    })),
    tags: allTags,
    total_synced: models.length,
  });
}
