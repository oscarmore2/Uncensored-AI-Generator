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
  ZEN_API_KEY: z.string().default(""),
  ZEN_BASE_URL: z.string().url().default("https://api.zencreator.pro/api/public/v1"),
  // 可选：经 Cloudflare Worker 代理访问 Zen 时，与 Worker 的 PROXY_SECRET 一致
  ZEN_PROXY_SECRET: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  CRYPTOMUS_MERCHANT_ID: z.string().default(""),
  CRYPTOMUS_PAYMENT_API_KEY: z.string().default(""),
  CREDIT_PACKAGES: z
    .string()
    .default('{"100": 2900, "500": 12900, "1200": 29900, "3000": 69900}')
    .transform((s) => z.record(z.string(), z.number().int().positive()).parse(JSON.parse(s))),
  VIP_PRICE: z.coerce.number().int().positive().default(9900),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  // Zen 消耗估算：本站 1 点数折合多少 Zen credits（Zen 无余额 API，只能估算）
  ZEN_CREDIT_RATIO: z.coerce.number().positive().default(1),
  // Zen 月度预算（credits），0 表示不设预算不告警
  ZEN_MONTHLY_BUDGET: z.coerce.number().int().nonnegative().default(0),
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
  OSS_MIRROR_ZEN_RESULTS: z
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
  WAVESPEED_API_KEY: z.string().default(""),
  WAVESPEED_BASE_URL: z.string().url().default("https://api.wavespeed.ai/api/v3"),
  // Cloudflare Turnstile（登录/注册人机验证）
  TURNSTILE_SITE_KEY: z.string().default(""),
  TURNSTILE_SECRET_KEY: z.string().default(""),
  // true 时：生产环境未配置 Turnstile 则拒绝登录/注册
  TURNSTILE_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
});

function loadEnv() {
  // 兼容常见 HF token 环境变量名
  if (!process.env.HF_TOKEN && process.env.HUGGINGFACE_API_KEY) {
    process.env.HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
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
