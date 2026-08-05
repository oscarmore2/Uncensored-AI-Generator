import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { WorkReuseActions } from "@/components/WorkReuseActions";
import { downloadExtOf } from "@/lib/plaything-categories";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

/** 自己的作品页面不该被搜索引擎收录 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * 自有作品的整页视图。
 *
 * 弹窗里 3D 只能挤在一个 max-h-[90vh] 的框里，模型转起来实在看不清；
 * 这里给它整屏，同时把提示词与参数摊开——和 /explore/[id] 是同一套读法，
 * 区别是这条只认自己的作品，不需要曝光也能看。
 */
export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const genId = Number(id);
  if (!Number.isInteger(genId) || genId <= 0) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/works/${genId}`)}`);

  // 只查本人名下且未软删的，避免把 id 当成可枚举的越权入口
  const gen = await db.generation.findFirst({
    where: { id: genId, userId: user.id, deletedAt: null },
  });
  if (!gen) notFound();

  const t = await getTranslations("History");
  const resultUrls: string[] = gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : [];

  let paramEntries: [string, unknown][] = [];
  try {
    const raw = JSON.parse(gen.params) as Record<string, unknown>;
    // base64 参考图有几 MB，摊在参数表里既没意义又会把页面撑爆
    paramEntries = Object.entries(raw).filter(
      ([k, v]) => k !== "image_base64" && !(typeof v === "string" && v.startsWith("data:"))
    );
  } catch {
    // params 非法 JSON 时不展示
  }

  const primary = resultUrls[0];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <Link href="/history" className="text-sm text-ink-muted hover:text-ink">
        <i className="fas fa-arrow-left mr-2" />
        {t("title")}
      </Link>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="overflow-hidden rounded-3xl border border-line bg-surface">
            {gen.status === "succeeded" && resultUrls.length ? (
              <AdaptiveMedia mode={gen.mode} urls={resultUrls} />
            ) : (
              <div className="fake-image flex h-80 items-center justify-center rounded-2xl text-center">
                <div>
                  {gen.mediaDeletedAt ? t("mediaDeleted") : t("processingOrFailed")}
                  <br />
                  <span className="text-xs">{gen.status}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="media-badge">{gen.mode}</span>
              {gen.spicy && (
                <span className="rounded-full bg-fuchsia-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  SPICY
                </span>
              )}
              {gen.isAdult && (
                <span className="rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  18+
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">#{gen.id}</h1>
            <div className="mt-2">
              <MediaExpiryBadge
                expiresAt={gen.mediaExpiresAt?.toISOString() ?? null}
                deletedAt={gen.mediaDeletedAt?.toISOString() ?? null}
              />
            </div>
          </div>

          {gen.prompt.trim() && (
            <div className="glass rounded-3xl p-5">
              <div className="mb-2 text-xs font-semibold text-ink-muted">PROMPT</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{gen.prompt}</p>
            </div>
          )}

          {gen.negativePrompt?.trim() && (
            <div className="glass rounded-3xl p-5">
              <div className="mb-2 text-xs font-semibold text-ink-muted">NEGATIVE PROMPT</div>
              <p className="text-sm text-ink-muted">{gen.negativePrompt}</p>
            </div>
          )}

          {paramEntries.length > 0 && (
            <div className="glass rounded-3xl p-5">
              <div className="mb-3 text-xs font-semibold text-ink-muted">PARAMETERS</div>
              <div className="space-y-2 text-xs">
                {paramEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-x-4">
                    <span className="font-mono text-ink-muted">{k}</span>
                    <span className="break-all text-right font-mono">
                      {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {primary && (
              <a
                href={primary}
                download={`wanwankewu_${gen.id}.${downloadExtOf(primary)}`}
                target="_blank"
                rel="noopener"
                className="flex w-full items-center justify-center gap-x-2 rounded-2xl bg-orange-700 py-3 font-semibold text-white"
              >
                <i className="fas fa-download" /> {t("download")}
              </a>
            )}
            <WorkReuseActions generationId={gen.id} />
          </div>

          {/* 3D 常常还带源文件包与预览图，全列出来，别让用户以为只有一个文件 */}
          {resultUrls.length > 1 && (
            <div className="glass rounded-3xl p-5">
              <div className="mb-3 text-xs font-semibold text-ink-muted">FILES</div>
              <ul className="space-y-2 text-xs">
                {resultUrls.map((u, i) => (
                  <li key={`${u}-${i}`}>
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener"
                      className="font-mono text-orange-700 hover:underline"
                    >
                      .{downloadExtOf(u)}
                      <span className="ml-2 break-all text-ink-subtle">
                        {u.split("/").pop()?.slice(0, 48)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
