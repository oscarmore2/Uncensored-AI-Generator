import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { templateCreateSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { encodeDraftSnapshot, type SnapshotMedia } from "@/lib/draft-snapshot";
import { detectMediaKindFromUrl } from "@/lib/plaything-categories";

/** 一个用户最多存多少模板 */
const MAX_TEMPLATES = 100;

function templateOut(t: {
  id: number;
  mode: string;
  tier: string | null;
  spicy: boolean;
  name: string;
  prompt: string;
  negativePrompt: string | null;
  snapshot: string;
  sourceGenerationId: number | null;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    mode: t.mode,
    tier: t.tier,
    spicy: t.spicy,
    name: t.name,
    prompt: t.prompt,
    negative_prompt: t.negativePrompt,
    snapshot: t.snapshot,
    source_generation_id: t.sourceGenerationId,
    use_count: t.useCount,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mode = new URL(req.url).searchParams.get("mode");
  const rows = await db.promptTemplate.findMany({
    where: { userId: user.id, ...(mode ? { mode } : {}) },
    orderBy: { updatedAt: "desc" },
    take: MAX_TEMPLATES,
  });
  return NextResponse.json(rows.map(templateOut));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`tpl:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = templateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;

  const count = await db.promptTemplate.count({ where: { userId: user.id } });
  if (count >= MAX_TEMPLATES) {
    return NextResponse.json(
      { error: `模板数量已达上限（${MAX_TEMPLATES}）` },
      { status: 400 }
    );
  }

  let seed: {
    mode: string;
    tier: string | null;
    spicy: boolean;
    prompt: string;
    negativePrompt: string | null;
    snapshot: string;
    productId: number | null;
    providerModelId: string | null;
  };

  if (d.from_generation_id) {
    // 从已完成的作品存。带 userId 查，不能拿别人的作品做模板
    const gen = await db.generation.findFirst({
      where: { id: d.from_generation_id, userId: user.id, deletedAt: null },
    });
    if (!gen) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    seed = {
      mode: gen.mode,
      tier: gen.tier,
      spicy: gen.spicy,
      prompt: gen.prompt,
      negativePrompt: gen.negativePrompt,
      snapshot: snapshotFromGenerationParams(gen.params),
      productId: gen.productId,
      providerModelId: null,
    };
  } else if (d.from_draft_id) {
    const draft = await db.draft.findFirst({ where: { id: d.from_draft_id, userId: user.id } });
    if (!draft) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
    seed = {
      mode: draft.mode,
      tier: draft.tier,
      spicy: draft.spicy,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      snapshot: draft.snapshot,
      productId: draft.productId,
      providerModelId: draft.providerModelId,
    };
  } else {
    seed = {
      mode: d.mode as string,
      tier: d.tier ?? null,
      spicy: d.spicy ?? false,
      prompt: d.prompt ?? "",
      negativePrompt: d.negative_prompt ?? null,
      snapshot: d.snapshot ?? "{}",
      productId: d.product_id ?? null,
      providerModelId: d.provider_model_id ?? null,
    };
  }

  const created = await db.promptTemplate.create({
    data: {
      userId: user.id,
      name: d.name,
      sourceGenerationId: d.from_generation_id ?? null,
      sourceDraftId: d.from_draft_id ?? null,
      ...seed,
    },
  });
  return NextResponse.json(templateOut(created), { status: 201 });
}

/**
 * 把一条生成记录的 params 折成快照。
 *
 * 只取能还原到表单的东西：媒体按字段分组、标量参数进 extraParams。
 * base64 参考图一律不要——那是几 MB 的 data URL，而且生成时早已换成
 * 对象存储 URL 存在 media_fields / input_urls 里。
 */
function snapshotFromGenerationParams(raw: string): string {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return "{}";
  }

  const media: Record<string, SnapshotMedia[]> = {};
  const fields = params.media_fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      const urls = (Array.isArray(value) ? value : [value]).filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)
      );
      if (!urls.length) continue;
      media[field] = urls.map((url, i) => ({
        id: `g${i}-${url.slice(-12)}`,
        url,
        name: url.split("/").pop()?.split(/[?#]/)[0] ?? "media",
        kind: detectMediaKindFromUrl(url, "image") as SnapshotMedia["kind"],
      }));
    }
  }

  const SKIP = new Set([
    "image_base64",
    "image_filename",
    "input_urls",
    "result_thumb_urls",
    "media_fields",
    "product_id",
    "tier",
    "spicy",
  ]);
  const extraParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (SKIP.has(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      extraParams[k] = String(v);
    }
  }

  return encodeDraftSnapshot({
    media,
    extraParams,
    ratio: typeof params.ratio === "string" ? params.ratio : "1:1",
    duration: typeof params.duration === "string" ? params.duration : "5",
    gender: typeof params.gender === "string" ? params.gender : "female",
  });
}
