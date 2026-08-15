/**
 * 从生成记录的 params 里认出「用户当初喂进去的媒体」。
 *
 * 两条链路存法不同：
 * - 创作中心：运行器上传参考图后写进 params.input_urls（base64 收尾会被删掉，只剩它）
 * - 玩物专区：媒体字段本来就以 URL 形式按字段名存在 params 里，字段名随模型 schema 变
 *
 * 所以先认 input_urls，认不到就把 params 里所有 http(s) 值当成输入媒体扫出来。
 * 清理任务删掉上传件时会把 URL 从 params 里抹掉（scrubUrl），
 * 于是「扫不到」本身就是「已被清理」的信号之一。
 */

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v|glb|gltf|mp3|wav|m4a|ogg)(\?|#|$)/i;
/** 字段名本身就说明是媒体，用于 CDN 不带扩展名的情况 */
const MEDIA_KEY = /(image|img|photo|picture|video|audio|voice|mask|ref|reference|source|init|media|file|model|avatar|frame)/i;
/** 明显不是素材的 http 参数 */
const NON_MEDIA_KEY = /(callback|webhook|notify|endpoint|redirect|host|origin)/i;

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * 参数里可能混入非媒体的 http 值（回调地址之类）。
 * 扩展名能认出来最好；认不出来时看字段名——对象存储的 key 多半带扩展名，
 * 但 CDN 直链未必，只按扩展名判会把这类输入图漏掉，缩略图就空了。
 */
function looksLikeMedia(key: string, url: string): boolean {
  if (NON_MEDIA_KEY.test(key)) return false;
  return MEDIA_EXT.test(url) || MEDIA_KEY.test(key);
}

export function extractInputUrls(rawParams: unknown): string[] {
  if (!rawParams || typeof rawParams !== "object") return [];
  const params = rawParams as Record<string, unknown>;

  const explicit = params.input_urls;
  if (Array.isArray(explicit)) {
    const urls = explicit.filter(isHttpUrl);
    if (urls.length) return urls;
  }

  const found: string[] = [];
  const seen = new Set<string>();

  /*
   * media_fields 是嵌套结构（字段名 → URL 数组），下面那圈按顶层值扫的循环
   * 看不见它——Array.isArray 为假，整个对象被当成单个候选项丢掉。
   * 结果是新链路（对口型、换脸、参考生视频等按字段提交的模式）的输入媒体
   * 一条都提取不出来，「套用」时判定为「没有媒体」，用户得重新上传一遍。
   */
  const fields = params.media_fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const value of Object.values(fields as Record<string, unknown>)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (!isHttpUrl(item) || seen.has(item)) continue;
        seen.add(item);
        found.push(item);
      }
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (key === "input_urls" || key === "result_thumb_urls" || key === "media_fields") continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const item of candidates) {
      if (!isHttpUrl(item) || !looksLikeMedia(key, item) || seen.has(item)) continue;
      seen.add(item);
      found.push(item);
    }
  }
  return found;
}

/** 上游若返回了成品缩略图就用它；目前 WaveSpeed 文档没这个字段，属于防御性读取 */
export function extractResultThumbs(rawParams: unknown): string[] {
  if (!rawParams || typeof rawParams !== "object") return [];
  const thumbs = (rawParams as Record<string, unknown>).result_thumb_urls;
  return Array.isArray(thumbs) ? thumbs.filter(isHttpUrl) : [];
}

/** 创作中心的模式 → 成品媒体类型，用于前端决定缩略图怎么渲染 */
export function mediaKindForMode(mode: string): "image" | "video" {
  return mode.endsWith("vid") ? "video" : "image";
}
