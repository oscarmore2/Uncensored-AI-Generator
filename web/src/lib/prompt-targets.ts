import "server-only";
import { MODE_META, isGenerationMode, type GenerationMode } from "./generation-modes";

/**
 * 魔法指令的目标画像：只描述「模式 + 档位」的写作要求，
 * 刻意不含任何上游模型信息 —— 生成端与提示词服务都不应知道底层模型。
 */

export type PromptFormatId =
  | "image_t2i"
  | "image_i2i"
  | "image_edit"
  | "video_t2v"
  | "video_i2v"
  | "video_edit"
  | "model_3d";

export type PromptTarget = {
  mode: GenerationMode;
  formatId: PromptFormatId;
  promptField: "prompt";
  supportsNegative: boolean;
  /** 档位只影响详略程度，不暴露模型 */
  tier: string;
  spicy: boolean;
};

const FORMAT_BY_MODE: Record<GenerationMode, PromptFormatId> = {
  txt2img: "image_t2i",
  img2img: "image_i2i",
  imgedit: "image_edit",
  undress: "image_edit",
  txt2vid: "video_t2v",
  img2vid: "video_i2v",
  // 视频转视频一族：写作要求都是「在已有片子上改什么」，共用一套规则；
  // 超分 / 对口型 / 换脸本身不需要提示词，走到这里也只是兜底
  vid2vid: "video_edit",
  vidupscale: "video_edit",
  vidextend: "video_edit",
  lipsync: "video_edit",
  faceswap: "video_edit",
  txt23d: "model_3d",
  img23d: "model_3d",
};

export function resolvePromptTarget(
  mode: string,
  opts?: { tier?: string; spicy?: boolean }
): PromptTarget {
  const m: GenerationMode = isGenerationMode(mode) ? mode : "txt2img";
  return {
    mode: m,
    formatId: FORMAT_BY_MODE[m],
    promptField: "prompt",
    supportsNegative: MODE_META[m].supportsNegative,
    tier: opts?.tier ?? "low",
    spicy: Boolean(opts?.spicy),
  };
}

export const PROMPT_FORMAT_RULES: Record<PromptFormatId, string[]> = {
  image_t2i: [
    "目标字段: prompt（文字生图）+ 可选 negative_prompt",
    "结构建议: 主体 → 外貌/服饰 → 动作姿态 → 环境 → 光影镜头 → 画质",
    "用逗号分隔短语，避免长段落叙事",
    "不要写参数语法（如 --ar、CFG、steps）",
    "negative_prompt 用简短否定词列表，聚焦畸形/低质量/水印",
  ],
  image_i2i: [
    "目标字段: prompt（图片生图，基于参考图重绘）",
    "必须强调保留参考图人物身份、脸部特征与大体构图",
    "写清要强化什么：材质、光影、氛围、风格",
    "不要推倒重来另画一个人",
  ],
  image_edit: [
    "目标字段: prompt（图片编辑，指令式）",
    "写成一句明确的编辑指令：改什么 + 保留什么",
    "只描述改动点，不要复述整张图",
    "不要输出 negative_prompt",
  ],
  video_t2v: [
    "目标字段: prompt（文字生视频）",
    "写成「镜头脚本」：主体 + 连续动作 + 镜头运动 + 节奏",
    "明确运镜（推拉摇移、跟拍、固定机位），避免静态海报式描述",
    "动作动词要具体、可拍摄",
    "不要堆砌静态画质词，不要输出 negative_prompt",
  ],
  video_i2v: [
    "目标字段: prompt（图片生视频）",
    "基于参考图写「动态指令」：表情/肢体/环境微动 + 轻微运镜",
    "保持人物与场景身份一致，不要改成另一个人",
    "动作幅度适中，匹配 5 秒短视频",
    "不要输出 negative_prompt",
  ],
  video_edit: [
    "目标字段: prompt（视频转视频，指令式）",
    "写成一句明确的改动指令：改什么 + 保留什么",
    "已有片子的主体身份、镜头调度默认全部保留，只描述要变的部分",
    "不要重新描述整段视频内容，不要输出 negative_prompt",
  ],
  model_3d: [
    "目标字段: prompt（生成 3D 模型）",
    "描述单个物体：形态 → 材质 → 配色 → 风格，不要写场景与背景",
    "强调结构完整、闭合网格，避免透明/镂空/极细长的悬空结构",
    "不要写运镜、光影与画质词——它们对网格生成没有作用",
    "不要输出 negative_prompt",
  ],
};
