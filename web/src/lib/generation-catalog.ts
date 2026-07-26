import "server-only";
import type { GenerationMode, GenerationTier } from "./generation-modes";

/**
 * 生成端 SKU 蓝图。
 *
 * 定价口径：站内点数按 ZenCreator 点数细分 10 倍，单点美元价与 ZC Starter 一致
 * （$19.99/2000 = $0.009995/点）。细分是为了让整数扣点能精确表达 130% / 150%。
 *   普通档 creditCost = ceil(refCredits × 10 × 130%)
 *   Spicy 档 creditCost = ceil(refCredits × 10 × 150%)
 * refCredits 取自 ZenCreator 官方计费表，逐条记在 refLabel 里便于日后核对。
 *
 * modelCandidates 是按优先级排列的 WaveSpeed model_id；播种时逐个在已同步的
 * WaveSpeedCatalogModel 里查找，都不命中则退回 modelPattern 正则搜索，
 * 仍不命中就留空并在管理端标记「未绑定」，绝不猜一个不存在的 ID 上线。
 */

export const NORMAL_MULTIPLIER_BPS = 13000; // 130%
export const SPICY_MULTIPLIER_BPS = 15000; // 150%

/**
 * 站内点数相对 ZenCreator 点数的细分倍数。
 * 1:1 时整数取整会把「ZC 1 分」的图片档抬到 2 点（200%），130% 根本落不了地；
 * 细分 10 倍后 26 个档位的 130% / 150% 全部精确命中，单点美元价与 ZC 保持一致。
 */
export const CREDIT_GRANULARITY = 10;

/** 站内 1 点的美元价 = ZC Starter 单点价 ÷ 细分倍数 */
export const ZC_STARTER_USD_PER_CREDIT = 19.99 / 200 / CREDIT_GRANULARITY;

export type SkuBlueprint = {
  mode: GenerationMode;
  tier: GenerationTier;
  spicy: boolean;
  label: string;
  description: string;
  refCredits: number;
  refLabel: string;
  unitSeconds: number;
  sortOrder: number;
  isDefault: boolean;
  /** 固定注入上游的参数（分辨率 / 时长 / 关音轨等） */
  defaultInputs: Record<string, unknown>;
  modelCandidates: string[];
  modelPattern?: RegExp;
};

/* ---------------------------------------------------------------- 图片档位 */

type ImageTierSpec = {
  tier: GenerationTier;
  label: string;
  description: string;
  refCredits: number;
  refLabel: string;
  sortOrder: number;
  defaultInputs: Record<string, unknown>;
};

const IMAGE_TIERS: ImageTierSpec[] = [
  {
    tier: "low",
    label: "标准",
    description: "1K 输出 · 出图最快 · 日常草稿与批量试错",
    refCredits: 1,
    refLabel: "ZC Text-to-Image (General) = 1 分",
    sortOrder: 10,
    defaultInputs: { size: "1024*1024", enable_base64_output: false },
  },
  {
    tier: "mid",
    label: "高清",
    description: "2K 输出 · 细节与提示词还原更稳 · 日常主力档",
    refCredits: 2,
    refLabel: "ZC Text-to-Image (Qwen Pro / WAN Pro) = 2 分",
    sortOrder: 20,
    defaultInputs: { size: "2048*2048", enable_base64_output: false },
  },
  {
    tier: "high",
    label: "旗舰",
    description: "4K 输出 · 顶级画质与文字/结构准确度 · 成片交付",
    refCredits: 4,
    refLabel: "ZC Image Editor (Nano Banana 2) = 4 分",
    sortOrder: 30,
    defaultInputs: { size: "4096*4096", enable_base64_output: false },
  },
];

type ImageMode = "txt2img" | "img2img" | "imgedit";
type ModelCandidate = { ids: string[]; pattern?: RegExp };

const IMAGE_MODEL_CANDIDATES: Record<
  ImageMode,
  Record<"normal" | "spicy", Record<GenerationTier, ModelCandidate>>
