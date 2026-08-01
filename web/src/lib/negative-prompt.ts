import "server-only";
import { getActiveHfCredentials } from "./hf";

/**
 * 反向提示词生成。
 *
 * 两个优化入口都要用：创作中心的「魔法指令」和玩物专区的「WaveSpeed 优化」。
 * WaveSpeed 的 prompt-optimizer 模型只吐一段正向文本，没有反向的概念；
 * 所以反向统一由这里产出——有 HF 就让 LLM 按正向内容定制，没有就退回规则模板。
 * 规则模板永远可用，因此「有反向输入框就一定填得上」这件事不依赖任何外部服务。
 */

export type NegativeKind = "image" | "video";

/** 画质与解剖类通病，图片视频通用 */
const BASE_TERMS = [
  "低质量",
  "模糊",
  "失真",
  "变形",
  "多余肢体",
  "手指错乱",
  "比例失调",
  "文字",
  "水印",
  "署名",
  "噪点",
  "过曝",
  "欠曝",
  "塑料感皮肤",
];

/** 视频特有：时间维度上的瑕疵，图片模型写了也没用 */
const VIDEO_TERMS = [
  "画面闪烁",
  "帧间跳变",
  "主体形变",
  "拖影",
  "运动模糊过重",
  "镜头抖动",
];

function splitTerms(text: string): string[] {
  return text
    .split(/[,，;；\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 合并去重，保留先出现的写法（用户已填的排在前面） */
function mergeTerms(...groups: string[][]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of groups.flat()) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.join(", ");
}

/** 规则兜底：不调用任何外部服务 */
export function buildLocalNegative(kind: NegativeKind, existing?: string): string {
  const own = existing ? splitTerms(existing) : [];
  return mergeTerms(own, BASE_TERMS, kind === "video" ? VIDEO_TERMS : []);
}

function buildSystemPrompt(kind: NegativeKind, allowSensitive: boolean): string {
  return `你是 AI 生成模型的反向提示词（negative prompt）编写助手。

任务：根据给定的正向提示词，写出一条与之匹配的反向提示词，用来排除画面里不该出现的瑕疵。

规则：
1. 只输出反向提示词正文，逗号分隔的短词组，不要 JSON、不要引号、不要 markdown、不要任何解释
2. 8-20 个词组，覆盖画质、解剖结构、构图缺陷${
    kind === "video" ? "，以及闪烁/拖影/帧间跳变这类时间维度瑕疵" : ""
  }
3. 绝对不要把正向提示词里想要的主体、风格、场景写进来——那会把用户想要的东西排除掉
4. ${
    allowSensitive
      ? "用户已开通成人模式，不需要额外追加涉性排除项，专注画质与结构瑕疵"
      : "可以适当包含裸露、露骨内容的排除项"
  }
5. 若用户已有反向提示词，保留其中合理的部分并在此基础上补充`;
}

async function generateWithLlm(opts: {
  positivePrompt: string;
  kind: NegativeKind;
  existing?: string;
  allowSensitive: boolean;
}): Promise<string | null> {
  const creds = await getActiveHfCredentials();
  if (!creds) return null;

  const userMessage = [
    `## 生成类型\n${opts.kind === "video" ? "视频" : "图片"}`,
    opts.existing?.trim() ? `\n## 用户已有的反向提示词\n${opts.existing.trim()}` : "",
    `\n## 正向提示词\n${opts.positivePrompt.trim()}`,
  ].join("\n");

  const resp = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: creds.magicModel,
      temperature: 0.2,
      max_tokens: 300,
      metadata: { purpose: "generate_negative_prompt", kind: opts.kind },
      messages: [
        { role: "system", content: buildSystemPrompt(opts.kind, opts.allowSensitive) },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn("[negative-prompt] HF failed:", resp.status, body.slice(0, 300));
    return null;
  }

  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  // 模型偶尔会裹一层 markdown 或加个「反向提示词：」的前缀
  const cleaned = raw
    .replace(/^```(?:\w+)?\s*|\s*```$/g, "")
    .replace(/^(negative[\s_]*prompt|反向提示词)\s*[:：]\s*/i, "")
    .replace(/^["「']|["」']$/g, "")
    .trim();

  const terms = splitTerms(cleaned);
  // 少于 3 个词组多半是模型答歪了（例如回了一句解释），交给兜底
  if (terms.length < 3) return null;
  return mergeTerms(terms);
}

/**
 * 生成反向提示词。有 HF 就用 LLM 按正向内容定制，任何失败都退回规则模板，
 * 因此调用方拿到的结果一定非空。
 */
export async function generateNegativePrompt(opts: {
  positivePrompt: string;
  kind: NegativeKind;
  existing?: string;
  allowSensitive?: boolean;
}): Promise<{ negative_prompt: string; source: "llm" | "local" }> {
  try {
    const llm = await generateWithLlm({
      positivePrompt: opts.positivePrompt,
      kind: opts.kind,
      existing: opts.existing,
      allowSensitive: Boolean(opts.allowSensitive),
    });
    if (llm) return { negative_prompt: llm, source: "llm" };
  } catch (err) {
    console.warn("[negative-prompt] LLM error, fallback local:", err);
  }
  return {
    negative_prompt: buildLocalNegative(opts.kind, opts.existing),
    source: "local",
  };
}
