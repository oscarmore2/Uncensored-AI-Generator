import { canonicalRefRegex } from "./model-ref-syntax";
import { formatRefToken, refNeedsSeparator, type RefKind } from "./prompt-doc";

/**
 * 把提示词交给大模型改写之前，先把素材引用换成占位符；拿回来再还原。
 *
 * 为什么必须这么做：`@Image1` 在模型眼里就是一段普通文字。让它「按视频规则
 * 重写这段提示词」，它会顺手把引用译成 "reference image 1"、并进句子里、
 * 重新编号，或者干脆删掉——而这几种结果都不会报错，用户只看到出片不对。
 * 胶囊化之后更糟：改坏的引用回来会变成普通文字，那颗胶囊就凭空没了。
 *
 * 占位符比在 system prompt 里求它「请保留 @Image1」可靠一个数量级：
 * `[[REF1]]` 不是自然语言，模型没有把它改写成别的说法的动机。
 * 两条一起上——system prompt 里也写一句，占位符做兜底和**校验**。
 *
 * 用 ASCII 方括号而不是 ⟦1⟧ 这类生僻字符：生僻符号更容易被模型
 * 「顺手规范化」成别的东西，而方括号在代码和模板里太常见了，它不会去动。
 */

/** 第 n 个引用的占位写法。从 1 开始，和用户看到的编号无关 */
function placeholder(index: number): string {
  return `[[REF${index}]]`;
}

export type MaskedRefs = { masked: string; tokens: string[] };

/**
 * `@Image1` -> `[[REF1]]`。
 *
 * 同一个 token 重复出现时共用一个占位符——否则模型看到 REF1/REF2/REF3
 * 全指同一张图，反而容易自作主张给它们编不同的号。
 */
export function maskPromptRefs(text: string): MaskedRefs {
  const tokens: string[] = [];
  const masked = text.replace(canonicalRefRegex(), (_whole, lead: string, kind: string, num: string) => {
    const token = formatRefToken(kind.toLowerCase() as RefKind, Number(num));
    let i = tokens.indexOf(token);
    if (i === -1) {
      tokens.push(token);
      i = tokens.length - 1;
    }
    return `${lead}${placeholder(i + 1)}`;
  });
  return { masked, tokens };
}

/**
 * `[[REF1]]` -> `@Image1`，并报告哪些没能回来。
 *
 * 还原时要**补分隔符**：识别式要求引用前面是行首或分隔符，而模型很可能
 * 写成「参考[[REF1]]」不带空格。直接还原会得到「参考@Image1」——
 * 那不是一个引用，提交时不会被改写，会原样送进模型。
 *
 * missing 不为空意味着模型确实弄丢了引用。这里不擅自补回去（补在哪儿只能靠猜），
 * 而是如实报出来，交给上层告诉用户。
 */
export function unmaskPromptRefs(text: string, tokens: string[]): { text: string; missing: string[] } {
  let out = text;
  const missing: string[] = [];

  tokens.forEach((token, i) => {
    const ph = placeholder(i + 1);
    if (!out.includes(ph)) {
      missing.push(token);
      return;
    }
    // 捕获占位符前面那个字符，据此决定要不要垫空格
    const re = new RegExp(`([\\s\\S]?)${ph.replace(/[[\]]/g, "\\$&")}`, "g");
    out = out.replace(re, (_m, prev: string) => {
      const sep = refNeedsSeparator(prev) ? " " : "";
      return `${prev}${sep}@${token}`;
    });
  });

  return { text: out, missing };
}
