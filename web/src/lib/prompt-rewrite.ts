import "server-only";
import { chat, streamChat, type ChatUsage } from "./llm/chat";
import type { LlmModelSpec } from "./llm/models";
import { resolveSkillModel } from "./llm/model-store";
import { splitEmittable } from "./llm/sse";
import { maskPromptRefs, unmaskPromptRefs } from "./prompt-ref-guard";
import { PROMPT_FORMAT_RULES, resolvePromptTarget } from "./prompt-targets";
import { looksChinese, stripWrapper } from "./prompt-rewrite-text";
import { renderTemplate, type TemplateVars } from "./skills/template";
import { resolveVisionImages, visionHint, type VisionImage } from "./skills/vision";
import { SELECTION_OUTPUT_RULES, wrapSystem } from "./skills/envelope";
import type { ResolvedSkill } from "./skills/store";

/**
 * 选区级 AI：只改用户选中的那一段，其余一字不动。
 *
 * 这是对「点一下把整段提示词覆盖掉」的修正。用户写十分钟，点一个按钮全没了、
 * 且无对比无撤销，是现有魔法指令最伤人的地方。
 *
 * 三条贯穿全文件的约束：
 *
 * 1. **必须带上下文**。润色一句话时模型需要知道整体在写什么，否则会把
 *    「她转身」润色成一段与前后文冲突的独立描写。上下文只读不改写。
 * 2. **只回选区**。模型很爱把上下文一起复述回来，那样替换就会把正文写重。
 *    system prompt 反复强调，返回后再做一次去壳。
 * 3. **引用走占位符**。与魔法指令同一套 maskPromptRefs，模型没机会改写 @Image1。
 */

export type RewriteInput = {
  /** 已经解析好的技能。任务描述来自它，安全口径和输出格式不来自它 */
  skill: ResolvedSkill;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  /** 全文 canonical。选区时机下由前端一并送来，用于 {{full_text}} */
  fullText?: string;
  /** 前端给的 token → 素材 URL。用来把选区里引用到的参考图一起发给模型 */
  refs?: Array<{ token: string; url: string }>;
  mode: string;
  tier?: string;
  spicy?: boolean;
  allowSensitive?: boolean;
  /** 精简的目标字数上限；不给就按原长七成 */
  targetChars?: number;
};

export type RewriteOutput = {
  /** 改写后的选区。**不含上下文** */
  text: string;
  tokens?: number;
  droppedRefs: string[];
  /** 这次实际随请求发出去的参考图张数。模型看没看见图，直接决定结果该怎么读 */
  images: number;
  usage?: ChatUsage;
  /** 这次实际用的模型。计费要它的倍率，台账要它的 key */
  model: LlmModelSpec;
};

/**
 * 技能可用的变量。
 *
 * 技能作者能写的只有「任务是什么」。上下文长什么样、当前是什么模式、
 * 该往哪个语言翻——这些由运行时算好递进去。作者要是能自己取上下文，
 * 那就不是「提示词定义」而是插件了，那条边界不能破。
 */
function buildVars(input: RewriteInput): TemplateVars {
  const target = resolvePromptTarget(input.mode ?? "txt2img", {
    tier: input.tier,
    spicy: input.spicy,
  });
  const rules = (PROMPT_FORMAT_RULES[target.formatId] ?? []).map((r: string) => `- ${r}`).join("\n");

  return {
    selection: input.selection,
    context_before: input.contextBefore,
    context_after: input.contextAfter,
    full_text:
      input.fullText ?? `${input.contextBefore}${input.selection}${input.contextAfter}`,
    mode_rules: rules,
    mode: target.mode,
    tier: target.tier,
    format_id: target.formatId,
    /*
     * 方向按**选区内容**判，不按界面语言。中文界面的用户完全可能在写英文
     * 提示词（上游对英文理解更好，是常见做法），按界面语言判会把他刚写好的
     * 英文又译回中文。
     */
    target_language: looksChinese(input.selection) ? "英文生成提示词" : "中文",
    shorten_limit: String(
      input.targetChars ?? Math.max(20, Math.floor(input.selection.length * 0.7))
    ),
  };
}

/**
 * 拼 system prompt。前后那两层由 `skills/envelope.ts` 提供，技能改不了——
 * 理由见那个文件。
 */
function buildSystem(input: RewriteInput, vars: TemplateVars): string {
  return wrapSystem({
    role: "你是生成提示词的片段编辑器。",
    allowSensitive: input.allowSensitive,
    task: renderTemplate(input.skill.systemPrompt, vars),
    outputRules: SELECTION_OUTPUT_RULES,
  });
}

function buildUser(input: RewriteInput, vars: TemplateVars, maskedSelection: string): string {
  // 选区必须换成遮罩过的那份，否则 @Image1 会原样送上去被模型改坏
  return renderTemplate(input.skill.userTemplate, { ...vars, selection: maskedSelection });
}

/** 上下文各截多少字。太长会稀释模型注意力，也白烧 token */
export const CONTEXT_CHARS = 300;

/**
 * 输出上限。技能自己声明一个硬顶，再按选区长度放大——
 * 「补充细节」会写得比原文长，只按技能的固定值卡会被硬截断。
 */
function maxTokensFor(input: RewriteInput): number {
  const bySelection = Math.max(200, Math.ceil(input.selection.length * 1.5));
  return Math.min(Math.max(input.skill.maxOutputTokens, bySelection), 1200);
}

