import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  compact?: boolean;
  className?: string;
};

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    // 直接用站点图标本体（奶油底橘色扭蛋），避免站内 logo 与浏览器标签/桌面图标是两个东西
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icon-192.png"
      alt=""
      aria-hidden="true"
      className={`inline-block rounded-2xl object-cover shadow-lg shadow-orange-950/30 ${className}`}
    />
  );
}

export function BrandLogo({ href = "/", compact = false, className = "" }: BrandLogoProps) {
  return (
    <Link href={href} className={`inline-flex items-center gap-3 ${className}`} aria-label="玩玩可物首页">
      <BrandMark className={compact ? "h-9 w-9" : "h-12 w-12"} />
      <span className={compact ? "text-2xl font-bold tracking-tight" : "text-3xl font-black tracking-tight"}>
        玩玩可物
      </span>
    </Link>
  );
}
