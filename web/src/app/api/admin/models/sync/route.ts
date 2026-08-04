import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { syncProviderCatalog, toProviderId } from "@/lib/providers";
import { ensureDefaultPlaythingProducts } from "@/lib/wavespeed-seed";

/**
 * 同步一个渠道的全库模型。
 * 一次只同步一个：Atlas 要额外抓三百多个 schema 文件，
 * 两家一起跑会让请求超时，管理员也看不出是哪家失败的。
 */
export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
  const provider = toProviderId(body?.provider);

  try {
    const result = await syncProviderCatalog(provider);
    // 首期默认货架只针对 WaveSpeed；Atlas 的货架完全由管理端手工上架
    const seeded = provider === "wavespeed" ? await ensureDefaultPlaythingProducts() : 0;
    const payload = { ...result, seeded };
    await logAdminAction(admin.id, "provider_sync", { type: "ProviderCatalog", id: provider }, payload);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
