import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -hex 32)")
    .refine(
      (v) => !["change-this-in-production", "your-super-secret-key-change-in-production-please"].includes(v),
      "AUTH_SECRET must not be a known default value"
    ),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  NOWPAYMENTS_API_KEY: z.string().default(""),
  NOWPAYMENTS_IPN_SECRET: z.string().default(""),
  NOWPAYMENTS_BASE_URL: z.string().url().default("https://api.nowpayments.io/v1"),
  // 与 ZenCreator 单点价对齐并细分 10 倍（$19.99/2000 = $0.009995/点）
  CREDIT_PACKAGES: z
    .string()
    .default('{"2000": 1999, "5500": 4999, "12000": 9900, "63000": 49900}')
    .transform((s) => z.record(z.string(), z.number().int().positive()).parse(JSON.parse(s))),
  VIP_PRICE: z.coerce.number().int().positive().default(9900),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  // WaveSpeed 月度成本预算（美元），0 表示不设预算不告警
  WAVESPEED_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(0),
  DEMO_MODE: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  // 对象存储（S3 兼容：AWS S3 / 阿里云 OSS / MinIO / Cloudflare R2 等）
  // 推荐在管理端 /admin/oss 配置多账户；无激活 DB 账户时回退 .env
  OSS_ENDPOINT: z.string().default(""),
  OSS_REGION: z.string().default("us-east-1"),
  OSS_BUCKET: z.string().default(""),
  OSS_ACCESS_KEY_ID: z.string().default(""),
  OSS_SECRET_ACCESS_KEY: z.string().default(""),
  OSS_PUBLIC_BASE_URL: z.string().default(""), // CDN 自定义域名，如 https://cdn.example.com
  OSS_PATH_PREFIX: z.string().default("media"),
  OSS_MIRROR_RESULTS: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  OSS_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  // 魔法指令：Hugging Face Inference Providers（Dolphin-Mistral-24B-Venice）
  // Token: https://huggingface.co/settings/tokens （需 Inference Providers 权限）
  HF_TOKEN: z.string().default(""),
  HF_INFERENCE_BASE_URL: z.string().url().default("https://router.huggingface.co/v1"),
  // 默认走 Featherless；也可改为 dphn/Dolphin-Mistral-24B-Venice-Edition（由 HF 路由选 provider）
  HF_MAGIC_MODEL: z
    .string()
    .default("dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai"),
  // 内容审查首选：OpenAI Moderation（omni-moderation-latest 免费，专用分类器）
  // 未配置时自动降级到 HF LLM 分类
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODERATION_MODEL: z.string().default("omni-moderation-latest"),
  WAVESPEED_API_KEY: z.string().default(""),
  WAVESPEED_BASE_URL: z.string().url().default("https://api.wavespeed.ai/api/v3"),
  // Cloudflare Turnstile (site key public; secret server-only)
  TURNSTILE_SITE_KEY: z.string().default(""),
  TURNSTILE_SECRET: z.string().default(""),
  // Google Search Console HTML meta tag 的 content 值（不是整段 meta 标签）
  GOOGLE_SITE_VERIFICATION: z.string().default(""),
  // OAuth 登录
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  FACEBOOK_APP_ID: z.string().default(""),
  FACEBOOK_APP_SECRET: z.string().default(""),
  FACEBOOK_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  // 邮箱验证（Resend REST API）
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
  // 注册所在地推测：优先平台 Geo headers；配置后以 IPinfo 补充国家/地区
  IPINFO_TOKEN: z.string().default(""),
  IPINFO_API_BASE: z.string().url().default("https://api.ipinfo.io"),
  MEDIA_CLEANUP_SECRET: z.string().default(""),
  MEDIA_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
});

function loadEnv() {
  // 兼容常见 HF token 环境变量名
  if (!process.env.HF_TOKEN && process.env.HUGGINGFACE_API_KEY) {
    process.env.HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
  }
  // 兼容 Zen 时代已部署环境里的旧变量名，避免 Railway 上改名即失效
  if (!process.env.OSS_MIRROR_RESULTS && process.env.OSS_MIRROR_ZEN_RESULTS) {
    process.env.OSS_MIRROR_RESULTS = process.env.OSS_MIRROR_ZEN_RESULTS;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (process.env.NODE_ENV === "production" && parsed.data.DEMO_MODE) {
    // next build 阶段允许占位 DEMO_MODE；真正运行时禁止
    const isBuild = process.env.NEXT_PHASE === "phase-production-build";
    if (!isBuild) {
      throw new Error(
        "DEMO_MODE must be false in production. Set DEMO_MODE=false in Railway Variables."
      );
    }
    console.warn("[env] DEMO_MODE=true during production build (allowed for page collection only).");
  }
  return parsed.data;
}

export const env = loadEnv();
