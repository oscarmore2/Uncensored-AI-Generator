/**
 * SSE 解析与「半截占位符」扣留。纯函数，两端共用，也好单测。
 *
 * 不带 server-only：服务端用它解析上游的流，客户端用同一份逻辑解析我们自己
 * 发出去的流。两边各写一份的话，边界情况（chunk 从 `da` 和 `ta: {` 中间断开）
 * 迟早只在一边被修好。
 */

/**
 * 增量式 SSE 解析器。
 *
 * 唯一真正的难点是 **chunk 边界不等于事件边界**：TCP 给什么就是什么，
 * 一个 JSON 事件可能横跨三个 chunk，也可能三个事件挤在一个 chunk 里。
 * 所以必须留缓冲，按空行切分，绝不能对单个 chunk 直接 JSON.parse。
 */
export function createSseParser() {
  let buffer = "";
  return {
    /** 喂一段原始文本，返回这一段里能完整切出来的 data 载荷 */
    feed(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      // 事件之间是空行。\r\n 也要认——有的网关会带回车
      const SEP = /\r?\n\r?\n/;
      for (;;) {
        const hit = SEP.exec(buffer);
        if (!hit) break;
        const raw = buffer.slice(0, hit.index);
        buffer = buffer.slice(hit.index + hit[0].length);
        const payload = dataLines(raw);
        if (payload) out.push(payload);
      }
      return out;
    },
    /** 流结束时缓冲里可能还剩最后一个没有以空行收尾的事件 */
    flush(): string[] {
      const rest = buffer;
      buffer = "";
      if (!rest.trim()) return [];
      const payload = dataLines(rest);
      return payload ? [payload] : [];
    },
  };
}

/** 一个事件里可能有多行 data:，按 SSE 规范用换行拼起来 */
function dataLines(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/**
 * `[[REF1]]` 的**真前缀**。用来判断缓冲尾巴是不是一个还没写完的占位符。
 *
 * 完整的 `[[REF1]]` 不匹配（只允许一个右括号），所以写完就会立刻放行。
 */
const PARTIAL_REF_RE = /^\[(\[(R(E(F(\d*\]?)?)?)?)?)?$/;

/**
 * 把缓冲切成「现在能显示的」和「必须再等等的」。
 *
 * 为什么需要：素材引用在送进模型之前被换成了 `[[REF1]]`，回来要换回胶囊。
 * 流式下 chunk 会从占位符中间断开，如果照直显示，用户会眼看着屏幕上蹦出
 * `[[RE` 再变成 `@Image1`——像出了 bug。扣住那半截，等它写完再一起放。
 *
 * 扣留的长度天然有界：一旦尾巴不再像占位符前缀（比如模型写的是
 * `[cinematic`），立刻全部放行，不会越攒越多。
 */
export function splitEmittable(buffer: string): { emit: string; hold: string } {
  /*
   * 只回看固定长度，两个作用：扣留量天然有界；也不必扫整段文本。
   * `[[REF` + 编号 + `]]` 撑死十来个字符，16 够用。
   *
   * 要找的是**最靠前**的那个候选左括号，不是最后一个——`…与 [[` 的尾巴里
   * 最后一个 `[` 单看确实像前缀，但正确答案是把两个都扣住。
   */
  const from = Math.max(0, buffer.length - 16);
  for (let i = from; i < buffer.length; i++) {
    if (buffer[i] !== "[") continue;
    if (PARTIAL_REF_RE.test(buffer.slice(i))) {
      return { emit: buffer.slice(0, i), hold: buffer.slice(i) };
    }
  }
  return { emit: buffer, hold: "" };
}

/** OpenAI 兼容流里我们真正关心的那几个字段 */
export type ChatStreamChunk = {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** OpenRouter 扩展：本次的实际成本（美元）。有就是真账，别再估 */
    cost?: number;
  } | null;
  error?: { message?: string } | string;
};