function requestFor(
  input: RewriteInput,
  masked: string,
  model: LlmModelSpec,
  images: VisionImage[]
) {
  const vars = buildVars(input);
  return {
    system: buildSystem(input, vars),
    // 提示模型这几张图分别是谁，否则两张参考图时它会张冠李戴
    user: buildUser(input, vars, masked) + visionHint(images),
    model,
    images: images.map((i) => i.url),
    maxTokens: maxTokensFor(input),
    temperature: input.skill.temperature,
    tag: "prompt-rewrite" as const,
  };
}

/**
 * 请求过程中的实时状态，供调用方在**中途取消**时结账用。
 *
 * 取消之后拿不到 `done`，也拿不到上游的 usage——但 token 确实已经烧掉了。
 * 没有这个对象就只能当作没花钱，那等于给「点了就取消」开了一个免费口子。
 */
export type RewriteProgress = {
  /** 已收到的原始文本，未去壳未还原引用 */
  raw: string;
  /** 送出去的提示词全文，用来估 prompt token */
  promptText: string;
  model: LlmModelSpec | null;
  usage: ChatUsage;
};

export function newRewriteProgress(): RewriteProgress {
  return { raw: "", promptText: "", model: null, usage: {} };
}

/**
 * 这次带哪几张参考图。
 *
 * 模型读不了图就一张都不带——发给纯文本模型只会报错或被无声忽略，
 * 而无声忽略更糟：用户以为模型看过图了。
 */
async function visionFor(
  input: RewriteInput,
  model: LlmModelSpec,
  refTokens: string[]
): Promise<VisionImage[]> {
  if (!model.supportsVision || !input.refs?.length) return [];
  return resolveVisionImages(refTokens, input.refs);
}

/** 收尾：去壳 + 还原引用。流式与非流式共用，两条路的结果必须一模一样 */
function finalize(raw: string, refTokens: string[]): { text: string; droppedRefs: string[] } | null {
  const body = stripWrapper(raw);
  if (!body) return null;
  const restored = unmaskPromptRefs(body, refTokens);
  return { text: restored.text, droppedRefs: restored.missing };
}

export async function rewriteSelection(
  input: RewriteInput,
  opts?: { progress?: RewriteProgress }
): Promise<RewriteOutput | null> {
  if (!input.selection.trim()) return null;

  const { masked, tokens: refTokens } = maskPromptRefs(input.selection);
  const { model } = await resolveSkillModel(input.skill.modelKey, {
    allowSensitive: input.allowSensitive,
  });
  const images = await visionFor(input, model, refTokens);
  const request = requestFor(input, masked, model, images);
  if (opts?.progress) {
    opts.progress.model = model;
    opts.progress.promptText = `${request.system}\n${request.user}`;
  }

  const called = await chat(request);
  if (!called) return null;

  const done = finalize(called.text, refTokens);
  if (!done) return null;

  return {
    ...done,
    images: images.length,
    tokens: called.usage.totalTokens,
    usage: called.usage,
    model,
  };
}

export type RewriteStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: RewriteOutput };

/**
 * 流式改写。逐段吐**可以直接显示的**文本，最后一条带完整结果。
 *
 * delta 与 done.text 会有细微出入，这是有意的：done 那份多跑了一次去壳
 * （模型偶尔会拿 ``` 或引号把结果包起来），而去壳只有拿到全文才能做。
 * 所以界面上收到 done 时应该**整体替换**已经流出来的文字，不要追加。
 */
export async function* streamRewriteSelection(
  input: RewriteInput,
  opts?: { signal?: AbortSignal; progress?: RewriteProgress }
): AsyncGenerator<RewriteStreamEvent> {
  if (!input.selection.trim()) return;

  const { masked, tokens: refTokens } = maskPromptRefs(input.selection);
  const { model } = await resolveSkillModel(input.skill.modelKey, {
    allowSensitive: input.allowSensitive,
  });
  const images = await visionFor(input, model, refTokens);
  const request = requestFor(input, masked, model, images);
  const progress = opts?.progress;
  if (progress) {
    progress.model = model;
    progress.promptText = `${request.system}\n${request.user}`;
  }

  let raw = "";
  /** 已经推给界面的显示文本长度。占位符还原会改变长度，只能按显示侧记 */
  let sent = 0;
  let usage: ChatUsage = {};

  for await (const ev of streamChat({ ...request, signal: opts?.signal })) {
    if (ev.type === "delta") {
      raw += ev.text;
      if (progress) progress.raw = raw;
      /*
       * 扣住还没写完的占位符再显示。不扣的话用户会眼看着屏幕上蹦出
       * `[[RE` 然后变成 @Image1——看起来就像出了 bug。
       */
      const { emit } = splitEmittable(raw);
      const display = unmaskPromptRefs(emit, refTokens).text;
      if (display.length > sent) {
        yield { type: "delta", text: display.slice(sent) };
        sent = display.length;
      }
      continue;
    }
    usage = ev.usage;
    raw = ev.text || raw;
    if (progress) {
      progress.raw = raw;
      progress.usage = usage;
    }
  }

  const done = finalize(raw, refTokens);
  if (!done) return;
  yield {
    type: "done",
    result: { ...done, images: images.length, tokens: usage.totalTokens, usage, model },
  };
}
