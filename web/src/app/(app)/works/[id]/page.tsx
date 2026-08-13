import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { WorkReuseActions } from "@/components/WorkReuseActions";
import { WorkDetail } from "@/components/WorkDetail";
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

  // 名字不能叫 params——那是本页的路由参数，会把上面的 await params 遮掉
  let genParams: Record<string, unknown> = {};
  try {
    genParams = JSON.parse(gen.params) as Record<string, unknown>;
  } catch {
    // params 非法 JSON 时不展示；过滤 base64 由 WorkDetail 统一处理
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <Link href="/history" className="text-sm text-ink-muted hover:text-ink">
        <i className="fas fa-arrow-left mr-2" />
        {t("title")}
      </Link>

      <div className="mt-5">
        <WorkDetail
          layout="page"
          source={{ gen: gen.id }}
          mode={gen.mode}
          urls={gen.status === "succeeded" ? resultUrls : []}
          title={`#${gen.id}`}
          timestamp={gen.createdAt.toISOString().slice(0, 19).replace("T", " ")}
          prompt={gen.prompt}
          negativePrompt={gen.negativePrompt}
          params={genParams}
          spicy={gen.spicy}
          adult={gen.isAdult}
          cost={gen.cost}
          expiresAt={gen.mediaExpiresAt?.toISOString() ?? null}
          deletedAt={gen.mediaDeletedAt?.toISOString() ?? null}
          emptyHint={gen.mediaDeletedAt ? t("mediaDeleted") : t("processingOrFailed")}
          actions={<WorkReuseActions generationId={gen.id} />}
        />
      </div>
    </div>
  );
}
