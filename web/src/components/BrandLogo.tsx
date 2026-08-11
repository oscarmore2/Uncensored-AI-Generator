import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  compact?: boolean;
  /**
   * 窄屏只留图标。
   * 顶栏要同时放下「图标 + 品牌字 + 导航 + 余额 + 头像」，375px 上必然放不下；
   * 不给出口的话 flex 会把品牌字压成三行（玩／玩可／物），顶栏直接变成 120px 高。
   * 压掉四个字比压掉导航合算——首页 hero 和登录页都还有完整品牌。
   */
  hideNameOnMobile?: boolean;
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

export function BrandLogo({
  href = "/",
  compact = false,
  hideNameOnMobile = false,
  className = "",
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      // shrink-0：顶栏挤的时候宁可挤导航，也不能把品牌压到换行
      className={`inline-flex shrink-0 items-center gap-2 sm:gap-3 ${className}`}
      aria-label="玩玩可物首页"
    >
      <BrandMark className={compact ? "h-9 w-9" : "h-12 w-12"} />
      {/* 首页 hero 用 [&_span:last-child] 改这里的字号，别把它包进别的元素里 */}
      <span
        className={`whitespace-nowrap ${hideNameOnMobile ? "hidden sm:inline" : ""} ${
          compact ? "text-2xl font-bold tracking-tight" : "text-3xl font-black tracking-tight"
        }`}
      >
        玩玩可物
      </span>
    </Link>
  );
}
