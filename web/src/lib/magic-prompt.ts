import "server-only";
import { getActiveHfCredentials } from "./hf";
import {
  PROMPT_FORMAT_RULES,
  resolveZenGenerationTarget,
  type ZenGenerationTarget,
  type ZenPromptFormatId,
} from "./zen-targets";
import { formatIdForProduct, resolveGenerationProduct } from "./pricing";

export type MagicPromptInput = {
  prompt: string;
  mode?: string;
  style?: string;
  ratio?: string;
  quality?: string;
  undress_variant?: string;
  negative_prompt?: string;
  zen_model?: string;
};

export type MagicPromptResult = {
  prompt: string;
  negative_prompt?: string;
  source: "local" | "dolphin";
  target?: {
    mode: string;
    tool: string;
    model: string;
    prompt_field: string;
  };
};

const QUALITY_TAIL =
  "超高细节, 锐利对焦, 自然皮肤纹理, 电影级光影, 8k, masterpiece, best quality";

const STYLE_HINTS: Record<string, string> = {
  realistic: "写实摄影风格, 自然肤色, 浅景深, 85mm镜头",
  anime: "高质量动漫风, 精致线稿, 鲜艳色彩, 动漫照明",
  artistic: "艺术摄影, 戏剧性构图, 氛围感光影",
};

const RATIO_HINTS: Record<string, string> = {
  "1:1": "居中构图",
  "9:16": "竖构图, 全身或半身优先",
  "16:9": "横构图, 环境景深",
  "4:3": "经典摄影构图",
};

/** 发给 LLM 的任务元数据：标明用途与目标模型 */
export type MagicPromptTaskMetadata = {
  purpose: "optimize_generation_prompt";
  description: string;
  app_mode: string;
  zen_tool: string;
  zen_model: string;
  prompt_field: string;
  supports_negative: boolean;
  format_id: string;
  style?: string;
  ratio?: string;
  quality?: string;
  undress_variant?: string;
};

