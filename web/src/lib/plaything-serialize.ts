import { resolvePlaythingCategory } from "./plaything-categories";

type GenProduct = {
  label: string;
  modelId: string;
  catalogModel?: { type: string } | null;
};

export function playthingGenerationOut(g: {
  id: number;
  productId: number;
  prompt: string;
  status: string;
  progress: number;
  resultUrls: string | null;
  cost: number;
  error: string | null;
  createdAt: Date;
  isAdult: boolean;
  mediaExpiresAt: Date | null;
  mediaDeletedAt: Date | null;
  product?: GenProduct | null;
}) {
  const type = g.product?.catalogModel?.type ?? "";
  const modelId = g.product?.modelId ?? "";
  const { category, media_kind } = resolvePlaythingCategory(type, modelId);
  return {
    id: g.id,
    product_id: g.productId,
    product_label: g.product?.label ?? null,
    model_id: modelId || null,
    prompt: g.prompt,
    status: g.status,
    progress: g.progress,
    result_urls: g.resultUrls ? (JSON.parse(g.resultUrls) as string[]) : null,
    cost: g.cost,
    error: g.error,
    is_adult: g.isAdult,
    media_expires_at: g.mediaExpiresAt,
    media_deleted_at: g.mediaDeletedAt,
    created_at: g.createdAt,
    category,
    media_kind,
  };
}

export const playthingProductInclude = {
  label: true,
  modelId: true,
  catalogModel: { select: { type: true } },
} as const;
