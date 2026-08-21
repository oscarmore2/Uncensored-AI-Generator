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
  tier: ImageTier;
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
    description: "出图最快 · 成本最低 · 适合草稿与批量试错",
    refCredits: 1,
    refLabel: "ZC Text-to-Image (General) = 1 分",
    sortOrder: 10,
    // 不再硬编码固定 size：各模型允许的宽高范围差异很大（有的上限 1536，
    // 有的支持到 4096），写死一个值必然在某些模型上超界触发上游 400。
    // 交给「档位 → 参数控件」按绑定模型的 schema 生成宽高编辑器，
    // 默认「保持原图尺寸」（即不发送该字段，模型走自己的默认行为）。
    defaultInputs: { enable_base64_output: false },
  },
  {
    tier: "mid",
    label: "高清",
    description: "细节与提示词还原更稳 · 日常主力档",
    refCredits: 2,
    refLabel: "ZC Text-to-Image (Qwen Pro / WAN Pro) = 2 分",
    sortOrder: 20,
    defaultInputs: { enable_base64_output: false },
  },
  {
    tier: "high",
    label: "旗舰",
    description: "顶级画质与文字/结构准确度 · 成片交付",
    refCredits: 4,
    refLabel: "ZC Image Editor (Nano Banana 2) = 4 分",
    sortOrder: 30,
    defaultInputs: { enable_base64_output: false },
  },
];

type ImageMode = "txt2img" | "img2img" | "imgedit";
/** 图片没有终极档：模型价格跨度撑不起第四档 */
type ImageTier = "low" | "mid" | "high";
type ModelCandidate = { ids: string[]; pattern?: RegExp };

const IMAGE_MODEL_CANDIDATES: Record<
  ImageMode,
  Record<"normal" | "spicy", Record<ImageTier, ModelCandidate>>
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

/**
 * 终极档在各模式下开哪些变体（false = 普通档，true = Spicy 档）。
 * 低档与高档一律普通 + Spicy 两个都开，只有终极档按模式分。
 *
 * 图片生视频与参考生视频拿用户自己的素材做旗舰级视频，是尺度档才成立的玩法，
 * 所以这两个模式的终极档**只有** Spicy，并且锁到 VIP2（见 minVipRankFor）。
 * 文生视频没有输入素材，终极档走普通档。
 */
const ULTRA_FLAVORS: Record<VideoMode, boolean[]> = {
  txt2vid: [false],
  img2vid: [true],
  ref2vid: [true],
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
  {
    /*
     * 终极档：留给单价明显高出一截的旗舰模型。
     * 对标 Seedance 2.5 的 $0.134/秒，按现有换算口径（对标点数 ≈ 上游单价 × 100，
     * 这个口径正好复现低档的 6 分和高档的 10 分）得 14 分。
     *
     * ⚠ 这 14 分是按 **Atlas** 的价算的，两家差得很远（2026-08 实测，720p）：
     *     Atlas      seedance-2.5  $0.134/秒  → 5 秒 $0.67
     *     WaveSpeed  seedance-2.5  $0.36/秒   → 5 秒 $1.80
     *   14 分 → creditCost 182 → 售价 ≈ $1.82。绑 Atlas 时毛利约 2.7 倍；
     *   一旦落到 WaveSpeed 的同名模型，毛利只剩 1% 左右。
     *   所以终极档的候选**只列 Atlas 独有的 reference-to-video 端点**，
     *   换绑或加兜底之前先回来看这段。
     *
     * 分辨率仍是 720p。Seedance 2.5 实际支持到 1080p/4k、时长 4~30 秒
     * （早先注释写的「只支持 480p/720p」不对），选 720p 是价格与观感的取舍。
     * description 是要给用户看的，所以只说体感差别，不提模型名。
     *
     * 开哪些变体按模式走，见 ULTRA_FLAVORS。
     */
    tier: "ultra",
    label: "终极模式",
    description: "720p · 5 秒起 · 旗舰模型，运镜、光影与音画同步最强",
    refCredits: 14,
    refLabel: "Seedance 2.5 = $0.134/秒（Atlas），720p/5s ≈ $0.67",
    sortOrder: 30,
    resolution: "720p",
  },
];

type VideoMode = "txt2vid" | "img2vid" | "ref2vid";
type VideoTier = "low" | "high" | "ultra";

