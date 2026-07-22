/** 公共作品媒体：视频模式用 video 标签，其余用 img */
export function WorkMedia({
  mode,
  src,
  poster,
  className,
}: {
  mode: string;
  src: string;
  poster?: string | null;
  className?: string;
}) {
  if (mode.endsWith("vid")) {
    return (
      <video
        src={src}
        poster={poster ?? undefined}
        className={className}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
      />
    );
  }
  // 外部媒体域名不固定，直接用 img 而非 next/image
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="AI 作品" loading="lazy" className={className} />;
}