> = {
  txt2img: {
    normal: {
      low: { ids: ["wavespeed-ai/flux-schnell", "wavespeed-ai/z-image/turbo"] },
      mid: { ids: ["bytedance/seedream-v4", "wavespeed-ai/flux-dev"] },
      high: {
        ids: ["bytedance/seedream-v5-pro", "bytedance/seedream-v4.5", "google/nano-banana-2"],
      },
    },
    spicy: {
      low: { ids: ["wavespeed-ai/chroma"] },
      mid: {
        ids: ["wavespeed-ai/chroma"],
        pattern: /(uncensored|nsfw|spicy)/i,
      },
      high: {
        ids: [],
        pattern: /(uncensored|nsfw|spicy).*(pro|xl|plus|max)|(?:pro|xl|plus|max).*(uncensored|nsfw)/i,
      },
    },
  },
  img2img: {
    normal: {
      low: {
        ids: ["wavespeed-ai/flux-schnell/image-to-image", "wavespeed-ai/flux-dev/image-to-image"],
        pattern: /flux.*image-to-image/i,
      },
      mid: { ids: ["bytedance/seedream-v4/edit", "wavespeed-ai/flux-kontext-dev"] },
      high: { ids: ["bytedance/seedream-v4.5/edit", "google/nano-banana-pro/edit"] },
    },
    spicy: {
      low: { ids: [], pattern: /(uncensored|nsfw|spicy).*(image-to-image|i2i|edit)/i },
      mid: { ids: [], pattern: /(uncensored|nsfw|spicy).*(image-to-image|i2i|edit)/i },
      high: { ids: [], pattern: /(uncensored|nsfw|spicy).*(image-to-image|i2i|edit)/i },
    },
  },
  imgedit: {
    normal: {
      low: { ids: ["wavespeed-ai/flux-kontext-dev", "wavespeed-ai/flux-kontext-pro"] },
      mid: { ids: ["bytedance/seedream-v4/edit", "google/nano-banana/edit"] },
      high: {
        ids: [
          "google/nano-banana-pro/edit",
          "google/nano-banana-2/edit",
          "bytedance/seedream-v4.5/edit-sequential",
        ],
      },
    },
    spicy: {
      low: { ids: [], pattern: /(uncensored|nsfw|spicy).*(edit|kontext)/i },
      mid: { ids: [], pattern: /(uncensored|nsfw|spicy).*(edit|kontext)/i },
      high: { ids: [], pattern: /(uncensored|nsfw|spicy).*(edit|kontext)/i },
    },
  },
};

/* ---------------------------------------------------------------- 视频档位 */

type VideoTierSpec = {
  tier: GenerationTier;
  label: string;
  description: string;
  refCredits: number;
  refLabel: string;
  sortOrder: number;
  resolution: string;
};

const VIDEO_TIERS: VideoTierSpec[] = [
  {
    tier: "low",
    label: "低级模式",
    description: "480p · 5 秒起 · 出片快，适合分镜试拍",
    refCredits: 6,
    refLabel: "ZC Seedance 2.0 480p/5s = 6 分",
    sortOrder: 10,
    resolution: "480p",
  },
  {
    tier: "high",
    label: "高级模式",
    description: "720p · 5 秒起 · 动态更稳、细节更足，适合成片",
    refCredits: 10,
    refLabel: "ZC Wan 2.7 720p/5s = 10 分",
    sortOrder: 20,
    resolution: "720p",
  },
];

const VIDEO_MODEL_CANDIDATES: Record<
  "txt2vid" | "img2vid",
  Record<"normal" | "spicy", Record<"low" | "high", ModelCandidate>>
> = {
  txt2vid: {
    normal: {
      low: {
        ids: ["wavespeed-ai/wan-2.2/t2v-480p", "wavespeed-ai/wan-2.2/t2v-480p-ultra-fast"],
      },
      high: {
        ids: [
          "wavespeed-ai/wan-2.2/t2v-720p",
          "bytedance/seedance-2.0-fast/text-to-video",
          "wavespeed-ai/wan-2.2/t2v-720p-ultra-fast",
        ],
      },
    },
    spicy: {
      low: {
        ids: [
          "bytedance/seedance-2.0-fast/text-to-video-spicy",
          "bytedance/seedance-v1.5-pro/text-to-video-spicy",
        ],
        pattern: /spicy.*(text-to-video|t2v)|(text-to-video|t2v).*spicy/i,
      },
      high: {
        ids: [
          "bytedance/seedance-2.0/text-to-video-spicy",
          "bytedance/seedance-2.0-fast/text-to-video-spicy",
        ],
        pattern: /spicy.*(text-to-video|t2v)|(text-to-video|t2v).*spicy/i,
      },
    },
  },
  img2vid: {
    normal: {
      low: {
        ids: ["wavespeed-ai/wan-2.2/i2v-480p", "wavespeed-ai/wan-2.2/i2v-480p-ultra-fast"],
      },
      high: {
        ids: [
          "wavespeed-ai/wan-2.2/i2v-720p",
          "bytedance/seedance-2.0-fast/image-to-video",
          "wavespeed-ai/wan-2.2/i2v-720p-ultra-fast",
        ],
      },
    },
    spicy: {
      low: {
        ids: [
          "bytedance/seedance-v1.5-pro/image-to-video-spicy",
          "bytedance/seedance-2.0-fast/image-to-video-spicy",
        ],
        pattern: /spicy.*(image-to-video|i2v)|(image-to-video|i2v).*spicy/i,
      },
      high: {
        ids: [
          "bytedance/seedance-2.0/image-to-video-spicy",
          "bytedance/seedance-v1.5-pro/image-to-video-spicy",
        ],
        pattern: /spicy.*(image-to-video|i2v)|(image-to-video|i2v).*spicy/i,
      },
    },
  },
};

