/**
 * 提示词编辑器的极简 Markdown 预览。
 *
 * 这只是**编辑辅助**。提交给模型的永远是原始文本，与编辑器里的内容逐字节
 * 一致——提示词是原样送进模型的，任何渲染都会改变它实际读到的字符串，
 * `**强调**` 变成 <strong> 或者丢掉星号，两种都不是用户写下时的意思。
 *
 * 不引 markdown 库：需要的只是「长提示词能分段看清楚」，
 * 一个完整解析器加配套的消毒库是几十 KB，不值。
 *
 * 安全：**先转义再变换**。用户输入里的 < & > 在任何规则跑之前就变成实体，
 * 所以后续插入的标签只可能是这里写死的那几个，注入不进来。
 */

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行内变换。
 *
 * 按反引号切开而不是用占位符替换：切出来的奇数段就是代码段，
 * 只对偶数段做加粗/斜体。这样代码里的星号不会被当成标记
 * （提示词里写 a*b 这种是常事），也不存在占位符和正文撞车的可能。
 */
function inline(text: string): string {
  return text
    .split(/`([^`]+)`/)
    .map((seg, i) =>
      i % 2 === 1
        ? `<code>${seg}</code>`
        : seg
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    )
    .join("");
}

/** 渲染成 HTML 片段。输入按不可信处理，输出可直接插进 DOM。 */
export function renderMiniMarkdown(source: string): string {
  const lines = escapeHtml(source).split(/\r?\n/);
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushList();
      out.push("<hr />");
      continue;
    }

    // 转义之后 > 已经是 &gt;
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }

    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }

  flushList();
  return out.join("");
}