const VIDEO_MODEL_CANDIDATES: Record<
  VideoMode,
  Record<"normal" | "spicy", Record<VideoTier, ModelCandidate>>
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
      ultra: {
        ids: ["bytedance/seedance-2.5/text-to-video", "bytedance/seedance-2.0/text-to-video"],
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
      // 终极档不出 Spicy（见 VIDEO_TIERS 里的说明），候选留空免得日后被误填
      ultra: { ids: [] },
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
      ultra: {
        ids: ["bytedance/seedance-2.5/image-to-video", "bytedance/seedance-2.0/image-to-video"],
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
      /*
       * 终极档的 Spicy 变体仍然对标 Seedance 2.5——这里的 spicy 是「会员专属档」
       * 的产品标记（requiresVip + 1.5 倍率），不代表一定要绑 uncensored 模型。
       * 绑成 wan-2.7-spicy（$0.10）的话，14 分的定价就失去成本依据了：
       * 那个模型高级档就覆盖得住，同一个模型在终极档多收四成。
       * 想要「最强尺度档」而不是「最强模型」的话，把首选换成 wan-2.7-spicy
       * 并把 refCredits 调回 10。
       */
      ultra: {
        /*
         * ⚠ 顺序不能随手调，它直接决定这一档赚不赚钱。
         *
         * seedance-2.5 的 spicy 变体**只有 WaveSpeed 有**（Atlas 没有）。
         * 而两家同款模型的单价差 2.7 倍（2026-08 实测，720p）：
         *     Atlas      $0.134/秒 → 5 秒 $0.67
         *     WaveSpeed  $0.36/秒  → 5 秒 $1.80
         * 本档 refCredits=14 是按 Atlas 推的，售价约 $1.82。
         * 绑 Atlas 毛利 2.7 倍；一旦绑到 WaveSpeed 只剩 1%，等于按成本价卖。
         *
         * 所以首选放非 spicy 的 2.5（会命中 Atlas），uncensored 变体留在后面
         * 只作兜底——这一档的 spicy 首先是「会员专属 + 1.5 倍率」的产品标记，
         * 不是非绑 uncensored 模型不可（沿用本文件既有口径）。
         *
         * 真想让终极档用上 uncensored 变体：把 image-to-video-spicy 提到首位，
         * **同时**把 VIDEO_TIERS 里的 refCredits 从 14 调到约 180，两件事一起做。
         */
        ids: [
          "bytedance/seedance-2.5/image-to-video",
          "bytedance/seedance-2.0/image-to-video",
          "bytedance/seedance-2.5/image-to-video-spicy",
        ],
      },
    },
  },
  /*
   * 上游有 25 个 reference-to-video 模型，能力（收几张图 / 收不收视频与音频）
   * 与单价都差得很远，这里按各档位的对标单价挑，其余交给管理端手工换绑：
   *   低档 $0.06 一线 —— seedance-2.0-mini $0.039 / vidu-q3 $0.042
   *   高档 $0.10 一线 —— wan-2.7 $0.10 / seedance-2.0-fast $0.072
   *   终极 $0.134/秒 —— seedance-2.5，这一族里最强也最贵的
   *
   * 注：seedance 全系的 reference-to-video 端点**只有 Atlas 有**，WaveSpeed 没有
   * （2026-08 实测两家的 schema 文件）。这些候选 id 别按「WaveSpeed 上搜不到」
   * 就删掉——播种是跨上游查的，provider 会跟着一起写回产品行。
   */
  ref2vid: {
    normal: {
      low: {
        ids: [
          "bytedance/seedance-2.0-mini/reference-to-video",
          "vidu/q3/reference-to-video",
          "pixverse/v6/reference-to-video",
        ],
        pattern: /reference-to-video/i,
      },
      high: {
        ids: [
          "alibaba/wan-2.7/reference-to-video",
          "bytedance/seedance-2.0-fast/reference-to-video",
          "kwaivgi/kling-video-o3-std/reference-to-video",
        ],
        pattern: /reference-to-video/i,
      },
      ultra: {
        ids: [
          "bytedance/seedance-2.5/reference-to-video",
          "bytedance/seedance-2.0/reference-to-video",
        ],
      },
    },
    spicy: {
      // 这一族目前只有 wan-2.7-spicy 一个尺度档，低/高共用
      low: {
        ids: ["atlascloud/wan-2.7-spicy/reference-to-video"],
        pattern: /(spicy|uncensored|nsfw).*reference-to-video|reference-to-video.*(spicy|uncensored|nsfw)/i,
      },
      high: {
        ids: ["atlascloud/wan-2.7-spicy/reference-to-video"],
        pattern: /(spicy|uncensored|nsfw).*reference-to-video|reference-to-video.*(spicy|uncensored|nsfw)/i,
      },
      // 同 img2vid 的终极档：仍然对标 Seedance 2.5，理由见上
      ultra: {
        ids: [
          "bytedance/seedance-2.5/reference-to-video",
          "bytedance/seedance-2.0/reference-to-video",
        ],
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

  // 脱衣模式：单档，成人模式专属；模型由管理端手工桥接
  const undressLow = IMAGE_TIERS[0];
  out.push({
    mode: "undress",
    tier: "low",
    spicy: false,
    label: "脱衣模式 · 标准",
    description: "上传人物图，一键脱衣 · 仅成人模式可用",
    refCredits: undressLow.refCredits,
    refLabel: undressLow.refLabel,
    unitSeconds: 0,
    sortOrder: 10,
    isDefault: true,
    defaultInputs: { enable_base64_output: false },
    modelCandidates: [
      "wavespeed-ai/qwen-image/edit-plus",
      "wavespeed-ai/qwen-image/edit",
      "wavespeed-ai/flux-kontext-dev",
      "wavespeed-ai/flux-dev/image-to-image",
      "wavespeed-ai/z-image-turbo/image-to-image",
    ],
    modelPattern: /(edit|image-to-image|kontext|inpaint)/i,
  });

  return out;
}

function videoSkus(): SkuBlueprint[] {
  const out: SkuBlueprint[] = [];
  const modes: VideoMode[] = ["txt2vid", "img2vid", "ref2vid"];
  const modeLabel: Record<VideoMode, string> = {
    txt2vid: "文字生视频",
    img2vid: "图片生视频",
    ref2vid: "参考生视频",
  };

  for (const mode of modes) {
    for (const spec of VIDEO_TIERS) {
      const flavors = spec.tier === "ultra" ? ULTRA_FLAVORS[mode] : [false, true];
      for (const spicy of flavors) {
        const bucket = spicy ? "spicy" : "normal";
        const tier = spec.tier as VideoTier;
        const cand = VIDEO_MODEL_CANDIDATES[mode][bucket][tier];
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
            /*
             * Spicy 视频模型默认带音轨会翻倍计价，关掉以保住毛利。
             * 两个字段名都写：这个开关在 WaveSpeed 叫 enable_audio，
             * 在 Atlas 叫 generate_audio（Atlas 上 enable_audio 一个模型都没有），
             * 只写一个的话另一家的模型会把它当未知字段丢掉，音轨照开、照收钱。
             * 桥接层会按绑定模型的 schema 只留下它认识的那个。
             */
            ...(spicy ? { enable_audio: false, generate_audio: false } : {}),
          },
          modelCandidates: cand.ids,
          modelPattern: cand.pattern,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------- 视频转视频（子 tab 一族） */

/**
 * 这一族每个子模式都独立绑定模型、独立定价：
 * 超分几乎不要钱（$0.003），对口型是它的七十倍（$0.22），
 * 混成一个档位定价必然要么亏要么贵得离谱。
 * 全部不设 Spicy、不吃 VIP 门槛——任何等级用户都能用。
 */
type Vid2VidSpec = {
  mode: "vid2vid" | "vidupscale" | "vidextend" | "lipsync" | "faceswap";
  label: string;
  /** 低档 / 高档的说明 */
  descriptions: [string, string];
  /** 低档 / 高档的 ZenCreator 对标点数 */
  refCredits: [number, number];
  refLabel: string;
  sortOrder: number;
  unitSeconds: number;
  candidates: [ModelCandidate, ModelCandidate];
};

const VID2VID_SPECS: Vid2VidSpec[] = [
  {
    mode: "vid2vid",
    label: "视频重绘",
    descriptions: ["按提示词重绘画面风格 · 快速档", "保真度与稳定性更高 · 成片档"],
    refCredits: [8, 12],
    refLabel: "ZC 视频编辑",
    sortOrder: 10,
    unitSeconds: 5,
    candidates: [
      { ids: ["alibaba/wan-2.6/video-to-video"], pattern: /video-to-video|video-edit/i },
      { ids: ["alibaba/wan-2.7/video-edit"], pattern: /video-edit|video-to-video/i },
    ],
  },
  {
    mode: "vidupscale",
    label: "视频超分",
    descriptions: ["提升清晰度 · 成本最低", "更强修复与细节重建"],
    refCredits: [1, 3],
    refLabel: "ZC 视频增强",
    sortOrder: 20,
    unitSeconds: 5,
    candidates: [
      { ids: ["byteplus/video/upscaler", "tencent/video/upscaler"], pattern: /upscal/i },
      { ids: ["atlascloud/video-upscaler"], pattern: /upscal/i },
    ],
  },
  {
    mode: "vidextend",
    label: "视频续写",
    descriptions: ["在原片后续接一段 · 快速档", "衔接更自然 · 成片档"],
    refCredits: [3, 6],
    refLabel: "ZC 视频续写",
    sortOrder: 30,
    unitSeconds: 5,
    candidates: [
      { ids: ["ltx-2.3-quality/extend-video", "pixverse/v6/video-extend"], pattern: /extend/i },
      { ids: ["pixverse/v6/video-extend"], pattern: /extend/i },
    ],
  },
  {
    mode: "lipsync",
    label: "视频对口型",
    descriptions: ["按音频对口型 · 快速档", "口型与表情更贴 · 成片档"],
    refCredits: [2, 20],
    refLabel: "ZC 对口型",
    sortOrder: 40,
    unitSeconds: 5,
    candidates: [
      { ids: ["veed/lipsync"], pattern: /lipsync|lip-sync/i },
      { ids: ["sync/lipsync-v3"], pattern: /lipsync|lip-sync/i },
    ],
  },
  {
    mode: "faceswap",
    label: "视频换脸",
    descriptions: ["把指定人脸换进视频 · 快速档", "更稳定的贴合与光影"],
    refCredits: [10, 18],
    refLabel: "ZC 换脸",
    sortOrder: 50,
    unitSeconds: 5,
    candidates: [
      { ids: ["atlascloud/face-swap-video"], pattern: /face.?swap/i },
      { ids: ["atlascloud/face-swap-video"], pattern: /face.?swap/i },
    ],
  },
];

function vid2vidSkus(): SkuBlueprint[] {
  const out: SkuBlueprint[] = [];
  for (const spec of VID2VID_SPECS) {
    (["low", "high"] as const).forEach((tier, i) => {
      out.push({
        mode: spec.mode,
        tier,
        spicy: false,
        label: `${spec.label} · ${tier === "low" ? "标准" : "高级"}`,
        description: spec.descriptions[i],
        refCredits: spec.refCredits[i],
        refLabel: spec.refLabel,
        unitSeconds: spec.unitSeconds,
        sortOrder: spec.sortOrder + i,
        isDefault: tier === "low",
        defaultInputs: {},
        modelCandidates: spec.candidates[i].ids,
        modelPattern: spec.candidates[i].pattern,
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 3D */

/**
 * 3D 单档：全网可选模型总共才 7 个、价格跨度也不大（$0.02–$0.35），
 * 分档只会多出一堆没模型可绑的空档位。
 */
function threeDSkus(): SkuBlueprint[] {
  return [
    {
      mode: "txt23d",
      tier: "low",
      spicy: false,
      label: "文字生 3D · 标准",
      description: "一句话生成可旋转的 3D 模型 · 支持导出 GLB",
      refCredits: 4,
      refLabel: "ZC 3D 生成",
      unitSeconds: 0,
      sortOrder: 10,
      isDefault: true,
      defaultInputs: {},
      modelCandidates: [
        "tencent/hunyuan3d-rapid/text-to-3d",
        "tencent/hunyuan3d-pro/text-to-3d",
        "tripo-h3.1/text-to-3d",
      ],
      modelPattern: /text-to-3d/i,
    },
    {
      mode: "img23d",
      tier: "low",
      spicy: false,
      label: "图片生 3D · 标准",
      description: "上传一张图，生成可旋转的 3D 模型 · 支持导出 GLB",
      refCredits: 5,
      refLabel: "ZC 3D 生成",
      unitSeconds: 0,
      sortOrder: 10,
      isDefault: true,
      defaultInputs: {},
      modelCandidates: [
        "tencent/hunyuan3d-rapid/image-to-3d",
        "tencent/hunyuan3d-pro/image-to-3d",
        "tripo-h3.1/image-to-3d",
        "bytedance/seed3d-v2.0/image-to-3d",
      ],
      modelPattern: /image-to-3d/i,
    },
  ];
}

export function skuBlueprints(): SkuBlueprint[] {
  return [...imageSkus(), ...videoSkus(), ...vid2vidSkus(), ...threeDSkus()];
}
