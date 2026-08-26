import { describe, it, expect } from "vitest";
import { computePlacement, EDGE, GAP, MIN_CARD_HEIGHT, type Placement } from "./placement";

const viewport = { width: 1200, height: 800 };
const card = 336;

function at(top: number, bottom: number, left = 400, vp = viewport) {
  return computePlacement({ anchor: { left, top, bottom }, viewport: vp, cardWidth: card });
}

/** 把结果换算成卡片四条边的实际坐标，用来断言「没越界」 */
function box(p: Placement, vp = viewport) {
  const t = p.anchor === "above" ? vp.height - p.offset - p.maxHeight : p.offset;
  return { left: p.left, right: p.left + card, top: t, bottom: t + p.maxHeight };
}

function assertInside(p: Placement, vp = viewport) {
  const b = box(p, vp);
  expect(b.left).toBeGreaterThanOrEqual(EDGE);
  expect(b.right).toBeLessThanOrEqual(vp.width - EDGE + 0.001);
  expect(b.top).toBeGreaterThanOrEqual(EDGE - 0.001);
  expect(b.bottom).toBeLessThanOrEqual(vp.height - EDGE + 0.001);
}

describe("浮动卡片的位置", () => {
  it("下面空间够就放下面", () => {
    const p = at(100, 120);
    expect(p.anchor).toBe("below");
    expect(p.offset).toBe(120 + GAP);
    assertInside(p);
  });

  it("下面放不下就翻到上面——按钮点不到那个 bug 的正解", () => {
    // 选区在 700–740，下面只剩 44px，按钮会被推出视口
    const p = at(700, 740);
    expect(p.anchor).toBe("above");
    expect(p.offset).toBe(viewport.height - 700 + GAP);
    assertInside(p);
  });

  it("maxHeight 等于那一侧的可用空间", () => {
    expect(at(100, 120).maxHeight).toBe(viewport.height - 120 - GAP - EDGE);
    expect(at(700, 740).maxHeight).toBe(700 - GAP - EDGE);
  });

  it("刚好卡在阈值上", () => {
    const bottom = viewport.height - MIN_CARD_HEIGHT - GAP - EDGE;
    expect(at(bottom - 20, bottom).anchor).toBe("below");
    expect(at(bottom - 19, bottom + 1).anchor).toBe("above");
  });
});

describe("四条边都不许越过", () => {
  it("上下都放不下时改成在视口里摆，而不是顶破边缘", () => {
    // 横屏手机：视口很矮，选区又在中间，两侧都不够 180
    const vp = { width: 844, height: 390 };
    const p = at(180, 200, 400, vp);
    expect(p.anchor).toBe("viewport");
    expect(p.offset).toBe(EDGE);
    expect(p.maxHeight).toBe(vp.height - EDGE * 2);
    assertInside(p, vp);
  });

  it("贴着选区放时，卡片底边不会越过视口下边", () => {
    for (let bottom = 0; bottom <= viewport.height; bottom += 37) {
      assertInside(at(Math.max(0, bottom - 20), bottom));
    }
  });

  it("选区被滚出视口上方（坐标为负）也不会跑出去", () => {
    const p = at(-300, -280);
    assertInside(p);
  });

  it("选区被滚出视口下方（坐标大于视口高）也不会跑出去", () => {
    const p = at(1500, 1520);
    assertInside(p);
    // 负偏移会把卡片推到屏幕外，夹回来之后不该出现
    expect(p.offset).toBeGreaterThanOrEqual(0);
  });

  it("靠右的选区，右边界被夹回视口内", () => {
    const p = at(100, 120, 1150);
    expect(p.left).toBe(viewport.width - card - EDGE);
    assertInside(p);
  });

  it("选区左边缘为负也不会越过左边", () => {
    expect(at(100, 120, -50).left).toBe(EDGE);
  });

  it("视口比卡片还窄时，左边界不会算成负数", () => {
    const p = computePlacement({
      anchor: { left: 10, top: 100, bottom: 120 },
      viewport: { width: 300, height: 800 },
      cardWidth: card,
    });
    expect(p.left).toBe(EDGE);
  });

  it("随便扫一遍：任何选区位置、任何视口，四条边都不越界", () => {
    for (const vp of [
      { width: 1200, height: 800 },
      { width: 844, height: 390 },
      { width: 700, height: 500 },
      { width: 660, height: 200 },
    ]) {
      for (let y = -100; y <= vp.height + 100; y += 23) {
        for (const x of [-40, 0, 20, vp.width / 2, vp.width - 10, vp.width + 60]) {
          assertInside(computePlacement({
            anchor: { left: x, top: y, bottom: y + 20 },
            viewport: vp,
            cardWidth: Math.min(card, vp.width - EDGE * 2),
          }), vp);
        }
      }
    }
  });
});
