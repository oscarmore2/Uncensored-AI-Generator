"use client";

// 同源 API 封装：Cookie 会话自动携带，无需手动附加 token
export interface ApiUser {
  id: number;
  username: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  balance: number;
  is_vip: boolean;
  adult_mode_enabled: boolean;
  adult_mode_requested: boolean;
  age_verified: boolean;
  vip_expires_at: string | null;
  vip_tier?: {
    id: number;
    code: string;
    name: string;
    discount_bps: number;
    discount_percent: number;
  } | null;
}

export interface ApiGeneration {
  id: number;
  mode: string;
  prompt: string;
  status: string;
  result_urls: string[] | null;
  cost: number;
  is_adult: boolean;
  media_expires_at: string | null;
  media_deleted_at: string | null;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errorData = data as { error?: string; code?: string };
    throw new ApiError(
      resp.status,
      errorData.error ?? `请求失败 (${resp.status})`,
      errorData.code
    );
  }
  return data as T;
}

export { MODE_LIST as MODES } from "./generation-modes";
export type { GenerationMode, GenerationTier } from "./generation-modes";

/** 生成端可见的档位信息——刻意不含任何上游模型字段 */
export type CatalogProduct = {
  id: number;
  mode: string;
  tier: string;
  spicy: boolean;
  label: string;
  description: string;
  credit_cost: number;
  batch_four_multiplier: number;
  unit_seconds: number;
  requires_vip: boolean;
  is_default: boolean;
  sort_order: number;
};

export type CatalogMapping = {
  id?: number;
  mode: string;
  ui_key: string;
  provider_path: string;
  options: Array<{ value: string; label: string }>;
  enabled: boolean;
};

export type CatalogPackage = {
  id: number;
  credits: number;
  price_cents: number;
  label: string;
  badge: string | null;
};

export type CatalogVipPlan = {
  id: number;
  label: string;
  price_cents: number;
  bonus_credits: number;
  duration_days: number;
  tier: {
    id: number;
    code: string;
    name: string;
    discount_bps: number;
    discount_percent: number;
  };
};

export type CatalogResponse = {
  products: CatalogProduct[];
  param_mappings: CatalogMapping[];
  credit_packages: CatalogPackage[];
  vip_plans: CatalogVipPlan[];
  vip_active: boolean;
  user_vip: {
    is_active: boolean;
    tier: CatalogVipPlan["tier"] | null;
    expires_at: string | null;
  };
};

/** 前端本地估算扣点（与服务端 resolveGenerationQuote 规则保持一致） */
export function estimateCost(opts: {
  product: CatalogProduct | undefined;
  batch: number;
  durationSeconds?: number;
  discountBps?: number;
}): number {
  if (!opts.product) return 0;
  const p = opts.product;

  const units =
    p.unit_seconds > 0
      ? Math.max(1, Math.ceil((opts.durationSeconds || p.unit_seconds) / p.unit_seconds))
      : 1;
  let cost = p.credit_cost * units;

  if (p.unit_seconds === 0) {
    if (opts.batch === 4) cost = Math.floor(cost * p.batch_four_multiplier);
    else if (opts.batch === 2) cost = cost * 2;
  }

  const bps = opts.discountBps ?? 0;
  if (bps > 0) cost = Math.max(1, Math.floor((cost * (10000 - bps)) / 10000));
  return Math.max(1, cost);
}
