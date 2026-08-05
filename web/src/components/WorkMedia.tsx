"use client";

import { useEffect } from "react";
import { useModelViewerDiagnostics } from "@/lib/model-viewer-diagnostics";

type WorkMediaKind = "image" | "video" | "3d" | "audio";

const MODEL_EXT = /\.(glb|gltf|obj|fbx|usdz|ply|stl)(\?|#|$)/i;
/** 浏览器（model-viewer）能直接渲染的只有这两种，其余只能给下载入口 */
const VIEWABLE_MODEL_EXT = /\.(glb|gltf)(\?|#|$)/i;

/**
 * 判定一条媒体是什么。
 *
 * 后缀优先于 mode：3D 与视频转视频这些模式的产出后缀才是权威，
 * 只看 mode 的话 img23d 会被当成图片，.glb 就渲染成一张坏图。
 */
export function workMediaKind(mode: string | undefined, src: string): WorkMediaKind {
  if (MODEL_EXT.test(src)) return "3d";
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(src)) return "audio";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(src)) return "image";
  // 后缀判不出来时才靠 mode 兜底（CDN 常见无扩展名的直链）
  if (mode?.endsWith("3d")) return "3d";
  if (mode?.endsWith("vid") || mode?.includes("video") || mode?.startsWith("vid")) return "video";
  return "image";
}

function isVideoSrc(mode: string | undefined, src: string): boolean {
  return workMediaKind(mode, src) === "video";
}

