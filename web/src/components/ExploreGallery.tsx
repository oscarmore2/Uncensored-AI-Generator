"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { WorkMedia } from "./WorkMedia";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { GENERATION_MODES } from "@/lib/generation-modes";
import { WorkDetail } from "./WorkDetail";
import { ShareButton } from "./ShareButton";

export type ExploreWork = {
  id: number;
  title: string | null;
  mode: string;
  prompt: string;
  /** 游客只拿到两行摘要（服务端截的），前端据此画渐变遮罩 */
  prompt_truncated?: boolean;
  negative_prompt: string | null;
  params: Record<string, unknown>;
  media_url: string;
  thumb_url: string | null;
  is_adult: boolean;
  created_at: string;
};

// 有译名的模式；缺译名时角标退回原始 mode 字符串，不至于空着。
// 从模式定义派生而不是手抄——抄一份就得记着每次加模式都回来补
const MODE_KEYS = new Set<string>(GENERATION_MODES);

function referenceMedia(params: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (!/image|reference|source|input/i.test(key)) continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (typeof item === "string" && (/^https?:\/\//i.test(item) || item.startsWith("data:image/"))) {
        found.push(item);
      }
    }
  }
  return found.slice(0, 6);
}

export function ExploreGallery({
  works,
  signedIn,
}: {
  works: ExploreWork[];
  signedIn: boolean;
}) {
  const t = useTranslations("Explore");
  const router = useRouter();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<ExploreWork | null>(null);
  useBodyScrollLock(Boolean(selected));

  function reveal(id: number) {
    setRevealed((current) => new Set(current).add(id));
  }

  function open(work: ExploreWork) {
    if (work.is_adult && !revealed.has(work.id)) return;
    setSelected(work);
  }

  function remix(work: ExploreWork) {
    const makePath = `/make?remix_work=${work.id}`;
    if (!signedIn) {
      router.push(`/login?mode=register&next=${encodeURIComponent(makePath)}`);
      return;
    }
    router.push(makePath);
  }

  const refs = useMemo(() => selected ? referenceMedia(selected.params) : [], [selected]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {works.map((work) => {
          const locked = work.is_adult && !revealed.has(work.id);
          return (
            <article
              key={work.id}
              onClick={() => open(work)}
              className={`result-card group relative aspect-[3/4] overflow-hidden rounded-3xl border border-line bg-surface ${
                locked ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <WorkMedia
                mode={work.mode}
                src={work.thumb_url ?? work.media_url}
                autoPlay={!work.is_adult}
                asThumbnail
                className={`h-full w-full object-cover transition duration-300 ${
                  locked ? "scale-110 blur-2xl" : "group-hover:scale-105"
                }`}
              />
              <div className="absolute left-3 top-3 flex gap-1.5">
                <span className="media-badge">{MODE_KEYS.has(work.mode) ? t(`modes.${work.mode}` as "modes.txt2img") : work.mode}</span>
                {work.is_adult && (
                  <span className="rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
                )}
              </div>
              {locked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 p-4 text-center">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      reveal(work.id);
                    }}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/70 text-xl text-white hover:bg-black/85"
                    aria-label={t("showAdultAria")}
                  >
                    <i className="fas fa-eye" />
                  </button>
                  <p className="text-on-media mt-3 text-xs font-medium">{t("showAdult")}</p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent pt-10 pb-4 px-4">
                <p className="text-on-media line-clamp-2 text-xs font-medium">
                  {work.title ?? work.prompt}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center scrim-media p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogAria")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          {/*
            外观与画廊逻辑共用 WorkDetail；探索页独有的参考图区块走 extra 插槽。
            公共作品只有一条 mediaUrl，天然是单件，不会出现缩略图条。
          */}
          <div className="modal-pop w-full max-w-6xl">
            <WorkDetail
              source={{ work: selected.id }}
              mode={MODE_KEYS.has(selected.mode) ? t(`modes.${selected.mode}` as "modes.txt2img") : selected.mode}
              urls={[selected.media_url]}
              title={selected.title ?? t("communityWork")}
              timestamp={new Date(selected.created_at).toISOString().slice(0, 19).replace("T", " ")}
              prompt={selected.prompt}
              promptTruncated={Boolean(selected.prompt_truncated)}
              promptCtaHref={`/login?mode=register&next=${encodeURIComponent(`/explore/${selected.id}`)}`}
              negativePrompt={selected.negative_prompt}
              params={selected.params}
              adult={selected.is_adult}
              onClose={() => setSelected(null)}
              fullPageHref={`/explore/${selected.id}`}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => remix(selected)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-black/[0.03] py-3 font-semibold hover:bg-black/[0.06]"
                  >
                    <i className="fas fa-copy" />
                    {signedIn ? t("copyToGenerator") : t("registerToCopy")}
                  </button>
                  {/* 公共作品的分享链接由 id 直接拼出来，不走接口——
                      游客也能分享，这正是这条链路的价值所在 */}
                  {!selected.is_adult && (
                    <ShareButton
                      kind="work"
                      id={selected.id}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm hover:bg-black/[0.04]"
                    />
                  )}
                </>
              }
              extra={
                refs.length > 0 ? (
                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-subtle">
                      {t("referenceImages")}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {refs.map((src, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${src.slice(0, 60)}-${index}`}
                          src={src}
                          alt={t("referenceAlt", { number: index + 1 })}
                          className="aspect-square w-full rounded-xl border border-line object-cover"
                        />
                      ))}
                    </div>
                  </div>
                ) : null
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
