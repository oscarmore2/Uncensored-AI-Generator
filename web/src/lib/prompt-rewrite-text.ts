/**
 * 选区改写里不依赖服务端的那部分纯逻辑。
 * 单独成文件是为了能被单测直接跑——它们恰好是最该测的两块。
 */

/**
 * 中英方向按**选区内容**判断，与界面语言无关。
 *
 * 一个中文界面的用户完全可能在写英文提示词——多数上游模型对英文理解更好，
 * 这是常见做法。按界面语言判断会把他刚写好的英文又译回中文。
 *
 * 汉字给四倍权重：中文信息密度高，「电影感光影 cinematic」这种混排里
 * 真正的主体是中文。
 */
export function looksChinese(text: string): boolean {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk += 1;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin += 1;
  }
  if (cjk === 0) return false;
  return cjk * 4 >= latin;
}

/**
 * 剥掉模型爱加的壳。
 *
 * 即使 system prompt 反复说「只输出片段」，模型仍会时不时套上引号、代码块，
 * 或者写一句「改写后：」。这些字符会原样进提示词——用户看不出问题，
 * 生成模型却会把它们当正文读进去。
 *
 * 只剥**整段包裹**的引号：片段内部本来就有引号时（台词、对白）不能动，
 * 那是用户写的内容。
 */
export function stripWrapper(raw: string): string {
  let out = raw.trim();

  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(out);
  if (fence) out = fence[1].trim();

  out = out.replace(/^(改写后|结果|输出|片段|Rewritten|Result)\s*[:：]\s*/i, "");

  const quoted = /^["'“”「『]([\s\S]*)["'“”」』]$/.exec(out);
  // 内部还有引号说明这对引号不是包裹用的，别乱剥
  if (quoted && !/["'“”「』』]/.test(quoted[1])) out = quoted[1];

  return out.trim();
}
