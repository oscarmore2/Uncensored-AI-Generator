import "server-only";
import { maskPromptRefs, unmaskPromptRefs } from "./prompt-ref-guard";
import { getActiveHfCredentials } from "./hf";
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
};

export type MagicPromptResult = {
  prompt: string;
  negative_prompt?: string;
  source: "local" | "dolphin";
  /**
   * 本次真实消耗的 token。
   *
   * 上游是 OpenAI 兼容接口，响应里本来就带 usage，以前只是没读。
   * 拿不到时留空，由调用方决定要不要估算——**不在这里偷偷估**，
   * 估算值和真实值混在一个字段里，日后对账会分不清哪次是估的。
   */
  tokens?: number;
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

function buildSystemPrompt(target: PromptTarget, allowSensitive = false): string {
  const rules = PROMPT_FORMAT_RULES[target.formatId].map((r: string) => `- ${r}`).join("\n");
  const outputHint = target.supportsNegative
    ? `输出格式：只输出一个 JSON 对象，不要 markdown，不要解释：
{"positive_prompt":"...","negative_prompt":"..."}`
    : `输出格式：只输出优化后的提示词正文（对应字段 ${target.promptField}），不要 JSON、不要引号、不要 markdown、不要解释。`;

  return `You are an AI media prompt editor. ${
    allowSensitive
      ? "The verified adult user has enabled adult mode. Preserve the submitted creative intent without adding or removing sensitive details."
      : "Follow the platform content policy and never add sexual, adult, exploitative, or graphic/gory material."
  }

你的任务元数据 purpose=optimize_generation_prompt：专门把用户草稿优化成「下游生成模型」可直接使用的 prompt，而不是普通聊天回复。

【硬性要求】正文里形如 [[REF1]]、[[REF2]] 的记号是素材占位符，**必须逐字符原样保留**：
不要翻译、不要改写成「参考图1」之类的说法、不要重新编号、不要增删。
它们可以随句子移动位置，但字符本身一个都不能变。

当前目标：
- app_mode: ${target.mode}
- tier: ${target.tier}
- prompt_field: ${target.promptField}

该模式的格式规则：
${rules}

通用要求：
1. ${
    allowSensitive
      ? "保留用户原始创作意图，不主动增删敏感细节"
      : "保留用户的安全创作意图；不得添加色情、成人、剥削或写实血腥内容"
  }
2. 严格按上述模式格式写，不要混用其它模式的写法
3. 控制在约 60-220 字（视频可略短、偏动作）
4. ${outputHint}`;
}

function buildUserMessage(input: MagicPromptInput, meta: MagicPromptTaskMetadata): string {
  const rules: string[] =
    PROMPT_FORMAT_RULES[meta.format_id as keyof typeof PROMPT_FORMAT_RULES] ?? [];
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
 * 调一次改写模型，回正文和真实 token 消耗。
 *
 * 抽出来是因为选区级 AI（prompt-rewrite）要走同一条路：凭据怎么取、
 * 端点怎么拼、usage 怎么读，只应该有一处知道。抄第二份的话，
 * 哪天换了模型或网关，总有一处忘了改，症状是「另一个功能悄悄不工作了」。
 *
 * 失败一律返回 null 让调用方兜底，不抛——这条链路上任何异常都不该
 * 让用户的正文丢失。
 */
export async function callMagicModel(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** 放进请求体顶层，便于网关/日志识别用途 */
  metadata?: unknown;
  /** 出错日志前缀，便于分辨是哪个功能 */
  tag?: string;
}): Promise<{ content: string; tokens?: number } | null> {
  const creds = await getActiveHfCredentials();
  if (!creds) return null;

  const resp = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: creds.magicModel,
      temperature: opts.temperature ?? 0.15,
      max_tokens: opts.maxTokens ?? 500,
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn(`[${opts.tag ?? "magic-prompt"}] HF failed:`, resp.status, body.slice(0, 300));
    return null;
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;


  const usage = data.usage;
  const tokens =
    usage?.total_tokens ??
    (usage?.prompt_tokens != null && usage?.completion_tokens != null
      ? usage.prompt_tokens + usage.completion_tokens
      : undefined);
  return { content, tokens };
}

async function enhancePromptDolphin(
  input: MagicPromptInput,
  target: PromptTarget
): Promise<MagicPromptResult | null> {
  const meta = buildTaskMetadata(input, target);
  const called = await callMagicModel({
    system: buildSystemPrompt(target, input.allow_sensitive),
    user: buildUserMessage(input, meta),
    metadata: meta,
    tag: "magic-prompt",
  });
  if (!called) return null;
  const { content, tokens } = called;

  const parsed = parseLlmPromptOutput(content, target);
  if (!parsed.prompt) return null;

  return withTarget(
    {
      prompt: parsed.prompt,
      // 模型偶尔只回正向；支持反向的档位就用规则模板补齐，别让输入框空着
      negative_prompt: negativeFor(target, input, parsed.negative_prompt),
      source: "dolphin",
      ...(tokens != null ? { tokens } : {}),
    },
    target
  );
}

/**
 * 需已配置 HF。按当前模式的写作规则优化 prompt；失败时回退本地扩写。
 */
export async function enhancePrompt(input: MagicPromptInput): Promise<MagicPromptResult> {
  if (!input.prompt.trim()) {
    throw new Error("请先输入提示词");
  }

  const creds = await getActiveHfCredentials();
  if (!creds) {
    throw new Error("魔法指令未启用：请在管理端配置 Hugging Face Token");
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
    const dolphin = await enhancePromptDolphin(guarded, target);
    if (dolphin) return restore(dolphin);
  } catch (err) {
    console.warn("[magic-prompt] Dolphin error, fallback local:", err);
  }

  return restore(await enhancePromptLocal(guarded));
}
