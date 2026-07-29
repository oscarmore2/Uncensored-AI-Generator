"use client";

import { useEffect, useMemo, useState } from "react";
import { detectMediaKindFromUrls, type PlaythingMediaKind } from "@/lib/plaything-categories";
import { useModelViewerDiagnostics } from "@/lib/model-viewer-diagnostics";

/**
 * 审核端通用媒体预览：卡片缩略图 + 弹窗播放。
 * 支持图片 / 视频 / 3D / 音频；视频缩略图直接用浏览器抽帧，不依赖服务端生成。
 */

/** 先按 URL 后缀判定，判不出来时用生成模式兜底 */
export function mediaKindOf(
  urls: string[] | null | undefined,
  mode?: string
): PlaythingMediaKind {
  const fallback: PlaythingMediaKind =
    mode?.endsWith("vid") || mode?.includes("video") ? "video" : "image";
  return detectMediaKindFromUrls(urls, fallback);
}

/** 富媒体优先级：一个任务同时产出封面图和视频时，作品本体是视频 */
const KIND_WEIGHT: Record<PlaythingMediaKind, number> = {
  video: 3,
  "3d": 3,
  audio: 2,
  image: 1,
};

/**
 * 一组结果里最能代表作品的类型。
 * 逐条判定后取权重最高的——否则 [cover.jpg, clip.mp4] 会被当成图片，
 * 卡片就丢了视频角标和播放入口。
 */
export function primaryMediaKind(
  urls: string[] | null | undefined,
  mode?: string
): PlaythingMediaKind {
  if (!urls?.length) return mediaKindOf(urls, mode);
  let best = mediaKindOf([urls[0]], mode);
  for (const u of urls) {
    const k = mediaKindOf([u], mode);
    if (KIND_WEIGHT[k] > KIND_WEIGHT[best]) best = k;
  }
  return best;
}

/** 结果里的静态图，可直接当视频/3D 的封面 */
function posterUrlOf(urls: string[] | null | undefined, mode?: string): string | null {
  return urls?.find((u) => mediaKindOf([u], mode) === "image") ?? null;
}

/** 该类型对应的第一条 URL */
function urlOfKind(
  urls: string[] | null | undefined,
  kind: PlaythingMediaKind,
  mode?: string
): string | null {
  return urls?.find((u) => mediaKindOf([u], mode) === kind) ?? null;
}

const KIND_META: Record<PlaythingMediaKind, { icon: string; label: string }> = {
  image: { icon: "fa-image", label: "图片" },
  video: { icon: "fa-film", label: "视频" },
  "3d": { icon: "fa-cube", label: "3D 模型" },
  audio: { icon: "fa-music", label: "音频" },
};

/**
 * 卡片缩略图。
 * 视频用 `#t=0.1` 让浏览器 seek 到首帧当封面（preload=metadata 即可，不会下整段）；
 * 3D / 音频无法廉价抽帧，退化为图标占位。
 */
