/**
 * 生成端的模式与档位定义（客户端 / 服务端共用，不含任何上游模型信息）。
 *
 * 产品结构：
 *   图片 —— 文字生图 / 图片生图 / 图片编辑，各分 低 / 中 / 高 三档
 *   视频 —— 文字生视频 / 图片生视频，各分 低 / 高 两档
 *   视频转视频 —— 风格重绘 / 超分 / 续写 / 对口型 / 换脸，各分 低 / 高
 *   3D   —— 文字生 3D / 图片生 3D，单档
 *   脱衣 —— 成人模式专属，单档；系统注入 prompt，用户只选性别与参数
 * 图片/视频（文生、图生）另有 Spicy 变体（会员专属）；
 * 视频转视频与 3D 一律无 Spicy、不吃 VIP 门槛，任何等级用户都能用。
 */

export const GENERATION_MODES = [
  "txt2img",
  "img2img",
  "imgedit",
  "undress",
  "txt2vid",
  "img2vid",
  "ref2vid",
  // 视频转视频family：各自独立绑定模型与定价，UI 上折叠成一组子 tab
  "vid2vid",
  "vidupscale",
  "vidextend",
  "lipsync",
  "faceswap",
  // 3D
  "txt23d",
  "img23d",
] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const GENERATION_TIERS = ["low", "mid", "high"] as const;
export type GenerationTier = (typeof GENERATION_TIERS)[number];

export type GenerationCategory = "image" | "video" | "3d";

/**
 * 模式栏的分组。视频转视频那一族能力差异很大（超分和对口型几乎没有共同点），
 * 平铺会让模式栏长到十几个；折叠成一组、组内出子 tab 更好找。
 */
export const MODE_GROUPS = ["image", "video", "vid2vid", "3d"] as const;
export type ModeGroup = (typeof MODE_GROUPS)[number];

export type ModeMeta = {
  mode: GenerationMode;
  category: GenerationCategory;
  /** 模式栏里归到哪一组；同组多于一个模式时出子 tab */
  group: ModeGroup;
  /** 该模式开放的档位 */
  tiers: readonly GenerationTier[];
  /**
   * 是否必须提供输入媒体。
   * 具体要几个、什么类型（图/视频/音频）由绑定模型的 schema 决定，
   * 这里只回答「没有输入媒体能不能提交」——写死类型的话，
   * 对口型（视频+音频）和换脸（视频+人脸图）这种多输入模型就表达不了。
   */
  needsMedia: boolean;
  /** 是否需要提示词 */
  needsPrompt: boolean;
  supportsNegative: boolean;
  /** 图片模式支持 1/2/4 批量，视频与 3D 不支持 */
  supportsBatch: boolean;
  /** 是否有 Spicy 变体（会员专属尺度档） */
  hasSpicy: boolean;
  icon: string;
  /** 兜底文案；正式展示走 i18n */
  fallbackLabel: string;
};

const VIDEO_TIERS = ["low", "high"] as const;

