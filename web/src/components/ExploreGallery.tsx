"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdaptiveMedia, WorkMedia } from "./WorkMedia";

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

const MODE_LABELS: Record<string, string> = {
  txt2img: "文生图",
  txt2vid: "文生视频",
  img2img: "图生图",
  img2vid: "图生视频",
  undress: "图像编辑",
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.startsWith("data:") ? "内嵌媒体数据" : text;
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
  const router = useRouter();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<ExploreWork | null>(null);

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
              className={`result-card group relative aspect-[3/4] overflow-hidden rounded-3xl border border-white/10 bg-[#111] ${
                locked ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <WorkMedia
                mode={work.mode}
                src={work.thumb_url ?? work.media_url}
                autoPlay={!work.is_adult}
                className={`h-full w-full object-cover transition duration-300 ${
                  locked ? "scale-110 blur-2xl" : "group-hover:scale-105"
                }`}
              />
              <div className="absolute left-3 top-3 flex gap-1.5">
                <span className="media-badge">{MODE_LABELS[work.mode] ?? work.mode}</span>
                {work.is_adult && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
                )}
              </div>
              {locked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 p-4 text-center">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      reveal(work.id);
                    }}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/70 text-xl text-white hover:bg-black/85"
                    aria-label="显示 18+ 作品预览"
                  >
                    <i className="fas fa-eye" />
                  </button>
                  <p className="mt-3 text-xs font-medium text-white">点击眼睛显示 18+ 预览</p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4">
                <p className="line-clamp-2 text-xs text-gray-300">{work.title ?? work.prompt}</p>
              </div>
            </article>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/90 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="作品媒体与参数"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="modal-pop grid max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#111] lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.75fr)]">
            <div className="min-h-0 overflow-auto bg-black/30">
              <AdaptiveMedia
                mode={selected.mode}
                src={selected.media_url}
                poster={selected.thumb_url}
                className="min-h-[45vh]"
              />
            </div>
            <aside className="min-h-0 overflow-y-auto border-l border-white/10 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex gap-2">
                    <span className="media-badge">{MODE_LABELS[selected.mode] ?? selected.mode}</span>
                    {selected.is_adult && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold">18+</span>
                    )}
                  </div>
                  <h2 className="mt-3 text-xl font-bold">{selected.title ?? "社区作品"}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="text-3xl text-gray-500 hover:text-white">
                  &times;
                </button>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold text-gray-500">PROMPT</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{selected.prompt}</p>
              </div>
              {selected.negative_prompt && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-gray-500">NEGATIVE PROMPT</div>
                  <p className="text-sm leading-6 text-gray-400">{selected.negative_prompt}</p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                  <div className="text-[10px] font-semibold text-gray-500">MODEL</div>
                  <div className="mt-1 truncate text-xs font-mono text-gray-200">
                    {displayValue(selected.params.zen_model ?? selected.params.model)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                  <div className="text-[10px] font-semibold text-gray-500">SEED</div>
                  <div className="mt-1 truncate text-xs font-mono text-gray-200">
                    {displayValue(selected.params.seed)}
                  </div>
                </div>
              </div>

              {refs.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-gray-500">输入参考图</div>
                  <div className="grid grid-cols-3 gap-2">
                    {refs.map((src, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={`${src.slice(0, 60)}-${index}`} src={src} alt={`参考图 ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
                    ))}
                  </div>
                </div>
              )}

              {paramEntries.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-gray-500">生成参数</div>
                  <div className="divide-y divide-white/5 rounded-2xl border border-white/10 px-4">
                    {paramEntries.map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-4 py-2.5 text-xs">
                        <span className="font-mono text-gray-500">{key}</span>
                        <span className="max-w-[65%] break-all text-right font-mono text-gray-300">{displayValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => remix(selected)}
                className="mt-6 w-full rounded-2xl bg-violet-500 py-3 font-bold text-white hover:bg-violet-400"
              >
                <i className="fas fa-copy mr-2" />
                {signedIn ? "复制参数到生成器" : "注册后复制参数"}
              </button>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
