import type { PlaythingCategoryId, PlaythingMediaKind } from "@/lib/plaything-categories";

export type ParamSchemaProp = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
};

export type PlaythingProduct = {
  id: number;
  model_id: string;
  label: string;
  credit_cost: number;
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
  cost: number;
  error: string | null;
  created_at: string;
  category: PlaythingCategoryId;
  media_kind: PlaythingMediaKind;
};

export type Phase = "idle" | "submitting" | "polling";