export const MODE_META: Record<GenerationMode, ModeMeta> = {
  txt2img: {
    mode: "txt2img",
    category: "image",
    group: "image",
    tiers: GENERATION_TIERS,
    needsMedia: false,
    needsPrompt: true,
    supportsNegative: true,
    supportsBatch: true,
    hasSpicy: true,
    icon: "fa-font",
    fallbackLabel: "文字生图",
  },
  img2img: {
    mode: "img2img",
    category: "image",
    group: "image",
    tiers: GENERATION_TIERS,
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: true,
    supportsBatch: true,
    hasSpicy: true,
    icon: "fa-image",
    fallbackLabel: "图片生图",
  },
  imgedit: {
    mode: "imgedit",
    category: "image",
    group: "image",
    tiers: GENERATION_TIERS,
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: true,
    hasSpicy: true,
    icon: "fa-wand-magic-sparkles",
    fallbackLabel: "图片编辑",
  },
  undress: {
    mode: "undress",
    category: "image",
    group: "image",
    tiers: ["low"],
    needsMedia: true,
    needsPrompt: false,
    supportsNegative: true,
    supportsBatch: true,
    hasSpicy: false,
    icon: "fa-shirt",
    fallbackLabel: "脱衣模式",
  },
  txt2vid: {
    mode: "txt2vid",
    category: "video",
    group: "video",
    tiers: VIDEO_TIERS,
    needsMedia: false,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: true,
    icon: "fa-video",
    fallbackLabel: "文字生视频",
  },
  img2vid: {
    mode: "img2vid",
    category: "video",
    group: "video",
    tiers: VIDEO_TIERS,
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: true,
    icon: "fa-film",
    fallbackLabel: "图片生视频",
  },
  ref2vid: {
    mode: "ref2vid",
    category: "video",
    group: "video",
    tiers: VIDEO_TIERS,
    /*
     * 参考生视频与图片生视频的差别不只是「能传几张」：
     * 图生视频那张图是首帧，参考生视频的图/视频/音频是「素材」——
     * 模型按提示词里的 @Image1 / @Video1 / @Audio1 引用它们来组合画面。
     * Seedance 2.5 一次能收 30 图 + 10 视频 + 10 音频，塞进 img2vid 的
     * 单张首帧语义里表达不了，所以单开一个模式。
     *
     * needsMedia 为真，但上游把三个参考位都声明成选填（minItems 0）：
     * 一张不传就退化成文生视频，还按更贵的档位扣点，因此生成端另有一道
     * 「至少给一样素材」的拦截。
     */
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: true,
    icon: "fa-layer-group",
    fallbackLabel: "参考生视频",
  },

  /* ------------------------------------------------ 视频转视频（子 tab 一组） */

  vid2vid: {
    mode: "vid2vid",
    category: "video",
    group: "vid2vid",
    tiers: VIDEO_TIERS,
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-clapperboard",
    fallbackLabel: "视频重绘",
  },
  vidupscale: {
    mode: "vidupscale",
    category: "video",
    group: "vid2vid",
    tiers: VIDEO_TIERS,
    // 超分是纯画质提升，提示词没有用武之地
    needsMedia: true,
    needsPrompt: false,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-up-right-and-down-left-from-center",
    fallbackLabel: "视频超分",
  },
  vidextend: {
    mode: "vidextend",
    category: "video",
    group: "vid2vid",
    tiers: VIDEO_TIERS,
    needsMedia: true,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-forward",
    fallbackLabel: "视频续写",
  },
  lipsync: {
    mode: "lipsync",
    category: "video",
    group: "vid2vid",
    tiers: VIDEO_TIERS,
    // 视频 + 音频两个输入，都由 schema 描述
    needsMedia: true,
    needsPrompt: false,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-comment-dots",
    fallbackLabel: "视频对口型",
  },
  faceswap: {
    mode: "faceswap",
    category: "video",
    group: "vid2vid",
    tiers: VIDEO_TIERS,
    // 视频 + 人脸图两个输入
    needsMedia: true,
    needsPrompt: false,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-masks-theater",
    fallbackLabel: "视频换脸",
  },

  /* ------------------------------------------------------------------ 3D */

  txt23d: {
    mode: "txt23d",
    category: "3d",
    group: "3d",
    tiers: ["low"],
    needsMedia: false,
    needsPrompt: true,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-cube",
    fallbackLabel: "文字生 3D",
  },
  img23d: {
    mode: "img23d",
    category: "3d",
    group: "3d",
    tiers: ["low"],
    needsMedia: true,
    needsPrompt: false,
    supportsNegative: false,
    supportsBatch: false,
    hasSpicy: false,
    icon: "fa-cubes",
    fallbackLabel: "图片生 3D",
  },
};

export const MODE_LIST: ModeMeta[] = GENERATION_MODES.map((m) => MODE_META[m]);

export const GROUP_META: Record<ModeGroup, { icon: string; fallbackLabel: string }> = {
  image: { icon: "fa-image", fallbackLabel: "图片" },
  video: { icon: "fa-film", fallbackLabel: "视频" },
  vid2vid: { icon: "fa-clapperboard", fallbackLabel: "视频转视频" },
  "3d": { icon: "fa-cube", fallbackLabel: "3D" },
};

/** 每组下的模式，保持 GENERATION_MODES 的声明顺序 */
export function modesInGroup(group: ModeGroup): ModeMeta[] {
  return MODE_LIST.filter((m) => m.group === group);
}

export function isGenerationMode(v: unknown): v is GenerationMode {
  return typeof v === "string" && (GENERATION_MODES as readonly string[]).includes(v);
}

export function isGenerationTier(v: unknown): v is GenerationTier {
  return typeof v === "string" && (GENERATION_TIERS as readonly string[]).includes(v);
}

export function modeCategory(mode: string): GenerationCategory {
  return isGenerationMode(mode) ? MODE_META[mode].category : "image";
}

export function modeGroup(mode: string): ModeGroup {
  return isGenerationMode(mode) ? MODE_META[mode].group : "image";
}

export function modeNeedsMedia(mode: string): boolean {
  return isGenerationMode(mode) ? MODE_META[mode].needsMedia : false;
}

/** @deprecated 改用 modeNeedsMedia；输入媒体不再假定一定是图片 */
export const modeNeedsImage = modeNeedsMedia;

/** 视频档位的计价基准秒数；实际时长按 ceil(duration / unitSeconds) 计费 */
export const VIDEO_UNIT_SECONDS = 5;

export function durationMultiplier(durationSeconds: number, unitSeconds: number): number {
  if (unitSeconds <= 0) return 1;
  const d = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : unitSeconds;
  return Math.max(1, Math.ceil(d / unitSeconds));
}
