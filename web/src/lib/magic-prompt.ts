import "server-only";
import { maskPromptRefs, unmaskPromptRefs } from "./prompt-ref-guard";
import { chat, llmConfigured, type ChatUsage } from "./llm/chat";
import type { LlmModelSpec } from "./llm/models";
import { resolveSkillModel } from "./llm/model-store";
import { manualOutputRules, wrapSystem } from "./skills/envelope";
import { renderTemplate, type TemplateVars } from "./skills/template";
import { resolveVisionImages, visionHint } from "./skills/vision";
import type { ResolvedSkill } from "./skills/store";
import { buildLocalNegative, type NegativeKind } from "./negative-prompt";
import {
  PROMPT_FORMAT_RULES,
  resolvePromptTarget,
  type PromptTarget,
} from "./prompt-targets";

export type MagicPromptInput = {
  prompt: string;
  mode?: string;
  tier?: string;
  spicy?: boolean;
  style?: string;
  ratio?: string;
  negative_prompt?: string;
  allow_sensitive?: boolean;
  /** 前端给的 token → 素材 URL。用来把提示词里引用到的参考图一起发给模型 */
  refs?: Array<{ token: string; url: string }>;
};

export type MagicPromptResult = {
  prompt: string;
  negative_prompt?: string;
  /** "llm" = 真调了大模型；"local" = 本地规则兜底，一个 token 都没烧 */
  source: "local" | "llm";
  /**
   * 本次真实消耗的 token。
   *
   * 上游是 OpenAI 兼容接口，响应里本来就带 usage，以前只是没读。
   * 拿不到时留空，由调用方决定要不要估算——**不在这里偷偷估**，
   * 估算值和真实值混在一个字段里，日后对账会分不清哪次是估的。
   */
  tokens?: number;
  /** 计费要它：倍率来自模型，台账要模型 key */
  usage?: ChatUsage;
  model?: LlmModelSpec;
  /** 这次实际随请求发出去的参考图张数 */
  images?: number;
  /**
   * 改写过程中被模型弄丢的素材引用。
   *
   * 不擅自补回原文——补在哪一句只能靠猜，猜错比丢掉更糟。
   * 如实报上去，由界面告诉用户哪几个引用需要自己放回去。
   */
  dropped_refs?: string[];
  /** 只回传模式与档位；模型信息绝不下发到生成端 */
  target?: {
    mode: string;
    tier: string;
    spicy: boolean;
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
  tier: string;
  spicy: boolean;
  prompt_field: string;
  supports_negative: boolean;
  format_id: string;
  style?: string;
  ratio?: string;
};

function buildTaskMetadata(
  input: MagicPromptInput,
  target: PromptTarget
): MagicPromptTaskMetadata {
  return {
    purpose: "optimize_generation_prompt",
    description: "Optimize the user's draft into a prompt for the target generation mode.",
    app_mode: target.mode,
    tier: target.tier,
    spicy: target.spicy,
    prompt_field: target.promptField,
    supports_negative: target.supportsNegative,
    format_id: target.formatId,
    ...(input.style ? { style: input.style } : {}),
    ...(input.ratio ? { ratio: input.ratio } : {}),
  };
}

/**
 * 技能能拿到的变量。与选区那条链路同一套思路：作者只写「任务是什么」，
 * 上下文由运行时算好递进去。
 */
function buildVars(
  input: MagicPromptInput,
  target: PromptTarget,
  meta: MagicPromptTaskMetadata
): TemplateVars {
  const rules = (PROMPT_FORMAT_RULES[target.formatId] ?? []).map((r: string) => `- ${r}`).join("\n");
  return {
    full_text: input.prompt.trim(),
    mode_rules: rules,
    mode: target.mode,
    tier: target.tier,
    format_id: target.formatId,
    prompt_field: target.promptField,
    style: input.style ?? "realistic",
    ratio: input.ratio ?? "1:1",
    existing_negative: input.negative_prompt?.trim() ?? "",
    task_metadata: JSON.stringify(meta, null, 2),
  };
}

function negativeKindOf(target: PromptTarget): NegativeKind {
  return target.formatId === "video_t2v" || target.formatId === "video_i2v" ? "video" : "image";
}

/** 支持反向的档位一律给出反向提示词，不支持的一律不给 */
function negativeFor(
  target: PromptTarget,
  input: MagicPromptInput,
  fromLlm?: string
): string | undefined {
  if (!target.supportsNegative) return undefined;
  const trimmed = fromLlm?.trim();
  if (trimmed) return trimmed;
  return buildLocalNegative(negativeKindOf(target), input.negative_prompt);
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
  target: PromptTarget
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
  target: PromptTarget
): MagicPromptResult {
  return {
    ...result,
    target: { mode: target.mode, tier: target.tier, spicy: target.spicy },
  };
}

/** 本地扩写：按目标模型格式兜底 */
export function enhancePromptLocal(input: MagicPromptInput): MagicPromptResult {
  const raw = input.prompt.trim();
  if (!raw) throw new Error("请先输入提示词");

  const target = resolvePromptTarget(input.mode ?? "txt2img", {
    tier: input.tier,
    spicy: input.spicy,
  });
  const core = stripBoilerplate(raw);
  const style = STYLE_HINTS[input.style ?? "realistic"] ?? STYLE_HINTS.realistic;
  const ratioHint = RATIO_HINTS[input.ratio ?? ""] ?? "";

  if (target.formatId === "video_t2v") {
    const prompt = [
      core,
      "连贯动作推进",
      "自然镜头运动",
      ratioHint || "电影感运镜",
      style,
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget(
      { prompt, negative_prompt: negativeFor(target, input), source: "local" },
      target
    );
  }

  if (target.formatId === "video_i2v") {
    const prompt = [
      "保持参考图人物与场景身份",
      core,
      "轻微表情与姿态变化",
      "缓慢推近或固定机位微动",
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget(
      { prompt, negative_prompt: negativeFor(target, input), source: "local" },
      target
    );
  }

  if (target.formatId === "image_i2i" || target.formatId === "image_edit") {
    const prompt = [
      "保留参考图人物身份与构图",
      core,
      "增强细节与光影",
      style,
    ]
      .filter(Boolean)
      .join(", ");
    return withTarget(
      { prompt, negative_prompt: negativeFor(target, input), source: "local" },
      target
    );
  }

  // image_t2i fallback
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
      negative_prompt: negativeFor(target, input),
      source: "local",
    },
    target
  );
}

/**
 * 跑一次魔法指令技能。
 *
 * 与选区级 AI 走的是同一条上游（`llm/chat`）、同一套档位选择。
 * 它在技能系统里唯一的特殊之处是：**支持反向提示词的档位要求模型回 JSON**，
 * 而那条输出格式由平台包在外面（envelope.ts），技能作者照样只写任务。
 *
 * 失败一律返回 null 让调用方兜底，不抛——这条链路上任何异常都不该
 * 让用户的正文丢失。
 */
async function enhancePromptWithSkill(
  input: MagicPromptInput,
  target: PromptTarget,
  skill: ResolvedSkill,
  /** 遮罩时记下的 token 顺序，[[REF1]] 对应第 0 个 */
  refTokens: string[]
): Promise<MagicPromptResult | null> {
  const meta = buildTaskMetadata(input, target);
  const vars = buildVars(input, target, meta);
  const { model } = await resolveSkillModel(skill.modelKey, {
    allowSensitive: input.allow_sensitive,
  });

  /* 模型读不了图就一张都不带——无声忽略比报错更糟，用户会以为模型看过图了 */
  const images =
    model.supportsVision && input.refs?.length
      ? await resolveVisionImages(refTokens, input.refs)
      : [];

  const called = await chat({
    system: wrapSystem({
      role: "You are an AI media prompt editor. ",
      allowSensitive: input.allow_sensitive,
      task: renderTemplate(skill.systemPrompt, vars),
      outputRules: manualOutputRules({
        supportsNegative: target.supportsNegative,
        promptField: target.promptField,
      }),
    }),
    user: renderTemplate(skill.userTemplate, vars) + visionHint(images),
    model,
    images: images.map((i) => i.url),
    maxTokens: skill.maxOutputTokens,
    temperature: skill.temperature,
    tag: "magic-prompt",
  });
  if (!called) return null;

  const parsed = parseLlmPromptOutput(called.text, target);
  if (!parsed.prompt) return null;

  return withTarget(
    {
      prompt: parsed.prompt,
      // 模型偶尔只回正向；支持反向的档位就用规则模板补齐，别让输入框空着
      negative_prompt: negativeFor(target, input, parsed.negative_prompt),
      source: "llm",
      ...(called.usage.totalTokens != null ? { tokens: called.usage.totalTokens } : {}),
      usage: called.usage,
      model,
      images: images.length,
    },
    target
  );
}

/**
 * 按当前模式的写作规则优化整段 prompt；上游失败时回退本地扩写。
 *
 * 提示词本身来自技能（`magic-prompt`），管理端可改。本地兜底不是技能，
 * 也不该是——那是一段写死的拼接逻辑，用来在上游挂掉时保证按钮还有反应。
 */
export async function enhancePrompt(
  input: MagicPromptInput,
  skill: ResolvedSkill
): Promise<MagicPromptResult> {
  if (!input.prompt.trim()) {
    throw new Error("请先输入提示词");
  }

  if (!(await llmConfigured())) {
    throw new Error("魔法指令未启用：请在管理端配置 AI 文本模型的上游账户");
  }

  const target = resolvePromptTarget(input.mode ?? "txt2img", {
    tier: input.tier,
    spicy: input.spicy,
  });

  /*
   * 先把素材引用换成占位符再交给模型。
   *
   * @Image1 在模型眼里是普通文字，让它「按规则重写这段提示词」，它会顺手
   * 把引用译成 reference image 1、并进句子、重新编号或者删掉——全都不报错，
   * 用户只看到出片不对。胶囊化之后更糟：改坏的引用回来会退化成普通文字，
   * 那颗胶囊就凭空没了。
   *
   * 本地兜底那条路也一起遮罩：它同样会拼接改写文本，没有理由区别对待。
   */
  const { masked, tokens } = maskPromptRefs(input.prompt);
  const guarded = { ...input, prompt: masked };

  const restore = (result: MagicPromptResult): MagicPromptResult => {
    if (tokens.length === 0) return result;
    const { text, missing } = unmaskPromptRefs(result.prompt, tokens);
    return { ...result, prompt: text, ...(missing.length ? { dropped_refs: missing } : {}) };
  };

  try {
    const viaLlm = await enhancePromptWithSkill(guarded, target, skill, tokens);
    if (viaLlm) return restore(viaLlm);
  } catch (err) {
    console.warn("[magic-prompt] upstream error, fallback local:", err);
  }

  return restore(await enhancePromptLocal(guarded));
}
