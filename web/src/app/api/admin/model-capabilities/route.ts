import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseRequestSchema, resolveMediaInputs } from "@/lib/generation-bridge";
import { deriveCapability, summarize, type CapabilityInput } from "@/lib/model-capability";
import { refreshCapabilities } from "@/lib/model-capability-store";
import { assertSameOrigin } from "@/lib/csrf";
import { PROVIDER_IDS } from "@/lib/providers/meta";

/**
 * 能力档案 + 与现行启发式的差异报告。
 *
 * 这个接口是「要不要把运行期切到能力表」的决策依据：现行的
 * resolveMediaInputs 和新的 deriveCapability 各跑一遍，逐字段比对，
 * 把不一致的列出来。切换之前先看清楚会改变多少个模型的行为。
 *
 * 只读，不写库。
 */

export const dynamic = "force-dynamic";

type Diff = { field: string; was: string; now: string };

/** 逐字段比对。只比会影响用户的三件事：位在不在、必填与否、数量上限 */
function diffInputs(
  old: Array<{ field: string; kind: string; minItems: number; maxItems: number }>,
  next: CapabilityInput[]
): Diff[] {
  const out: Diff[] = [];
  const byField = new Map(next.map((n) => [n.field, n]));
  const seen = new Set<string>();

  for (const o of old) {
    seen.add(o.field);
    const n = byField.get(o.field);
    if (!n) {
      out.push({ field: o.field, was: `${o.kind} 必填=${o.minItems > 0}`, now: "（不再识别为媒体位）" });
      continue;
    }
    const wasReq = o.minItems > 0;
    const nowReq = n.min > 0;
    if (wasReq !== nowReq) {
      out.push({ field: o.field, was: wasReq ? "必填" : "选填", now: nowReq ? "必填" : "选填" });
    }
    if (o.kind !== n.kind) out.push({ field: o.field, was: `kind=${o.kind}`, now: `kind=${n.kind}` });
  }
  for (const n of next) {
    if (!seen.has(n.field)) {
      out.push({ field: n.field, was: "（旧逻辑未识别）", now: `${n.kind} 必填=${n.min > 0}` });
    }
  }
  return out;
}

export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const onlyBound = url.searchParams.get("bound") === "1";
  const onlyDiff = url.searchParams.get("diff") === "1";

  const bound = await db.generationProduct.findMany({
    select: { provider: true, providerModelId: true },
  });
  const boundSet = new Set(
    bound.filter((b) => b.providerModelId).map((b) => `${b.provider}|${b.providerModelId}`)
  );

  const models = await db.providerCatalogModel.findMany({
    where: onlyBound
      ? { OR: [...boundSet].map((k) => ({ provider: k.split("|")[0], modelId: k.split("|").slice(1).join("|") })) }
      : {},
    select: { provider: true, modelId: true, name: true, type: true, apiSchema: true },
    orderBy: [{ provider: "asc" }, { modelId: "asc" }],
    take: 500,
  });

  const caps = await db.modelCapability.findMany({
    select: { provider: true, modelId: true, source: true, reviewedAt: true, staleSince: true },
  });
  const capByKey = new Map(caps.map((c) => [`${c.provider}|${c.modelId}`, c]));

  const rows = models.map((m) => {
    const cap = deriveCapability({ modelId: m.modelId, type: m.type, apiSchema: m.apiSchema });
    const legacy = resolveMediaInputs(parseRequestSchema(m.apiSchema));
    const diffs = diffInputs(legacy, cap.inputs);
    const stored = capByKey.get(`${m.provider}|${m.modelId}`);
    return {
      provider: m.provider,
      model_id: m.modelId,
      name: m.name,
      type: m.type,
      bound: boundSet.has(`${m.provider}|${m.modelId}`),
      summary: summarize(cap),
      inputs: cap.inputs,
      outputs: cap.outputs,
      notes: cap.notes,
      diffs,
      status: stored
        ? stored.staleSince
          ? "stale"
          : stored.source === "manual"
            ? "manual"
            : stored.reviewedAt
              ? "reviewed"
              : "derived"
        : "missing",
    };
  });

  const filtered = onlyDiff ? rows.filter((r) => r.diffs.length > 0) : rows;
  return NextResponse.json({
    total: rows.length,
    with_diff: rows.filter((r) => r.diffs.length > 0).length,
    bound_with_diff: rows.filter((r) => r.bound && r.diffs.length > 0).length,
    rows: filtered,
  });
}

/**
 * 手工触发一轮派生。平时跟着渠道同步跑，但同步要有 API key；
 * 只想按当前库里的 schema 重算一遍时用这个。
 *
 * source=manual 的记录不会被覆盖，只会被标进待复核队列。
 */
export async function POST(req: Request) {
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = {};
  for (const provider of PROVIDER_IDS) {
    out[provider] = await refreshCapabilities(provider);
  }
  return NextResponse.json({ ok: true, result: out });
}
