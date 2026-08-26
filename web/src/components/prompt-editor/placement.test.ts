import { describe, it, expect } from "vitest";
import { computePlacement, EDGE, GAP, MIN_CARD_HEIGHT } from "./placement";

const viewport = { width: 1200, height: 800 };
const card = 336;

function at(top: number, bottom: number, left = 400) {
  return computePlacement({ anchor: { left, top, bottom }, viewport, cardWidth: card });
}

describe("浮动卡片的位置", () => {
  it("下面space够就放下面", () => {
    const p = at(100, 120);
    expect(p.anchor).toBe("below");
    expect(p.offset).toBe(120 + GAP);
  });

  it("**下面放不下就翻到上面**——这是按钮点不到那个 bug 的正解", () => {
    // 选区在 700–740，下面只剩 800-740-8-8 = 44px，按钮会被推出视口
    const p = at(700, 740);
    expect(p.anchor).toBe("above");
    // 按下边定位：卡片底边落在选区上边往上 8px
    expect(p.offset).toBe(viewport.height - 700 + GAP);
  });

  it("上下都不够时选空间大的那边，并且仍然给一个能滚的高度", () => {
    const tiny = { width: 1200, height: 300 };
    const p = computePlacement({
      anchor: { left: 400, top: 140, bottom: 160 },
      viewport: tiny,
      cardWidth: card,
    });
    // 上 124 / 下 124，打平时优先放下面
    expect(p.anchor).toBe("below");
    expect(p.maxHeight).toBe(MIN_CARD_HEIGHT);
  });

  it("上面明显更宽敞就翻上去", () => {
    const p = at(500, 780);
    expect(p.anchor).toBe("above");
  });

  it("maxHeight 等于那一侧的可用空间", () => {
    const p = at(100, 120);
    expect(p.maxHeight).toBe(viewport.height - 120 - GAP - EDGE);
  });

  it("靠右的选区，左边界被夹回视口内", () => {
    const p = at(100, 120, 1150);
    expect(p.left).toBe(viewport.width - card - EDGE);
    expect(p.left + card).toBeLessThanOrEqual(viewport.width - EDGE);
  });

  it("选区左边缘为负（横向滚出去了）也不会跑到视口外", () => {
    const p = at(100, 120, -50);
    expect(p.left).toBe(EDGE);
  });

  it("视口比卡片还窄时，左边界不会算成负数", () => {
    const p = computePlacement({
      anchor: { left: 10, top: 100, bottom: 120 },
      viewport: { width: 300, height: 800 },
      cardWidth: card,
    });
    expect(p.left).toBe(EDGE);
  });

  it("刚好卡在阈值上：下面够 MIN_CARD_HEIGHT 就还是放下面", () => {
    const bottom = viewport.height - MIN_CARD_HEIGHT - GAP - EDGE;
    expect(at(bottom - 20, bottom).anchor).toBe("below");
    expect(at(bottom - 19, bottom + 1).anchor).toBe("above");
  });
});
