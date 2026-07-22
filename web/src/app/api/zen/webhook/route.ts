import { NextResponse } from "next/server";
import { z } from "zod";
import { applyZenJobUpdate } from "@/lib/zen";

/**
 * 预留 Webhook 入口。
 * Zen 官方文档目前写明「尚无 webhook，需轮询」；若日后支持或你自建中转，
 * 可 POST 到此路径，按 zen_job_id 更新本地 Generation 状态与进度。
 *
 * 可选鉴权：请求头 X-Zen-Webhook-Secret 需等于环境变量 ZEN_WEBHOOK_SECRET（若已配置）。
 */
const bodySchema = z.object({
  zen_job_id: z.string().min(1).max(120),
  status: z.string().min(1).max(40),
  progress: z.number().int().min(0).max(100).optional(),
  error: z.string().max(500).nullable().optional(),
  result_urls: z.array(z.string().url()).max(20).optional(),
});

export async function POST(req: Request) {
  const expected = process.env.ZEN_WEBHOOK_SECRET;
  if (expected) {
    const got = req.headers.get("x-zen-webhook-secret");
    if (got !== expected) {
      return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const ok = await applyZenJobUpdate({
    zenJobId: parsed.data.zen_job_id,
    status: parsed.data.status,
    progress: parsed.data.progress,
    error: parsed.data.error,
    resultUrls: parsed.data.result_urls,
  });

  if (!ok) {
    return NextResponse.json({ error: "No matching generation or already terminal" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
