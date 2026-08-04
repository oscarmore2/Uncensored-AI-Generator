import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/secret-crypto";
import { providerAccountOut } from "@/lib/provider-account-serialize";
import { getAdapter, PROVIDER_IDS, PROVIDER_LIST, toProviderId } from "@/lib/providers";

/**
 * 各生成渠道的 API Key。
 *
 * 「激活」是按渠道各算各的：WaveSpeed 与 Atlas Cloud 各自最多一个激活账户，
 * 激活其中一家不会把另一家停掉。
 */

export async function GET(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // 不带 provider 时返回全部：管理端一次拉齐，切 tab 不再打第二次请求
  const raw = new URL(req.url).searchParams.get("provider");
  const filter = raw && PROVIDER_IDS.includes(raw as never) ? toProviderId(raw) : null;

  const accounts = await db.providerAccount.findMany({
    where: filter ? { provider: filter } : undefined,
    orderBy: [{ provider: "asc" }, { isActive: "desc" }, { createdAt: "desc" }],
  });

  const providers = PROVIDER_LIST.filter((p) => !filter || p.id === filter).map((p) => {
    const adapter = getAdapter(p.id);
    const envKey = adapter.envApiKey();
    const hasActiveDb = accounts.some((a) => toProviderId(a.provider) === p.id && a.isActive);
    return {
      id: p.id,
      label: p.label,
      short_label: p.shortLabel,
      key_url: p.keyUrl,
      supports_dynamic_pricing: p.supportsDynamicPricing,
      accent: p.accentClass,
      base_url: adapter.envBaseUrl(),
      env_fallback: {
        configured: Boolean(envKey),
        api_key_mask: envKey ? maskSecret(envKey) : null,
        in_use: !hasActiveDb && Boolean(envKey),
      },
      configured: hasActiveDb || Boolean(envKey),
    };
  });

  return NextResponse.json({
    accounts: accounts.map(providerAccountOut),
    providers,
    note: "每个渠道同一时间仅一个 Key 激活；该渠道无激活账户时回退对应的 .env Key。两个渠道互不影响。",
  });
}

const createSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  label: z.string().min(1).max(80),
  api_key: z.string().min(8).max(500),
  activate: z.boolean().optional().default(false),
  verify: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const data = parsed.data;
  const provider = toProviderId(data.provider);

  let verifyWarning: string | null = null;
  if (data.verify) {
    try {
      await getAdapter(provider).testKey(data.api_key);
    } catch (err) {
      verifyWarning = err instanceof Error ? err.message : String(err);
    }
  }

  const account = await db.$transaction(async (tx) => {
    if (data.activate) {
      // 只停用同一渠道的其它账户
      await tx.providerAccount.updateMany({
        where: { provider, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.providerAccount.create({
      data: {
        provider,
        label: data.label,
        apiKeyEnc: encryptSecret(data.api_key),
        isActive: data.activate,
      },
    });
  });

  return NextResponse.json(
    {
      ok: true,
      account: providerAccountOut(account),
      ...(verifyWarning ? { warning: verifyWarning } : {}),
    },
    { status: 201 }
  );
}
