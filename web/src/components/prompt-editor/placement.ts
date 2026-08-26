/**
 * 浮动卡片放哪儿。纯函数，好单测——这段算错不会报错，只会「按钮点不到」，
 * 而且只在某些屏幕高度、某些选区位置下才复现，靠手点撞不出来。
 */

/** 卡片与选区之间、以及与视口边缘之间留的空隙 */
export const GAP = 8;
export const EDGE = 8;

/**
 * 往下放至少要有这么高才值得。
 *
 * 低于它就翻到选区上方去——挤在底部那一点点空间里，正文能看见但按钮会被
 * 推到视口外，这次改写就等于作废了。
 */
export const MIN_CARD_HEIGHT = 180;

export type Placement = {
  left: number;
  /** 卡片放在选区下方还是上方 */
  anchor: "below" | "above";
  /** below 时是 top，above 时是 bottom */
  offset: number;
  maxHeight: number;
};

export function computePlacement(input: {
  /** 选区的视口坐标 */
  anchor: { left: number; top: number; bottom: number };
  viewport: { width: number; height: number };
  cardWidth: number;
}): Placement {
  const { anchor, viewport, cardWidth } = input;

  const spaceBelow = viewport.height - anchor.bottom - GAP - EDGE;
  const spaceAbove = anchor.top - GAP - EDGE;
  /*
   * 只看「空间够不够」，不看卡片当前多高。
   * 拿卡片自身高度做判据会来回抖：翻上去 → 高度被 maxHeight 压小 →
   * 又觉得下面放得下 → 翻回来。
   */
  const below = spaceBelow >= MIN_CARD_HEIGHT || spaceBelow >= spaceAbove;

  return {
    left: Math.max(EDGE, Math.min(anchor.left, viewport.width - cardWidth - EDGE)),
    anchor: below ? "below" : "above",
    /*
     * 往上放时按**下边**定位：结果是流式吐出来的，卡片会一直变高，
     * 按上边定位的话它会一路长下来盖住选区本身。
     */
    offset: below ? anchor.bottom + GAP : viewport.height - anchor.top + GAP,
    // 两边都很挤时也留一个能滚的高度，总比整张卡贴边好
    maxHeight: Math.max(MIN_CARD_HEIGHT, below ? spaceBelow : spaceAbove),
  };
}
