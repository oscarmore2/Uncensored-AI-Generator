import "server-only";
import { env } from "./env";

export type GenerationMode = "txt2img" | "txt2vid" | "img2img" | "img2vid" | "undress";

export type ZenPromptField = "positive_prompt" | "prompt" | "none";

export type ZenPromptFormatId = "sdxl_t2i" | "sdxl_i2i" | "wan_t2v" | "wan_i2v" | "undress";

/** 与 Zen Creator 实际调用对齐的目标模型元数据 */
export type ZenGenerationTarget = {
  mode: GenerationMode;
  tool: string;
  model: string;
  promptField: ZenPromptField;
  supportsNegative: boolean;
  formatId: ZenPromptFormatId;
  undressVariant?: "female" | "male" | "couple";
};

export function resolveZenGenerationTarget(
  mode: string,
  opts?: { undress_variant?: string }
): ZenGenerationTarget {
  switch (mode) {
    case "txt2img":
      return {
        mode: "txt2img",
        tool: "by_prompt",
        model: env.DEMO_MODE ? "GENERAL_NSFW" : "SDXL_NSFW",
        promptField: "positive_prompt",
        supportsNegative: true,
        formatId: "sdxl_t2i",
      };
    case "img2img":
      return {
        mode: "img2img",
        tool: "image_editor",
        model: "SDXL_NSFW",
        promptField: "prompt",
        supportsNegative: false,
        formatId: "sdxl_i2i",
      };
    case "txt2vid":
      return {
        mode: "txt2vid",
        tool: "text_to_video",
        model: env.DEMO_MODE ? "seedance_2_0" : "wan@2.7-nsfw",
        promptField: "prompt",
        supportsNegative: false,
        formatId: "wan_t2v",
      };
    case "img2vid":
      return {
        mode: "img2vid",
        tool: "videogen",
        model: "wan@2.7-nsfw",
        promptField: "prompt",
        supportsNegative: false,
        formatId: "wan_i2v",
      };
    case "undress": {
      const variantRaw = opts?.undress_variant ?? "female";
      const undressVariant =
        variantRaw === "male" || variantRaw === "couple" ? variantRaw : "female";
      const tool =
        undressVariant === "male"
          ? "male_undresser"
          : undressVariant === "couple"
            ? "couple_undresser"
            : "undress";
      return {
        mode: "undress",
        tool,
        model: tool,
        promptField: "none",
        supportsNegative: false,
        formatId: "undress",
        undressVariant,
      };
    }
    default:
      return {
        mode: "txt2img",
        tool: "by_prompt",
        model: env.DEMO_MODE ? "GENERAL_NSFW" : "SDXL_NSFW",
        promptField: "positive_prompt",
        supportsNegative: true,
        formatId: "sdxl_t2i",
      };
  }
}

/** 各目标模型的提示词格式规则（发给 LLM） */
export const PROMPT_FORMAT_RULES: Record<ZenPromptFormatId, string[]> = {
  sdxl_t2i: [
    "目标字段: positive_prompt（文生图）+ 可选 negative_prompt",
    "风格: 自然语言为主，可夹少量英文质量词（如 8k, masterpiece）",
    "结构建议: 主体 → 外貌/服饰 → 动作姿态 → 环境 → 光影镜头 → 画质",
    "用逗号或中文顿号分隔短语，避免长段落叙事",
    "不要写参数语法（如 --ar、CFG、steps）",
    "negative_prompt 用简短否定词列表，聚焦畸形/低质量/水印",
  ],
  sdxl_i2i: [
    "目标字段: prompt（图生图 / image_editor）",
    "写成「编辑指令」：说明要改什么、保留什么",
    "必须强调保留参考图人物身份、脸部特征与大体构图",
    "可补充材质、光影、氛围，但不要推倒重来另画一个人",
    "不要输出 negative_prompt",
  ],
  wan_t2v: [
    "目标字段: prompt（文生视频 wan / seedance）",
    "写成「镜头脚本」：主体 + 连续动作 + 镜头运动 + 时长感",
    "明确运镜（推拉摇移、跟拍、固定机位）与节奏，避免静态海报描述",
    "中英混合可接受；动作动词要具体、可拍摄",
    "不要堆砌静态画质词（如 8k masterpiece 过多无益）",
    "不要输出 negative_prompt",
  ],
  wan_i2v: [
    "目标字段: prompt（图生视频 videogen）",
    "基于参考图写「动态指令」：表情/肢体/环境微动 + 轻微运镜",
    "保持人物与场景身份一致，不要改成另一个人",
    "动作幅度适中，适合 4 秒短视频",
    "不要输出 negative_prompt",
  ],
  undress: [
    "当前模式主要靠参考图，Zen 侧不发送文本 prompt",
    "若仍扩写，只输出极短编辑意图（保持姿态与身份）",
  ],
};
