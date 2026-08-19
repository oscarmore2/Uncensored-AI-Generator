/**
 * 把提示词里的规范引用改写成目标模型认得的写法。
 *
 * 规范形式是 @Image1 / @Video1 / @Audio1（PromptMentionBox 插入的那套），
 * 库里存的、草稿模板存的、「套用」还原的，一律是这一套。改写只发生在
 * **提交上游前的最后一刻**——这样换模型重跑同一条提示词才不用改文案，
 * 而且 @ 引用能保持按位置延迟绑定（拖动缩略图换顺序即换引用）。
 *
 * 匹配不到规则时原样透传。这一点很重要：接入这套机制的那一刻，
 * 所有既有模型的行为必须与接入前逐字节一致。
 */

export type RefSyntaxRule = {
  matchModelId: string;
  provider: string | null;
  imageFormat: string;
  videoFormat: string;
  audioFormat: string;
};

/**
 * 规范引用的识别式。
 *
 * 前面要求是行首或分隔符，与 PromptMentionBox 的插入规则一致——
 * 否则邮箱地址里的 @image1 之类也会被改写。
 * 序号必须存在且是数字：@Image 后面没有数字的不是引用，是用户在写英文。
 */
const CANONICAL_RE = /(^|[\s([{（【「，,。.:：;；!！?？、])@(image|video|audio)(\d+)\b/gi;

/** 从若干条规则里挑出适用于该模型的那一条；挑不到返回 null（= 透传） */
export function pickRefSyntax(
  rules: RefSyntaxRule[],
  provider: string,
  modelId: string
): RefSyntaxRule | null {
  const id = modelId.toLowerCase();
  for (const rule of rules) {
    if (rule.provider && rule.provider !== provider) continue;
    // 空 matchModelId 是兜底行，匹配一切
    if (rule.matchModelId && !id.includes(rule.matchModelId.toLowerCase())) continue;
    return rule;
  }
  return null;
}

/**
 * 按规则改写整段提示词。
 *
 * 模板里的 {n} 换成该类型内的序号。模板为空串表示「删掉这个引用」——
 * 有些模型只认数组顺序，提示词里留着它不认识的记号，会被当成正文读进去
 * 影响生成结果。删掉时连同前面多余的空格一起收拾干净。
 */
export function renderPromptRefs(prompt: string, rule: RefSyntaxRule | null): string {
  if (!rule || !prompt) return prompt;

  const formatFor = (kind: string): string =>
    kind === "image" ? rule.imageFormat : kind === "video" ? rule.videoFormat : rule.audioFormat;

  let deleted = false;
  const out = prompt.replace(CANONICAL_RE, (_whole, lead: string, kind: string, n: string) => {
    const template = formatFor(kind.toLowerCase());
    if (!template) {
      deleted = true;
      return lead; // 删掉引用，保留它前面的那个分隔符
    }
    return lead + template.replace(/\{n\}/g, n);
  });

  /*
   * 删掉引用会在原地留下双空格，收拾一下。
   * 只在**确实删过**时才收拾：单纯改写（@Image1 → character1）不该顺手把
   * 用户自己排版里的多余空格也压掉——那是他写的，不是我们制造的。
   */
  return deleted ? out.replace(/[ \t]{2,}/g, " ") : out;
}

/** 规范形式本身长什么样，给管理端预览用 */
export const CANONICAL_SAMPLE = "@Image1 @Image2 @Video1 @Audio1";
