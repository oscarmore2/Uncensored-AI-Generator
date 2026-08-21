import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdaptiveMedia } from "./WorkMedia";
import { BrandLogo } from "./BrandLogo";

/**
 * 分享页的展示面。给站外陌生人看的营销页，不是作品详情页。
 *
 * 只露一行提示词，其余参数一律不给——分享的目的是让人想点「我也来生成」，
 * 而不是让人抄走整套配方。
 *
 * **雾化区里放的是假内容，不是把真参数打上模糊。** CSS blur 只糊了像素，
 * 真值还在 HTML 里，随手一个「检查元素」就全看见了。既然要藏就别把它发出去。
 */

/** 只取第一行，并且是**服务端**截断——CSS 截断等于把整段照发 */
export function firstPromptLine(prompt: string, max = 90): string {
  const line = prompt.trim().split(/\r?\n/).find((l) => l.trim()) ?? "";
  const clean = line.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export async function SharePoster({
  mode,
  urls,
  poster,
  promptLine,
}: {
  mode?: string;
  urls: string[];
  poster?: string | null;
  /**
   * **已经截断好的那一行**，不是完整提示词。
   * 调用方先过 firstPromptLine 再传进来：组件根本拿不到完整文本，
   * 就不必再指望框架不把它序列化进页面。
   */
  promptLine: string;
}) {
  const t = await getTranslations("Share");
  const line = promptLine;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <BrandLogo href="/" />
          <Link
            href="/make"
            className="rounded-2xl bg-orange-700 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600"
          >
            {t("ctaShort")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="flex justify-center">
          <AdaptiveMedia mode={mode} urls={urls} poster={poster} />
        </div>

        {line && (
          <figure className="mt-6 rounded-3xl border border-line bg-surface p-5">
            <blockquote className="text-sm leading-relaxed text-ink">{line}</blockquote>
            <figcaption className="mt-2 text-[11px] text-ink-subtle">
              {t("promptCaption")}
            </figcaption>
          </figure>
        )}

        <FoggedParams label={t("paramsHidden")} />

        <div className="mt-8 text-center">
          <Link
            href="/make"
            className="inline-flex items-center gap-x-2 rounded-3xl bg-orange-700 px-8 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-orange-600"
          >
            <i className="fas fa-wand-magic-sparkles" />
            {t("cta")}
          </Link>
          <p className="mt-3 text-[11px] text-ink-subtle">{t("ctaHint")}</p>
        </div>
      </main>
    </div>
  );
}

/** 雾化的参数区。里面全是占位条，没有一个真值 */
function FoggedParams({ label }: { label: string }) {
  const rows = [
    { w: "w-20", v: "w-28" },
    { w: "w-16", v: "w-20" },
    { w: "w-24", v: "w-36" },
    { w: "w-14", v: "w-24" },
  ];
  return (
    <section className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-surface p-5">
      <div aria-hidden className="space-y-3 blur-[6px]">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className={`h-3 ${row.w} rounded-full bg-ink/20`} />
            <span className={`h-3 ${row.v} rounded-full bg-ink/10`} />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-surface/40">
        <span className="flex items-center gap-x-2 rounded-full border border-line bg-surface px-4 py-2 text-xs text-ink-muted shadow-sm">
          <i className="fas fa-lock text-[10px]" />
          {label}
        </span>
      </div>
    </section>
  );
}

/** 媒体已经过了保留期被清理掉时的落地页 */
export async function ShareExpired() {
  const t = await getTranslations("Share");
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-3">
          <BrandLogo href="/" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        <i className="fas fa-hourglass-end mb-5 text-5xl text-ink-subtle" />
        <h1 className="text-lg font-bold">{t("expiredTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{t("expiredBody")}</p>
        <Link
          href="/make"
          className="mt-8 inline-flex items-center gap-x-2 rounded-3xl bg-orange-700 px-8 py-3.5 text-sm font-semibold text-white hover:bg-orange-600"
        >
          <i className="fas fa-wand-magic-sparkles" />
          {t("cta")}
        </Link>
      </main>
    </div>
  );
}
