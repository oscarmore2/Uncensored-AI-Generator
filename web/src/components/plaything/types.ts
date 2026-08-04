import type { PlaythingCategoryId, PlaythingMediaKind } from "@/lib/plaything-categories";
import type { PlaythingParamPolicy, ResolvedControl } from "@/lib/plaything-param-policy";
import type { ProviderId } from "@/lib/providers/meta";

export type ParamSchemaProp = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
  items?: { type?: string; format?: string };
  maxItems?: number;
};

export type PlaythingProduct = {
  id: number;
  provider: ProviderId;
  model_id: string;
  label: string;
  credit_cost: number;
  base_price_usd?: number;
  is_recommended: boolean;
  sort_order: number;
  type: string;
  description: string;
  thumbnail_url: string | null;
  category: PlaythingCategoryId;
  media_kind: PlaythingMediaKind;
  param_schema: {
    properties: Record<string, ParamSchemaProp>;
    required: string[];
  } | null;
  param_policy?: PlaythingParamPolicy;
  controls?: ResolvedControl[];
};

export type PlaythingCategorySummary = {
  id: PlaythingCategoryId;
  label: string;
  icon: string;
  media_kind: PlaythingMediaKind;
  count: number;
};

export type PlaythingGen = {
  id: number;
  product_id: number;
  product_label: string | null;
  model_id: string | null;
  prompt: string;
  status: string;
  progress: number;
  result_urls: string[] | null;
  /** 当初喂进去的参考媒体：3D 抽不出首帧、任务未完成时拿来当缩略图 */
  input_urls?: string[];
  thumb_urls?: string[];
  cost: number;
  error: string | null;
  is_adult: boolean;
  media_expires_at: string | null;
  media_deleted_at: string | null;
  created_at: string;
  category: PlaythingCategoryId;
  media_kind: PlaythingMediaKind;
};

export type Phase = "idle" | "submitting" | "polling";