/* --------------------------------------------------------------- 价格推导 */

/**
 * refCredits 以 ZenCreator 点数计；站内点数细分 10 倍后再套倍率。
 * ceil 而非 round：要求是「保证不低于 130%」，向下取整会跌破目标。
 */
export function deriveCreditCost(refCredits: number, multiplierBps: number): number {
  return Math.max(1, Math.ceil((refCredits * CREDIT_GRANULARITY * multiplierBps) / 10000));
}

/** 取整后的实际倍率，用于管理端核对是否偏离目标 */
export function effectiveMultiplierBps(refCredits: number, creditCost: number): number {
  if (refCredits <= 0) return 0;
  return Math.round((creditCost / (refCredits * CREDIT_GRANULARITY)) * 10000);
}

/* ------------------------------------------------------------ 蓝图生成 */

function imageSkus(): SkuBlueprint[] {
  const out: SkuBlueprint[] = [];
  const modes: ImageMode[] = ["txt2img", "img2img", "imgedit"];
  const modeLabel: Record<string, string> = {
    txt2img: "文字生图",
    img2img: "图片生图",
    imgedit: "图片编辑",
  };

  for (const mode of modes) {
    for (const spec of IMAGE_TIERS) {
      for (const spicy of [false, true]) {
        const bucket = spicy ? "spicy" : "normal";
        const cand = IMAGE_MODEL_CANDIDATES[mode][bucket][spec.tier];
        out.push({
          mode,
          tier: spec.tier,
          spicy,
          label: `${modeLabel[mode]} · ${spec.label}${spicy ? " Spicy" : ""}`,
          description: spicy
            ? `${spec.description} · 会员专属尺度档`
            : spec.description,
          refCredits: spec.refCredits,
          refLabel: spec.refLabel,
          unitSeconds: 0,
          sortOrder: spec.sortOrder + (spicy ? 100 : 0),
          isDefault: !spicy && spec.tier === "low",
          defaultInputs: spec.defaultInputs,
          modelCandidates: cand.ids,
          modelPattern: cand.pattern,
        });
      }
    }
  }
  return out;
}

function videoSkus(): SkuBlueprint[] {
  const out: SkuBlueprint[] = [];
  const modes = ["txt2vid", "img2vid"] as const;
  const modeLabel: Record<string, string> = {
    txt2vid: "文字生视频",
    img2vid: "图片生视频",
  };

  for (const mode of modes) {
    for (const spec of VIDEO_TIERS) {
      for (const spicy of [false, true]) {
        const bucket = spicy ? "spicy" : "normal";
        const cand = VIDEO_MODEL_CANDIDATES[mode][bucket][spec.tier as "low" | "high"];
        out.push({
          mode,
          tier: spec.tier,
          spicy,
          label: `${modeLabel[mode]} · ${spec.label}${spicy ? " Spicy" : ""}`,
          description: spicy ? `${spec.description} · 会员专属尺度档` : spec.description,
          refCredits: spec.refCredits,
          refLabel: spec.refLabel,
          unitSeconds: 5,
          sortOrder: spec.sortOrder + (spicy ? 100 : 0),
          isDefault: !spicy && spec.tier === "low",
          defaultInputs: {
            resolution: spec.resolution,
            duration: 5,
            // Spicy 视频模型默认带音轨会翻倍计价，关掉以保住毛利
            ...(spicy ? { enable_audio: false } : {}),
          },
          modelCandidates: cand.ids,
          modelPattern: cand.pattern,
        });
      }
    }
  }
  return out;
}

export function skuBlueprints(): SkuBlueprint[] {
  return [...imageSkus(), ...videoSkus()];
}