/** 3D 模型渲染 + 加载诊断（贴图失败时给出可见提示，而不是静默显示白模） */
function ModelStage({
  src,
  poster,
  className,
}: {
  src: string;
  /** 上游随模型附带的预览图：模型加载完成前显示，加载失败时留在原地当兜底 */
  poster?: string | null;
  className?: string;
}) {
  const { ref, error } = useModelViewerDiagnostics(src);
  useEffect(() => {
    void import("@google/model-viewer");
  }, []);

  if (!VIEWABLE_MODEL_EXT.test(src)) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-ink-muted">
        <i className="fas fa-cube text-4xl text-ink-subtle" />
        <p>该 3D 格式无法在浏览器预览，请下载后查看</p>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-block break-all rounded-xl bg-black/[0.06] px-4 py-2 text-orange-700 hover:bg-black/[0.08]"
        >
          下载模型
        </a>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${className ?? ""}`}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <model-viewer
        ref={ref as any}
        src={src}
        poster={poster ?? undefined}
        alt="3D 模型预览"
        camera-controls
        auto-rotate
        touch-action="pan-y"
        style={{ width: "100%", height: "min(65vh, 640px)", background: "#0c0c0c", borderRadius: "1rem" }}
      />
      {error && (
        <div className="absolute bottom-2 left-2 right-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/90 px-3 py-2 text-[11px] text-amber-200">
          <i className="fas fa-triangle-exclamation mt-0.5 shrink-0" />
          <span>
            模型部分资源加载失败，可能导致贴图缺失或显示异常
            {/* 这行原来是 amber-800/70 压在 amber-950 上，深琥珀叠深琥珀几乎看不见，
                而它恰恰是唯一能说明「哪个资源、为什么失败」的线索 */}
            <span className="mt-0.5 block break-all font-mono text-amber-200/75">{error}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** 公共作品 / 生成结果媒体：按后缀或 mode 选择 img / video / 3D / audio */
export function WorkMedia({
  mode,
  src,
  poster,
  className,
  controls = false,
  autoPlay = true,
  muted = true,
  loop = true,
  alt = "AI 作品",
  asThumbnail = false,
}: {
  mode?: string;
  src: string;
  poster?: string | null;
  className?: string;
  /** 结果页等需要用户控制时打开 */
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  alt?: string;
  /**
   * 网格卡片模式：3D / 音频退化成图标占位。
   * 每张卡都挂一个 model-viewer 意味着一屏几十个 WebGL 上下文加整包 GLB 下载，
   * 浏览器直接卡死；作品本体等点开弹窗再渲染。
   */
  asThumbnail?: boolean;
}) {
  const kind = workMediaKind(mode, src);

  if (kind === "3d") {
    if (asThumbnail) {
      // 有上游预览图就直接当封面，比一个立方体图标有用得多
      if (poster) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={poster} alt={alt} loading="lazy" className={className} />;
      }
      return (
        <div className={`flex flex-col items-center justify-center gap-2 bg-stage ${className ?? ""}`}>
          <i className="fas fa-cube text-3xl text-white/45" />
          <span className="text-[11px] text-white/45">3D 模型</span>
        </div>
      );
    }
    return <ModelStage src={src} poster={poster} className={className} />;
  }

  if (kind === "audio") {
    if (asThumbnail) {
      return (
        <div className={`flex flex-col items-center justify-center gap-2 bg-stage ${className ?? ""}`}>
          <i className="fas fa-music text-3xl text-white/45" />
          <span className="text-[11px] text-white/45">音频</span>
        </div>
      );
    }
    return (
      <div className="flex w-full max-w-lg flex-col items-center gap-4 py-8">
        <i className="fas fa-music text-4xl text-ink-subtle" />
        <audio src={src} controls className="w-full" />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <video
        src={src}
        poster={poster ?? undefined}
        className={className}
        muted={muted}
        loop={loop}
        playsInline
        autoPlay={autoPlay}
        controls={controls}
        preload="metadata"
      />
    );
  }
  // 外部媒体域名不固定，直接用 img 而非 next/image
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}

/**
 * 自适应媒体容器：保持原始比例，限制在视口内（宽/高都不溢出）。
 * 适用于生成完成预览、详情页主图等。
 */
export function AdaptiveMedia({
  mode,
  src,
  poster,
  urls,
  className,
}: {
  mode?: string;
  src?: string;
  poster?: string | null;
  /** 多图时展示网格；单图时等同 src */
  urls?: string[];
  className?: string;
}) {
  const list = (urls?.length ? urls : src ? [src] : []).filter(Boolean);
  if (!list.length) return null;

  const mediaClass =
    "max-w-full max-h-[min(70vh,720px)] w-auto h-auto object-contain rounded-2xl bg-stage";

  /*
   * 3D 要占满容器宽度（model-viewer 自己撑高度），object-contain 那套对它没意义。
   *
   * 模型文件只按扩展名认，不能用 workMediaKind：3D 模式下任何认不出后缀的 URL
   * 都会被 mode 兜底成 "3d"，上游那张预览图也会被当成模型。
   *
   * 上游的 3D 输出是「模型 + 预览图」两条 URL（Atlas 的 schema 原话是
   * primary mesh first, preview image appended last）。预览图是这个模型的封面，
   * 不是第二件作品——原先要求 list.length === 1 才走模型渲染，两条 URL 会退化成
   * 平铺网格：左边一个模型窗口，右边一张「该 3D 格式无法在浏览器预览」的下载卡。
   */
  const modelUrl = list.find((u) => MODEL_EXT.test(u));
  if (modelUrl) {
    const poster =
      list.find(
        (u) => u !== modelUrl && !MODEL_EXT.test(u) && workMediaKind(undefined, u) !== "video"
      ) ?? null;
    return (
      <div className={`rounded-2xl bg-stage p-3 sm:p-5 ${className ?? ""}`}>
        <WorkMedia mode={mode} src={modelUrl} poster={poster} alt="生成结果" />
      </div>
    );
  }

  if (list.length === 1) {
    const only = list[0];
    const video = isVideoSrc(mode, only);
    return (
      <div
        className={`flex items-center justify-center rounded-2xl bg-stage p-3 sm:p-5 min-h-[180px] ${className ?? ""}`}
      >
        <WorkMedia
          mode={mode}
          src={only}
          poster={poster}
          className={mediaClass}
          controls={video}
          autoPlay={video}
          muted={video}
          loop={video}
          alt="生成结果"
        />
      </div>
    );
  }

  return (
    <div
      className={`grid gap-3 rounded-2xl p-3 sm:p-5 bg-stage ${
        list.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"
      } ${className ?? ""}`}
    >
      {list.map((url, i) => {
        const kind = workMediaKind(mode, url);
        const video = kind === "video";
        return (
          <div key={`${url}-${i}`} className="flex items-center justify-center min-h-[120px]">
            <WorkMedia
              mode={mode}
              src={url}
              className={mediaClass}
              controls={video}
              autoPlay={false}
              muted
              loop={video}
              alt={`生成结果 ${i + 1}`}
            />
          </div>
        );
      })}
    </div>
  );
}
