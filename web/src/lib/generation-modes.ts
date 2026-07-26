/**
 * 生成端的模式与档位定义（客户端 / 服务端共用，不含任何上游模型信息）。
 *
 * 产品结构：
 *   图片 —— 文字生图 / 图片生图 / 图片编辑，各分 低 / 中 / 高 三档
 *   视频 —— 文字生视频 / 图片生视频，各分 低 / 高 两档
 * 每个档位另有一个 Spicy 变体（会员专属），共 (3×3 + 2×2) × 2 = 26 个 SKU。
 */

export const GENERATION_MODES = ["txt2img", "img2img", "imgedit", "txt2vid", "img2vid"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const GENERATION_TIERS = ["low", "mid", "high"] as const;
export type GenerationTier = (typeof GENERATION_TIERS)[number];

export type GenerationCategory = "image" | "video";

export type ModeMeta = {
  mode: GenerationMode;
  category: GenerationCategory;
  /** 该模式开放的档位（视频只有 low / high） */
  tiers: readonly GenerationTier[];
  /** 是否必须上传参考图 */
  needsImage: boolean;
  /** 是否需要提示词 */
  needsPrompt: boolean;
  supportsNegative: boolean;
  /** 图片模式支持 1/2/4 批量，视频不支持 */
  supportsBatch: boolean;
  icon: string;
  /** 兜底文案；正式展示走 i18n */
  fallbackLabel: string;
};

export const MODE_META: Record<GenerationMode, ModeMeta> = {
  txt2img: {
    mode: "txt2img",
    category: "image",
    tiers: GENERATION_TIERS,
    needsImage: false,
    needsPrompt: true,
    supportsNegative: true,
    supportsBatch: true,
    icon: "fa-font",
    fallbackLabel: "文字生图",
  },
  img2img: {
    mode: "img2img",
    category: "image",
    tiers: GENERATION_TIERS,
    needsImage: true,
    needsPrompt: true,
    supportsNegative: true,
    supportsBatch: true,
    icon: "fa-image",
    fallbackLabel: "图片生图",
  },
  imgedit: {
    mode: "imgedit",
    category: "image",
    tiers: GENERATION_TIERS,
    needsImage: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: true,
    icon: "fa-wand-magic-sparkles",
    fallbackLabel: "图片编辑",
  },
  txt2vid: {
    mode: "txt2vid",
    category: "video",
    tiers: ["low", "high"],
    needsImage: false,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    icon: "fa-video",
    fallbackLabel: "文字生视频",
  },
  img2vid: {
    mode: "img2vid",
    category: "video",
    tiers: ["low", "high"],
    needsImage: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    icon: "fa-film",
    fallbackLabel: "图片生视频",
  },
};

export const MODE_LIST: ModeMeta[] = GENERATION_MODES.map((m) => MODE_META[m]);

export function isGenerationMode(v: unknown): v is GenerationMode {
  return typeof v === "string" && (GENERATION_MODES as readonly string[]).includes(v);
}

export function isGenerationTier(v: unknown): v is GenerationTier {
  return typeof v === "string" && (GENERATION_TIERS as readonly string[]).includes(v);
}

export function modeCategory(mode: string): GenerationCategory {
  return isGenerationMode(mode) ? MODE_META[mode].category : "image";
}

export function modeNeedsImage(mode: string): boolean {
  return isGenerationMode(mode) ? MODE_META[mode].needsImage : false;
}

/** 视频档位的计价基准秒数；实际时长按 ceil(duration / unitSeconds) 计费 */
export const VIDEO_UNIT_SECONDS = 5;

export function durationMultiplier(durationSeconds: number, unitSeconds: number): number {
  if (unitSeconds <= 0) return 1;
  const d = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : unitSeconds;
  return Math.max(1, Math.ceil(d / unitSeconds));
}
