import type { Draft, Generation, PublicWork, User, VipTier } from "@prisma/client";
import { extractInputUrls, extractResultThumbs } from "./generation-media";
import { isVipActive } from "./pricing";
import { hasAdultAccess } from "./adult-access";

export function userOut(
  user: User & {
    vipTier?: Pick<VipTier, "id" | "code" | "name" | "rank" | "discountBps"> | null;
  }
) {
  const vipActive = isVipActive(user);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    email_verified: Boolean(user.emailVerifiedAt),
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    role: user.role,
    balance: user.balance,
    is_vip: vipActive,
    adult_mode_enabled: hasAdultAccess(user),
    adult_mode_requested: user.adultModeEnabled,
    draft_auto_save: user.draftAutoSave,
    age_verified: Boolean(user.ageVerifiedAt && user.birthDate),
    vip_expires_at: user.vipExpiresAt,
    vip_tier: user.vipTier
      ? {
          id: user.vipTier.id,
          code: user.vipTier.code,
          name: user.vipTier.name,
          rank: user.vipTier.rank,
          discount_bps: user.vipTier.discountBps,
          discount_percent: user.vipTier.discountBps / 100,
        }
      : null,
    created_at: user.createdAt,
  };
}

export function generationOut(gen: Generation) {
  const params = safeJson(gen.params);
  return {
    id: gen.id,
    mode: gen.mode,
    prompt: gen.prompt,
    status: gen.status,
    progress: gen.progress,
    tier: gen.tier,
    spicy: gen.spicy,
    job_id: gen.providerJobId,
    result_urls: gen.resultUrls ? (JSON.parse(gen.resultUrls) as string[]) : null,
    cost: gen.cost,
    is_adult: gen.isAdult,
    safety_categories: safeStringArray(gen.safetyCategories),
    media_expires_at: gen.mediaExpiresAt,
    media_deleted_at: gen.mediaDeletedAt,
    created_at: gen.createdAt,
    // 作品卡片用：视频/3D 拿不到成品首帧时退回当初的输入图
    input_urls: extractInputUrls(params),
    thumb_urls: extractResultThumbs(params),
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

/**
 * 游客看到的提示词摘要：最多两行，并且**总长有上限**。
 *
 * 单行超长的提示词按行截断等于没截，所以再压一道字符上限；
 * 前端配渐变遮罩，视觉上提示「后面还有」。
 */
export function promptExcerpt(prompt: string, maxLines = 2, maxChars = 120): string {
  const lines = prompt
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, maxLines);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * @param forGuest 未登录访客。提示词只给摘要——**必须在服务端截**：
 *   只用 CSS 遮罩的话完整文本仍在 HTML 里，查看源码就全拿到了，等于没藏。
 */
export function publicWorkOut(work: PublicWork, opts?: { forGuest?: boolean }) {
  const forGuest = Boolean(opts?.forGuest);
  const prompt = forGuest ? promptExcerpt(work.prompt) : work.prompt;
  return {
    id: work.id,
    title: work.title,
    mode: work.mode,
    prompt,
    prompt_truncated: forGuest && prompt !== work.prompt,
    negative_prompt: work.negativePrompt,
    params: safeJson(work.params),
    media_url: work.mediaUrl,
    thumb_url: work.thumbUrl,
    is_adult: work.isAdult,
    created_at: work.createdAt,
  };
}

/** 审核端公共库视图：包含上下架/来源等管理字段 */
export function publicWorkModOut(work: PublicWork) {
  return {
    ...publicWorkOut(work),
    source: work.source,
    source_generation_id: work.sourceGenerationId,
    source_job_id: work.sourceJobId,
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

function safeStringArray(s: string): string[] {
  try {
    const value = JSON.parse(s) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 草稿出参。snapshot 原样带走，由前端用 lib/draft-snapshot 解码。 */
export function draftOut(draft: Draft) {
  return {
    id: draft.id,
    mode: draft.mode,
    tier: draft.tier,
    spicy: draft.spicy,
    product_id: draft.productId,
    provider_model_id: draft.providerModelId,
    title: draft.title,
    prompt: draft.prompt,
    negative_prompt: draft.negativePrompt,
    snapshot: draft.snapshot,
    generation_id: draft.generationId,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}
