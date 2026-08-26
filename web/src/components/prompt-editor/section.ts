/**
 * 「章节」是什么：一个标题，加上它后面所有块，直到**下一个同级或更高级的标题**。
 *
 * 纯函数、只吃一个层级数组，所以不用把 Lexical 拖进单测。
 * 这段算错的后果是「AI 改了不该改的段落」——用户点的是第二幕，被重写的是
 * 第二幕加第三幕。那种错误改完才发现，撤销还得撤两次。
 */

/** end 不含 */
export type SectionRange = { start: number; end: number };

/**
 * @param levels 每个顶层块的标题层级；不是标题的位置为 null
 * @param index  光标所在块
 */
export function sectionRangeAt(
  levels: Array<number | null>,
  index: number
): SectionRange | null {
  if (index < 0 || index >= levels.length) return null;

  // 往回找最近的标题。光标在正文里时，它属于上面那个标题的章节
  let start = index;
  while (start >= 0 && levels[start] === null) start -= 1;
  if (start < 0) return null; // 第一个标题之前的内容不属于任何章节

  const level = levels[start] as number;
  let end = start + 1;
  while (end < levels.length) {
    const here = levels[end];
    /*
     * 只有**同级或更高级**的标题才结束这一节。
     * 用 `!== null` 当边界的话，`# 一幕` 底下的 `## 镜头一` 会把父节切断，
     * 于是「重写这一幕」只重写到第一个子标题为止。
     */
    if (here !== null && here <= level) break;
    end += 1;
  }
  return { start, end };
}
