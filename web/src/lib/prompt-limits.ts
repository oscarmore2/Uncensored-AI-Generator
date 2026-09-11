/**
 * 提示词长度上限。**单独一个模块、不带 zod**。
 *
 * 前端要拿它画字数提示，而 `validators.ts` 顶上就 import 了 zod——
 * 从那里取常量会把整个校验库打进客户端包。同样的坑在 `skills/portable.ts`
 * 上踩过一次（一个纯字符串工具把 zod 带进了 /skills 页面，17.9kB → 3.05kB）。
 */

/**
 * 非 Spicy 档的提示词上限。
 *
 * 这个数**不是上游要求的**：Atlas 的参考生视频 schema 里 prompt 只有
 * type/default/description，整份文件一个 maxLength 都没有；我们也从来没读过
 * 上游的长度约束。它纯粹是产品选择，所以只留给非 Spicy 档。
 */
export const NORMAL_PROMPT_MAX = 4_000;

/**
 * 两档共用的硬顶，**不是产品限制**，纯粹挡住明显异常的请求体。
 *
 * 长度之所以还需要一个上限，是因为它会影响内容审查：太长会让 moderations 接口
 * 报错、降级到 HF 也顶爆上下文，最后落到「两级都失效按本地正则放行」，
 * 等于给了一条靠写得长绕过审查的路。审查那边已经改成分片送审
 * （content-safety.ts 的 chunksForModeration），所以这个数只需要大到没人碰得到。
 */
export const PROMPT_HARD_MAX = 50_000;


/**
 * 字数提示该不该出现、什么颜色。
 *
 * 抽成纯函数是因为阈值这种东西差一个等号就会「该提醒的时候没提醒」，
 * 而那正好是这个功能唯一的价值所在。
 */
export const COUNT_VISIBLE_RATIO = 0.5;
export const COUNT_WARN_RATIO = 0.9;

export type PromptCountState = "hidden" | "normal" | "warn" | "over";

export function promptCountState(length: number, limit: number | null): PromptCountState {
  // Spicy 档不限：挂个「1234 字」在那里只会让人以为也有上限
  if (limit === null) return "hidden";
  if (length > limit) return "over";
  // 短提示词下显示字数是纯噪音，这个功能的价值全在「快撞上了」那一刻
  if (length <= limit * COUNT_VISIBLE_RATIO) return "hidden";
  return length > limit * COUNT_WARN_RATIO ? "warn" : "normal";
}