function buildTaskMetadata(
  input: MagicPromptInput,
  target: ZenGenerationTarget
): MagicPromptTaskMetadata {
  return {
    purpose: "optimize_generation_prompt",
    description: "Optimize the user's draft into a generation prompt for the target Zen model/tool.",
    app_mode: target.mode,
    zen_tool: target.tool,
    zen_model: target.model,
    prompt_field: target.promptField,
    supports_negative: target.supportsNegative,
    format_id: target.formatId,
    ...(input.style ? { style: input.style } : {}),
    ...(input.ratio ? { ratio: input.ratio } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(target.undressVariant ? { undress_variant: target.undressVariant } : {}),
  };
}

function buildSystemPrompt(target: ZenGenerationTarget): string {
  const rules = PROMPT_FORMAT_RULES[target.formatId].map((r) => `- ${r}`).join("\n");
  const outputHint = target.supportsNegative
    ? `输出格式：只输出一个 JSON 对象，不要 markdown，不要解释：
{"positive_prompt":"...","negative_prompt":"..."}`
    : `输出格式：只输出优化后的提示词正文（对应字段 ${target.promptField}），不要 JSON、不要引号、不要 markdown、不要解释。`;

  return `You are an AI media prompt editor. Follow the platform content policy and never add sexual, adult, exploitative, or graphic/gory material.

你的任务元数据 purpose=optimize_generation_prompt：专门把用户草稿优化成「下游生成模型」可直接使用的 prompt，而不是普通聊天回复。

当前目标：
- app_mode: ${target.mode}
- zen_tool: ${target.tool}
- zen_model: ${target.model}
- prompt_field: ${target.promptField}

该模型的格式规则：
${rules}

通用要求：
1. 保留用户的安全创作意图；不得添加色情、成人、剥削或写实血腥内容
2. 严格按上述目标模型格式写，不要混用其它模型的写法
3. 控制在约 60-220 字（视频可略短、偏动作）
4. ${outputHint}`;
}

function buildUserMessage(input: MagicPromptInput, meta: MagicPromptTaskMetadata): string {
  const rules = PROMPT_FORMAT_RULES[meta.format_id as keyof typeof PROMPT_FORMAT_RULES] ?? [];
  return [
    "## Task Metadata (do not ignore)",
    "```json",
    JSON.stringify(meta, null, 2),
    "```",
    "",
    "## Format Rules",
    ...rules.map((r) => `- ${r}`),
    "",
    "## Current User Selections",
    `- style: ${input.style ?? "realistic"}`,
    `- ratio: ${input.ratio ?? "1:1"}`,
    `- quality: ${input.quality ?? "quality"}`,
    input.negative_prompt?.trim()
      ? `- existing_negative_prompt: ${input.negative_prompt.trim()}`
      : null,
    "",
    "## User Draft Prompt",
    input.prompt.trim(),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function stripBoilerplate(text: string): string {
  return text
    .replace(
      /\s*(超高细节|锐利对焦|自然皮肤纹理|电影级光影|8k|masterpiece|best quality|写实摄影风格|高质量动漫风)[^,，]*/gi,
      ""
    )
    .replace(/[,，\s]+$/g, "")
    .trim();
}

function parseLlmPromptOutput(
  content: string,
  target: ZenGenerationTarget
): { prompt: string; negative_prompt?: string } {
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  if (target.supportsNegative) {
    try {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
          positive_prompt?: string;
          prompt?: string;
          negative_prompt?: string;
        };
        const positive = (obj.positive_prompt ?? obj.prompt ?? "").trim();
        if (positive) {
          return {
            prompt: positive,
            negative_prompt: obj.negative_prompt?.trim() || undefined,
          };
        }
      }
    } catch {
      // fall through to plain text
    }
  }

  return {
    prompt: cleaned.replace(/^["「]|["」]$/g, "").trim(),
  };
}

function withTarget(
  result: Omit<MagicPromptResult, "target">,
  target: ZenGenerationTarget
): MagicPromptResult {
  return {
    ...result,
    target: {
      mode: target.mode,
      tool: target.tool,
      model: target.model,
      prompt_field: target.promptField,
    },
  };
}

/** 本地扩写：按目标模型格式兜底 */
export function enhancePromptLocal(input: MagicPromptInput): MagicPromptResult {
  const raw = input.prompt.trim();
  if (!raw) throw new Error("请先输入提示词");

  const target = resolveZenGenerationTarget(input.mode ?? "txt2img", {
    undress_variant: input.undress_variant,
  });
  const core = stripBoilerplate(raw);
  const style = STYLE_HINTS[input.style ?? "realistic"] ?? STYLE_HINTS.realistic;
  const ratioHint = RATIO_HINTS[input.ratio ?? ""] ?? "";

  if (target.formatId === "wan_t2v") {
    const prompt = [
      core,
      "连贯动作推进",
      "自然镜头运动",
      ratioHint || "电影感运镜",
      style,
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget({ prompt, source: "local" }, target);
  }

  if (target.formatId === "wan_i2v") {
    const prompt = [
      "保持参考图人物与场景身份",
      core,
      "轻微表情与姿态变化",
      "缓慢推近或固定机位微动",
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget({ prompt, source: "local" }, target);
  }

  if (target.formatId === "sdxl_i2i") {
    const prompt = [
      "保留参考图人物身份与构图",
      core,
      "增强细节与光影",
      style,
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget({ prompt, source: "local" }, target);
  }

  // sdxl_t2i / undress fallback
  const enriched =
    core.length >= 120
      ? [core, style, QUALITY_TAIL].filter(Boolean).join(", ")
      : [
          core,
          "细腻面部特征, 自然表情, 真实光影层次",
          ratioHint,
          "单帧静态构图, 主体清晰",
          style,
          QUALITY_TAIL,
        ]
          .filter(Boolean)
          .join(", ");

  return withTarget(
    {
      prompt: enriched,
      negative_prompt: target.supportsNegative
        ? "低质量, 模糊, 变形, 多余肢体, 文字, watermark, 丑陋, 过曝, 欠曝, 塑料感皮肤"
        : undefined,
      source: "local",
    },
    target
  );
}

async function enhancePromptDolphin(
  input: MagicPromptInput,
  target: ZenGenerationTarget
): Promise<MagicPromptResult | null> {
  const creds = await getActiveHfCredentials();
  if (!creds) return null;

  const meta = buildTaskMetadata(input, target);
  const resp = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: creds.magicModel,
      temperature: 0.15,
      max_tokens: 500,
      // 元数据也放在请求体顶层，便于网关/日志识别用途
      metadata: meta,
      messages: [
        { role: "system", content: buildSystemPrompt(target) },
        { role: "user", content: buildUserMessage(input, meta) },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn("[magic-prompt] Dolphin HF failed:", resp.status, body.slice(0, 300));
    return null;
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const parsed = parseLlmPromptOutput(content, target);
  if (!parsed.prompt) return null;

  return withTarget(
    {
      prompt: parsed.prompt,
      negative_prompt: target.supportsNegative ? parsed.negative_prompt : undefined,
      source: "dolphin",
    },
    target
  );
}

/**
 * 需已配置 HF。按当前模式对应的 Zen tool/model 格式优化 prompt。
 * 调用失败时回退本地扩写。
 */
export async function enhancePrompt(input: MagicPromptInput): Promise<MagicPromptResult> {
  if (!input.prompt.trim()) {
    throw new Error("请先输入提示词");
  }

  const creds = await getActiveHfCredentials();
  if (!creds) {
    throw new Error("魔法指令未启用：请在管理端配置 Hugging Face Token");
  }

  const target = resolveZenGenerationTarget(input.mode ?? "txt2img", {
    undress_variant: input.undress_variant,
  });

  try {
    const product = await resolveGenerationProduct({
      mode: input.mode ?? "txt2img",
      zenModel: input.zen_model,
      variantKey: input.undress_variant,
    });
    target.model = product.zenModel;
    target.tool = product.zenTool;
    target.formatId = formatIdForProduct(product) as ZenPromptFormatId;
  } catch {
    // keep hardcoded target
  }

  if (target.promptField === "none") {
    throw new Error("当前模式不使用文本提示词，无需魔法指令");
  }

  try {
    const dolphin = await enhancePromptDolphin(input, target);
    if (dolphin) return dolphin;
  } catch (err) {
    console.warn("[magic-prompt] Dolphin error, fallback local:", err);
  }

  return enhancePromptLocal(input);
}
