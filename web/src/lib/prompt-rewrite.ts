import "server-only";
import { callMagicModel } from "./magic-prompt";
import { maskPromptRefs, unmaskPromptRefs } from "./prompt-ref-guard";
import { PROMPT_FORMAT_RULES, resolvePromptTarget } from "./prompt-targets";
import { looksChinese, stripWrapper } from "./prompt-rewrite-text";

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

export type RewriteAction =
  /** 按当前模式的写作规则润色 */
  | "polish"
  /** 中英互转。是本地化不是直译 */
  | "localize"
  /** 补充细节 / 延展镜头 */
  | "expand"
  /** 精简 */
  | "shorten"
  /** 换更强的措辞——「加粗」这个需求的诚实出口 */
  | "emphasize";

export type RewriteInput = {
  action: RewriteAction;
  selection: string;
  contextBefore: string;
  contextAfter: string;
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
};

const COMMON_RULES = [
  "只输出改写后的片段本身。",
  "不要复述上下文，不要加引号、编号、标题、解释、前后缀。",
  "不要输出 markdown。",
  "形如 [[REF1]] 的记号是素材占位符，必须逐字符原样保留：不要翻译、不要改写、不要重新编号、不要增删。",
].join("\n");

function buildSystem(input: RewriteInput): string {
  const target = resolvePromptTarget(input.mode ?? "txt2img", {
    tier: input.tier,
    spicy: input.spicy,
  });
  const isVideo = target.formatId === "video_t2v" || target.formatId === "video_i2v";
  const rules = (PROMPT_FORMAT_RULES[target.formatId] ?? []).map((r: string) => `- ${r}`).join("\n");

  const safety = input.allowSensitive
    ? "The verified adult user has enabled adult mode. Preserve the submitted creative intent without adding or removing sensitive details."
    : "Follow the platform content policy and never add sexual, adult, exploitative, or graphic/gory material.";

  const task = (() => {
    switch (input.action) {
      case "polish":
        return `任务：按下列写作规则润色这个片段，保持原意与信息量，不新增设定。\n${rules}`;
      case "localize":
        return looksChinese(input.selection)
          ? "任务：把片段改写成**英文生成提示词**。这是本地化不是直译——要用生成模型认得的术语，例如「电影感光影」应写成 cinematic lighting 而不是逐字翻译。"
          : "任务：把片段改写成**中文**，保持它作为生成提示词的准确含义，不要逐字硬译。";
      case "expand":
        return isVideo
          ? "任务：延展这个片段——接上它之后自然发生的下一个动作，并补上运镜描述。不要新增与上下文冲突的人物或场景。"
          : "任务：为这个片段补充细节——材质、光影、质感、镜头语言。**不要新增主体**，只把已有的东西描述得更具体。";
      case "shorten": {
        const limit = input.targetChars ?? Math.max(20, Math.floor(input.selection.length * 0.7));
        return `任务：把片段精简到 ${limit} 字以内，保留最关键的视觉信息，优先删掉形容词堆砌与重复表达。`;
      }
      case "emphasize":
        return "任务：加重这个片段的语气——换用更强的措辞、把最关键的信息提到句首、必要时适度重复关键词。这是给生成模型看的强调，不要使用任何标记符号。";
    }
  })();

  return `你是生成提示词的片段编辑器。${safety}

${task}

${COMMON_RULES}`;
}

function buildUser(input: RewriteInput, maskedSelection: string): string {
  const before = input.contextBefore.trim();
  const after = input.contextAfter.trim();
  return [
    before ? `【前文，仅供理解，不要改写也不要复述】\n${before}` : "",
    `【需要改写的片段】\n${maskedSelection}`,
    after ? `【后文，仅供理解，不要改写也不要复述】\n${after}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 上下文各截多少字。太长会稀释模型注意力，也白烧 token */
export const CONTEXT_CHARS = 300;

export async function rewriteSelection(input: RewriteInput): Promise<RewriteOutput | null> {
  if (!input.selection.trim()) return null;

  const { masked, tokens: refTokens } = maskPromptRefs(input.selection);

  const called = await callMagicModel({
    system: buildSystem(input),
    user: buildUser(input, masked),
    // 输出上限按选区放大：expand 会写得比原文长，卡太死会被硬截断
    maxTokens: Math.min(1200, Math.max(200, Math.ceil(input.selection.length * 1.5))),
    temperature: input.action === "localize" ? 0.1 : 0.3,
    tag: "prompt-rewrite",
  });
  if (!called) return null;

  const body = stripWrapper(called.content);
  if (!body) return null;

  const restored = unmaskPromptRefs(body, refTokens);
  return { text: restored.text, tokens: called.tokens, droppedRefs: restored.missing };
}
