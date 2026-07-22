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
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (process.env.NODE_ENV === "production" && parsed.data.DEMO_MODE) {
    console.warn("[env] WARNING: DEMO_MODE=true in production. Payments and generations are simulated.");
  }
  return parsed.data;
}

export const env = loadEnv();
