import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  // 允许字体 CDN + 同域；图片可来自任意 https（生成结果 CDN）
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://challenges.cloudflare.com",
      "font-src 'self' https://cdnjs.cloudflare.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      // blob: 是 3D 预览必需的：three.js GLTFLoader 会把 GLB 内嵌的贴图
      // 抽成 Blob 再用 fetch 读回来，走的是 connect-src（不是 img-src）。
      // 少了它贴图会被静默拦截，模型只剩几何体渲染成白模。
      "connect-src 'self' https: blob:",
      "frame-src https://challenges.cloudflare.com",
      "child-src https://challenges.cloudflare.com",
      // worker-src 必须显式写出来。CSP3 的回退链是 worker-src → child-src → script-src，
      // 上面那条 child-src 一旦存在，Worker 就被限死在 challenges.cloudflare.com 上。
      // 而 three 的 DRACOLoader / KTX2Loader 是把解码器代码拼成 Blob 再 new Worker()，
      // 于是所有 draco 压缩的模型都解不出来——不分地区，所有人都是坏的。
      // 实测：不加这条 blob worker 直接 error，加了就通。
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const privateRouteHeaders = [
  "/api/:path*",
  "/admin/:path*",
  "/mod/:path*",
  "/make/:path*",
  "/history/:path*",
  "/profile/:path*",
  "/plaything/:path*",
  "/login",
].map((source) => ({
  source,
  headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
}));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // draco / basis 解码器按版本号钉死（1.5.6 与 2021-04-15-ba1c3e4），
        // 内容永不变，换版本就是换路径。public/ 默认 max-age=0，
        // 意味着每看一次 3D 都要为这 900KB 回源验证一轮。
        source: "/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      ...privateRouteHeaders,
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
