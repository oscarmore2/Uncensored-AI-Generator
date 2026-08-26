import "server-only";
import { getActiveOssConfig, objectKeyFromPublicUrl } from "../oss";
import { parseRefToken } from "../prompt-doc";
import { placeholder } from "../prompt-ref-guard";

/**
 * 提示词里 @ 引用了参考图时，把那些图一起发给模型当上下文。
 *
 * 为什么值得做：模型现在只看得到 `[[REF1]]` 这个占位符，完全不知道那张图长什么样。
 * 于是「补充细节」只能凭空编材质与光影，编出来的东西和参考图对不上——
 * 而用户之所以传这张图，要的正是「照着它写」。
 *
 * **视频与音频不带**。视频要抽帧、要决定抽哪几帧，成本和不确定性都高一个量级，
 * 是独立的一件事；音频更是另一条路（得先转写）。
 */

/** 一次最多带几张。图片按 token 计费，不封顶的话一条提示词能带十几张 */
export const MAX_VISION_IMAGES = 4;

export type VisionImage = {
  /** 模型在正文里看到的记号，用来把图和句子对上 */
  placeholder: string;
  url: string;
};

/**
 * 挑出该随请求发出去的参考图。
 *
 * @param maskedTokens `maskPromptRefs` 回的 token 顺序——`[[REF1]]` 对应第 0 个
 * @param refs 前端给的 token → url。**URL 一律要复核**，见下
 */
export async function resolveVisionImages(
  maskedTokens: string[],
  refs: Array<{ token: string; url: string }>
): Promise<VisionImage[]> {
  if (maskedTokens.length === 0 || refs.length === 0) return [];

  const urlByToken = new Map(refs.map((r) => [r.token, r.url]));
  const picked: VisionImage[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < maskedTokens.length; i++) {
    const token = maskedTokens[i];
    // 只要图。视频、音频跳过
    if (parseRefToken(token)?.kind !== "image") continue;
    const url = urlByToken.get(token);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    picked.push({ placeholder: placeholder(i + 1), url });
    if (picked.length >= MAX_VISION_IMAGES) break;
  }

  return filterToOwnStorage(picked);
}

/**
 * 只放行落在自家对象存储上的 URL。
 *
 * 前端传什么我们就发什么的话，等于开了一个「让我们的 LLM 账户去取任意 URL」
 * 的口子。取图的是上游而不是我们，所以这不是经典 SSRF，但仍然是拿我们的
 * 账户去拉外部内容——账户被判滥用是要连坐所有用户的。
 *
 * 剩下的风险是有界的：桶里的对象键按内容哈希生成，猜得到 key 就说明手里
 * 本来就有那个文件。
 *
 * 代价：从历史作品复用、且当初没能镜像回自家桶的素材（上游直链）会被挡掉，
 * 那张图就不随请求发送。所以调用方要把「实际带了几张」回给界面——
 * 模型看没看见图，直接决定了这次结果该怎么读。
 */
async function filterToOwnStorage(images: VisionImage[]): Promise<VisionImage[]> {
  if (images.length === 0) return [];
  const cfg = await getActiveOssConfig();
  if (!cfg) return [];
  return images.filter((img) => objectKeyFromPublicUrl(cfg, img.url) !== null);
}

/**
 * 附在用户消息末尾的一句话，告诉模型这几张图分别是谁。
 *
 * 不加这句的话模型只知道「有几张图」，没法把图和 `[[REF1]]` 对上，
 * 于是两张参考图时它会张冠李戴——而那正是用户最容易发现、也最恼火的错。
 */
export function visionHint(images: VisionImage[]): string {
  if (images.length === 0) return "";
  const list = images.map((i) => i.placeholder).join("、");
  return `\n\n【随附参考图】按顺序依次对应：${list}。请照着图里实际的样子写，不要凭空编造图中没有的东西。`;
}
