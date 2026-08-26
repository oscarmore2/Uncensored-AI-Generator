/**
 * 浮动卡片放哪儿。纯函数，好单测——这段算错不会报错，只会「按钮点不到」，
 * 而且只在某些屏幕尺寸、某些选区位置下才复现，靠手点撞不出来。
 *
 * 唯一的硬要求：**四条边都不许越过**。卡片有一角在视口外，那一角上的按钮
 * 就点不到，这次改写等于作废。
 */

/** 卡片与选区之间、以及与视口边缘之间留的空隙 */
export const GAP = 8;
export const EDGE = 8;

/**
 * 贴着选区放至少要有这么高才值得。
 *
 * 低于它就翻到另一侧；两侧都不够就干脆不贴选区了（见 `viewport`）。
 * 挤在那一点点空间里，正文能看见但按钮会被推出去。
 */
export const MIN_CARD_HEIGHT = 180;

export type Placement = {
  left: number;
  /**
   * - `below` / `above`：贴着选区放，`offset` 分别是 top / bottom
   * - `viewport`：两侧都放不下，改成在视口里居上摆，`offset` 是 top。
   *   这时会盖住选区，但盖住总比点不到强
   */
  anchor: "below" | "above" | "viewport";
  offset: number;
  maxHeight: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function computePlacement(input: {
  /** 选区的视口坐标 */
  anchor: { left: number; top: number; bottom: number };
  viewport: { width: number; height: number };
  cardWidth: number;
}): Placement {
  const { viewport, cardWidth } = input;

  /*
   * 先把选区坐标夹回视口内。
   *
   * 选区被滚出视口时 top / bottom 会是负数或大于视口高度，直接拿去算
   * 会得到负的偏移量，把卡片推到屏幕外——那正是「四条边都不许越过」
   * 最容易漏掉的一种。
   */
  const top = clamp(input.anchor.top, 0, viewport.height);
  const bottom = clamp(input.anchor.bottom, 0, viewport.height);

  const spaceBelow = viewport.height - bottom - GAP - EDGE;
  const spaceAbove = top - GAP - EDGE;

  /*
   * 只看「空间够不够」，不看卡片当前多高。
   * 拿自身高度做判据会来回抖：翻上去 → 高度被 maxHeight 压小 →
   * 又觉得下面放得下 → 翻回来。
   */
  const side: Placement["anchor"] =
    spaceBelow >= MIN_CARD_HEIGHT
      ? "below"
      : spaceAbove >= MIN_CARD_HEIGHT
        ? "above"
        : "viewport";

  /*
   * 左右：先夹进 [EDGE, 视口宽 - 卡片宽 - EDGE]，上界自己也要兜住 EDGE——
   * 视口比卡片还窄时上界会算成负数，不兜的话左边就跑出去了。
   */
  const maxLeft = Math.max(EDGE, viewport.width - cardWidth - EDGE);
  const left = clamp(input.anchor.left, EDGE, maxLeft);

  if (side === "viewport") {
    return {
      left,
      anchor: "viewport",
      offset: EDGE,
      maxHeight: Math.max(0, viewport.height - EDGE * 2),
    };
  }

  return {
    left,
    anchor: side,
    /*
     * 往上放时按**下边**定位：结果是流式吐出来的，卡片会一直变高，
     * 按上边定位的话它会一路长下来盖住选区本身。
     */
    offset: side === "below" ? bottom + GAP : viewport.height - top + GAP,
    /*
     * 就是那一侧的可用空间，**不再往上兜 MIN_CARD_HEIGHT**。
     * 兜了的话在窄视口下 maxHeight 会大于可用空间，卡片就顶破上/下边了——
     * 那种情况已经交给 viewport 分支处理。
     */
    maxHeight: side === "below" ? spaceBelow : spaceAbove,
  };
}
