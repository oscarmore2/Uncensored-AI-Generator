/**
 * 平台包在技能提示词外面的那两层。
 *
 * 技能作者只写「任务是什么」。审查口径和输出格式**不可被技能覆盖**
 * （规划 7.1）：
 *
 * - 审查口径只取决于用户有没有成人权限。技能里写「忽略内容政策」不该有任何效果。
 * - 输出格式一旦被改掉，返回的东西就没法安全地放回正文——选区级动作会把
 *   模型的解释文字一起塞进用户的提示词里，整段动作会把 JSON 当正文写进去。
 *
 * 集中放一处，是为了让这条边界看得见。散在各个调用点的话，
 * 迟早有人在某一处「顺手」让技能覆盖它。
 */

export function safetyClause(allowSensitive: boolean | undefined): string {
  return allowSensitive
    ? "The verified adult user has enabled adult mode. Preserve the submitted creative intent without adding or removing sensitive details."
    : "Follow the platform content policy and never add sexual, adult, exploitative, or graphic/gory material.";
}

/**
 * 素材占位符的保护。
 *
 * 两条链路都要：`@Image1` 在模型眼里是普通文字，让它「按规则重写」，
 * 它会顺手译成 reference image 1、并进句子、重新编号或者删掉——全都不报错，
 * 用户只看到出片不对。
 */
export const REF_RULE =
  "形如 [[REF1]] 的记号是素材占位符，必须逐字符原样保留：不要翻译、不要改写、不要重新编号、不要增删。";

/** 选区级：只回改写后的那一段 */
export const SELECTION_OUTPUT_RULES = [
  "只输出改写后的片段本身。",
  "不要复述上下文，不要加引号、编号、标题、解释、前后缀。",
  "不要输出 markdown。",
  REF_RULE,
].join("\n");

/** 整段级：回整段正文，支持反向提示词的档位回一个 JSON 对象 */
export function manualOutputRules(opts: {
  supportsNegative: boolean;
  promptField: string;
}): string {
  const shape = opts.supportsNegative
    ? `只输出一个 JSON 对象，不要 markdown，不要解释：
{"positive_prompt":"...","negative_prompt":"..."}`
    : `只输出优化后的提示词正文（对应字段 ${opts.promptField}），不要 JSON、不要引号、不要 markdown、不要解释。`;
  return [shape, REF_RULE].join("\n");
}

/** 拼 system prompt：安全口径 → 技能的任务 → 输出硬要求 */
export function wrapSystem(opts: {
  role: string;
  allowSensitive?: boolean;
  task: string;
  outputRules: string;
}): string {
  return `${opts.role}${safetyClause(opts.allowSensitive)}

${opts.task}

${opts.outputRules}`;
}