export function MediaThumb({
  urls,
  mode,
  alt,
  className = "w-full h-full object-cover",
}: {
  urls: string[] | null | undefined;
  mode?: string;
  alt?: string;
  className?: string;
}) {
  const kind = primaryMediaKind(urls, mode);
  const poster = posterUrlOf(urls, mode);

  if (!urls?.length) return null;

  if (kind === "video") {
    const videoUrl = urlOfKind(urls, "video", mode) ?? urls[0];
    return (
      <>
        {poster ? (
          // 有封面图就直接用，比让浏览器解码视频抽帧更快更稳
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt={alt ?? "作品"} className={className} loading="lazy" />
        ) : (
          // 无封面时靠 #t=0.1 让浏览器 seek 到首帧；preload=metadata 不会下整段
          <video
            src={`${videoUrl}#t=0.1`}
            className={className}
            preload="metadata"
            muted
            playsInline
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
            <i className="fas fa-play text-white text-sm ml-0.5" />
          </span>
        </div>
      </>
    );
  }

  if (kind === "3d" || kind === "audio") {
    const meta = KIND_META[kind];
    if (poster) {
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt={alt ?? "作品"} className={className} loading="lazy" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
              <i className={`fas ${meta.icon} text-white text-sm`} />
            </span>
          </div>
        </>
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-white/[0.06] to-transparent">
        <i className={`fas ${meta.icon} text-3xl text-gray-500`} />
        <span className="text-[11px] text-gray-500">{meta.label}</span>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urls[0]} alt={alt ?? "作品"} className={className} loading="lazy" />;
}

/** 右上角的媒体类型角标 */
export function MediaKindBadge({
  urls,
  mode,
}: {
  urls: string[] | null | undefined;
  mode?: string;
}) {
  const kind = primaryMediaKind(urls, mode);
  if (kind === "image") return null;
  const meta = KIND_META[kind];
  return (
    <span className="text-[10px] px-2 py-0.5 bg-black/70 rounded-full flex items-center gap-1">
      <i className={`fas ${meta.icon}`} />
      {meta.label}
    </span>
  );
}

/** 3D 模型渲染 + 加载诊断（贴图/材质失败时给出可见提示，而不是静默显示白模） */
function Model3DStage({ url }: { url: string }) {
  const { ref, error } = useModelViewerDiagnostics(url);
  return (
    <div className="relative w-full">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <model-viewer
        ref={ref as any}
        src={url}
        alt="3D 模型预览"
        camera-controls
        auto-rotate
        touch-action="pan-y"
        style={{ width: "100%", height: "min(65vh, 640px)", background: "#0c0c0c" }}
      />
      {error && (
        <div className="absolute bottom-2 left-2 right-2 flex items-start gap-2 rounded-xl bg-amber-950/90 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
          <i className="fas fa-triangle-exclamation mt-0.5 shrink-0" />
          <span>
            模型部分资源加载失败，可能导致贴图缺失或显示异常
            <span className="block text-amber-400/70 font-mono mt-0.5 break-all">{error}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** 单条媒体的完整播放视图 */
function MediaStage({ url, kind }: { url: string; kind: PlaythingMediaKind }) {
  useEffect(() => {
    if (kind === "3d") void import("@google/model-viewer");
  }, [kind]);

  const stageClass = "max-w-full max-h-[min(70vh,720px)] w-auto h-auto object-contain rounded-2xl";

  if (kind === "video") {
    return (
      <video
        src={url}
        className={stageClass}
        controls
        autoPlay
        loop
        playsInline
        preload="metadata"
      />
    );
  }

  if (kind === "audio") {
    return (
      <div className="w-full max-w-lg flex flex-col items-center gap-4 py-10">
        <i className="fas fa-music text-5xl text-gray-500" />
        <audio src={url} controls autoPlay className="w-full" />
      </div>
    );
  }

  if (kind === "3d") {
    const viewable = /\.(glb|gltf)(\?|#|$)/i.test(url);
    if (!viewable) {
      // obj/fbx 浏览器渲染不了，给下载入口而不是白屏
      return (
        <div className="p-8 text-sm text-gray-400 text-center space-y-3">
          <i className="fas fa-cube text-4xl text-gray-600" />
          <p>该 3D 格式无法在浏览器预览，请下载后查看</p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-rose-300 break-all"
          >
            下载模型
          </a>
        </div>
      );
    }
    return <Model3DStage url={url} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="作品预览" className={stageClass} />;
}

/**
 * 作品预览弹窗：支持多结果切换，逐条按自身 URL 判定类型
 * （同一任务可能混合输出，如视频 + 封面图）。
 */
export function MediaPreviewModal({
  urls,
  mode,
  title,
  onClose,
  children,
}: {
  urls: string[];
  mode?: string;
  title?: React.ReactNode;
  onClose: () => void;
  /** 弹窗底部的元信息 / 操作区 */
  children?: React.ReactNode;
}) {
  const list = useMemo(() => urls.filter(Boolean), [urls]);
  // 默认定位到作品本体（视频/3D），而不是排在前面的封面图
  const [index, setIndex] = useState(() => {
    const main = primaryMediaKind(list, mode);
    const i = list.findIndex((u) => mediaKindOf([u], mode) === main);
    return i >= 0 ? i : 0;
  });
  const current = list[Math.min(index, list.length - 1)];
  const kind = current ? mediaKindOf([current], mode) : "image";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(list.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, list.length]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="text-sm font-semibold flex items-center gap-2 min-w-0">{title}</div>
          <div className="flex items-center gap-2 shrink-0">
            {current && (
              <a
                href={current}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 text-xs border border-white/10 rounded-xl hover:bg-white/10"
              >
                <i className="fas fa-external-link-alt mr-1" />
                原图
              </a>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl border border-white/10 hover:bg-white/10 text-gray-400"
              aria-label="关闭"
            >
              <i className="fas fa-times" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-center bg-black/40 min-h-[240px] p-3 sm:p-5">
            {current ? (
              <MediaStage url={current} kind={kind} />
            ) : (
              <p className="text-sm text-gray-500 py-16">没有可预览的结果</p>
            )}
          </div>

          {list.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto border-t border-white/10">
              {list.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  onClick={() => setIndex(i)}
                  className={`relative shrink-0 w-20 h-14 rounded-lg overflow-hidden border ${
                    i === index ? "border-rose-500" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <MediaThumb urls={[u]} mode={mode} />
                </button>
              ))}
            </div>
          )}

          {children && <div className="p-5 border-t border-white/10">{children}</div>}
        </div>
      </div>
    </div>
  );
}
