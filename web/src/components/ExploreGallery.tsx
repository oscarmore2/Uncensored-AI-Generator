"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdaptiveMedia, WorkMedia } from "./WorkMedia";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export type ExploreWork = {
  id: number;
  title: string | null;
  mode: string;
  prompt: string;
  negative_prompt: string | null;
  params: Record<string, unknown>;
  media_url: string;
  thumb_url: string | null;
  is_adult: boolean;
  created_at: string;
};

// 有译名的模式；缺译名时角标退回原始 mode 字符串，不至于空着
const MODE_KEYS = new Set([
  "txt2img",
  "txt2vid",
  "img2img",
  "img2vid",
  "imgedit",
  "undress",
  "vid2vid",
  "vidupscale",
  "vidextend",
  "lipsync",
  "faceswap",
  "txt23d",
  "img23d",
]);

function displayValue(value: unknown, inlineMedia: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.startsWith("data:") ? inlineMedia : text;
}

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
  const paramEntries = selected ? Object.entries(selected.params) : [];

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
            两栏各自滚动的关键是 grid-rows-[minmax(0,1fr)]：行若是默认的 auto，
            会撑到内容高度并溢出 max-h，子元素拿到完整行高，overflow-y-auto overscroll-contain 永远不触发。
            窄屏放弃分栏，整个弹窗当一个滚动容器。
          */}
          <div className="modal-pop flex max-h-[94vh] w-full max-w-6xl flex-col overflow-y-auto overscroll-contain rounded-3xl border border-line bg-surface lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.75fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
            <div className="min-h-0 bg-black/[0.04] lg:overflow-auto">
              <AdaptiveMedia
                mode={selected.mode}
                src={selected.media_url}
                poster={selected.thumb_url}
                className="min-h-[45vh]"
              />
            </div>
            <aside className="min-h-0 border-t border-line p-6 lg:border-t-0 lg:border-l lg:overflow-y-auto lg:overscroll-contain">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex gap-2">
                    <span className="media-badge">{MODE_KEYS.has(selected.mode) ? t(`modes.${selected.mode}` as "modes.txt2img") : selected.mode}</span>
                    {selected.is_adult && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
                    )}
                  </div>
                  <h2 className="mt-3 text-xl font-bold">{selected.title ?? t("communityWork")}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="text-3xl text-ink-subtle hover:text-ink">
                  &times;
                </button>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold text-ink-subtle">PROMPT</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{selected.prompt}</p>
              </div>
              {selected.negative_prompt && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-ink-subtle">NEGATIVE PROMPT</div>
                  <p className="text-sm leading-6 text-ink-muted">{selected.negative_prompt}</p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-line bg-black/[0.03] p-3">
                  <div className="text-[10px] font-semibold text-ink-subtle">TIER</div>
                  <div className="mt-1 truncate text-xs font-mono text-ink">
                    {displayValue(selected.params.tier, t("inlineMedia"))}
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-black/[0.03] p-3">
                  <div className="text-[10px] font-semibold text-ink-subtle">SEED</div>
                  <div className="mt-1 truncate text-xs font-mono text-ink">
                    {displayValue(selected.params.seed, t("inlineMedia"))}
                  </div>
                </div>
              </div>

              {refs.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-ink-subtle">{t("referenceImages")}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {refs.map((src, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={`${src.slice(0, 60)}-${index}`} src={src} alt={t("referenceAlt", { number: index + 1 })} className="aspect-square w-full rounded-xl object-cover" />
                    ))}
                  </div>
                </div>
              )}

              {paramEntries.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-ink-subtle">{t("parameters")}</div>
                  <div className="divide-y divide-white/5 rounded-2xl border border-line px-4">
                    {paramEntries.map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-4 py-2.5 text-xs">
                        <span className="font-mono text-ink-subtle">{key}</span>
                        <span className="max-w-[65%] break-all text-right font-mono text-ink-muted">{displayValue(value, t("inlineMedia"))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => remix(selected)}
                className="mt-6 w-full rounded-2xl bg-teal-700 py-3 font-bold text-white hover:bg-teal-700"
              >
                <i className="fas fa-copy mr-2" />
                {signedIn ? t("copyToGenerator") : t("registerToCopy")}
              </button>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
