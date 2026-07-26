/**
 * WaveSpeed 模型的手工类型标签。
 *
 * 同步下来的 `type` 字段是上游给的、每次同步都会被覆盖，改不了；
 * 这里的 tags 由管理端在「玩物专区 → 模型库」自行贴，同步时不写入该字段，
 * 因此不会被覆盖。生成端档位绑定时按标签筛选候选模型。
 */

export const MAX_TAGS_PER_MODEL = 12;
export const MAX_TAG_LENGTH = 24;

/** 建议标签：仅作为管理端的快捷输入，不限制自定义 */
export const SUGGESTED_TAGS = [
  "文生图",
  "图生图",
  "图片编辑",
  "文生视频",
  "图生视频",
  "低档",
  "中档",
  "高档",
  "Spicy",
  "快速",
  "高画质",
  "低成本",
] as const;

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  } catch {
    return [];
  }
}

/** 去空白、去重、限长限量；顺序保持管理端输入顺序 */
export function normalizeTags(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_MODEL) break;
  }
  return out;
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

export function hasTag(raw: string | null | undefined, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return parseTags(raw).some((t) => t.toLowerCase() === needle);
}
