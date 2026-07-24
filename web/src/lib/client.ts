"use client";

// 同源 API 封装：Cookie 会话自动携带，无需手动附加 token
export interface ApiUser {
  id: number;
  username: string;
  role: string;
  balance: number;
  is_vip: boolean;
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
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(resp.status, (data as { error?: string }).error ?? `请求失败 (${resp.status})`);
  }
  return data as T;
}

export const MODES: Array<{ key: string; label: string; icon: string }> = [
  { key: "txt2img", label: "文字生图", icon: "fa-font" },
  { key: "txt2vid", label: "文字生视频", icon: "fa-video" },
  { key: "img2img", label: "图片生图", icon: "fa-image" },
  { key: "img2vid", label: "图片生视频", icon: "fa-film" },
];

export type CatalogProduct = {
  id: number;
  mode: string;
  zen_tool: string;
  zen_model: string;
  variant_key: string;
  label: string;
  credit_cost: number;
  batch_four_multiplier: number;
  is_default: boolean;
};

export type CatalogMapping = {
  id?: number;
  mode: string;
  ui_key: string;
  zen_path: string;
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
  user_vip: {
    is_active: boolean;
    tier: CatalogVipPlan["tier"] | null;
    expires_at: string | null;
  };
};

/** 前端本地估算扣点（与服务端 quote 规则对齐） */
export function estimateCost(opts: {
  product: CatalogProduct | undefined;
  batch: number;
  mode: string;
  discountBps?: number;
}): number {
  if (!opts.product) return 0;
  let cost = opts.product.credit_cost;
  if (opts.mode !== "undress" && opts.batch === 4) {
    cost = Math.floor(cost * opts.product.batch_four_multiplier);
  }
  const bps = opts.discountBps ?? 0;
  if (bps > 0) {
    cost = Math.max(1, Math.floor((cost * (10000 - bps)) / 10000));
  }
  return cost;
}
