"use client";

function isVideoSrc(mode: string | undefined, src: string): boolean {
  if (mode?.endsWith("vid") || mode?.includes("video")) return true;
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src);
}

/** 公共作品 / 生成结果媒体：按 mode 或 URL 后缀选择 img / video */
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
}) {
  if (isVideoSrc(mode, src)) {
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
    "max-w-full max-h-[min(70vh,720px)] w-auto h-auto object-contain rounded-2xl bg-black/20";

  if (list.length === 1) {
    const only = list[0];
    const video = isVideoSrc(mode, only);
    return (
      <div
        className={`flex items-center justify-center bg-black/30 p-3 sm:p-5 min-h-[180px] ${className ?? ""}`}
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
      className={`grid gap-3 p-3 sm:p-5 bg-black/30 ${
        list.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"
      } ${className ?? ""}`}
    >
      {list.map((url, i) => {
        const video = isVideoSrc(mode, url);
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
