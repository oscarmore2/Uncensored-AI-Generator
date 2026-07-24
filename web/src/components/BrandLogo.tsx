import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  compact?: boolean;
  className?: string;
};

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-violet-950/30 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" fill="none" className="h-[70%] w-[70%]">
        <path
          d="M20 5.5 22.8 15l9.7 2.8-9.7 2.8L20 30l-2.8-9.4-9.7-2.8 9.7-2.8L20 5.5Z"
          fill="white"
        />
        <path d="m29.6 26 .9 3.2 3.2.9-3.2.9-.9 3.2-.9-3.2-3.2-.9 3.2-.9.9-3.2Z" fill="white" opacity=".8" />
      </svg>
    </span>
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
