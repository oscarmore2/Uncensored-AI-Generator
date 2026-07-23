import type { Generation, PublicWork, User, VipTier } from "@prisma/client";
import { isVipActive } from "./pricing";

export function userOut(
  user: User & {
    vipTier?: Pick<VipTier, "id" | "code" | "name" | "discountBps"> | null;
  }
) {
  const vipActive = isVipActive(user);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    balance: user.balance,
    is_vip: vipActive,
    vip_expires_at: user.vipExpiresAt,
    vip_tier: user.vipTier
      ? {
          id: user.vipTier.id,
          code: user.vipTier.code,
          name: user.vipTier.name,
          discount_bps: user.vipTier.discountBps,
          discount_percent: user.vipTier.discountBps / 100,
        }
      : null,
    created_at: user.createdAt,
  };
}

export function generationOut(gen: Generation) {
  return {
    id: gen.id,
    mode: gen.mode,
    prompt: gen.prompt,
    status: gen.status,
    progress: gen.progress,
    zen_job_id: gen.zenJobId,
    result_urls: gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : null,
    cost: gen.cost,
    created_at: gen.createdAt,
  };
}

/** 审核端视图：比 generationOut 多软删/曝光状态与负面词参数 */
export function generationModOut(gen: Generation & { user?: { username: string } }) {
  return {
    ...generationOut(gen),
    user_id: gen.userId,
    username: gen.user?.username,
    negative_prompt: gen.negativePrompt,
    params: safeJson(gen.params),
    visibility: gen.visibility,
    deleted_at: gen.deletedAt,
  };
}

export function publicWorkOut(work: PublicWork) {
  return {
    id: work.id,
    title: work.title,
    mode: work.mode,
    prompt: work.prompt,
    negative_prompt: work.negativePrompt,
    params: safeJson(work.params),
    media_url: work.mediaUrl,
    thumb_url: work.thumbUrl,
    created_at: work.createdAt,
  };
}

/** 审核端公共库视图：包含上下架/来源等管理字段 */
export function publicWorkModOut(work: PublicWork) {
  return {
    ...publicWorkOut(work),
    source: work.source,
    source_generation_id: work.sourceGenerationId,
    source_zen_job_id: work.sourceZenJobId,
    sort_order: work.sortOrder,
    is_published: work.isPublished,
    updated_at: work.updatedAt,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
