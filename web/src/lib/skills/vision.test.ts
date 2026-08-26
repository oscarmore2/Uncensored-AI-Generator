import { describe, it, expect, vi } from "vitest";

/**
 * 挑图这一步错了不会报错，只会「模型没看见图」或者「看错了图」：
 * 前者用户以为模型看过、结果对不上参考图；后者两张图张冠李戴。
 * 两种都得盯着出片才发现。
 */

const OWN = "https://cdn.example.com/media/";

vi.mock("../oss", () => ({
  getActiveOssConfig: async () => ({ publicBaseUrl: OWN.replace(/\/$/, "") }),
  // 只认自家公开前缀下的对象，与真实实现同口径
  objectKeyFromPublicUrl: (_cfg: unknown, url: string) =>
    url.startsWith(OWN) ? url.slice(OWN.length) : null,
}));

const ref = (token: string, file: string) => ({ token, url: `${OWN}${file}` });

describe("随请求带上的参考图", () => {
  it("按 [[REF]] 的顺序挑，占位符要对得上", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(
      ["Image2", "Image1"],
      [ref("Image1", "a.png"), ref("Image2", "b.png")]
    );
    expect(out).toEqual([
      { placeholder: "[[REF1]]", url: `${OWN}b.png` },
      { placeholder: "[[REF2]]", url: `${OWN}a.png` },
    ]);
  });

  it("**视频和音频不带**", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(
      ["Video1", "Image1", "Audio1"],
      [ref("Video1", "v.mp4"), ref("Image1", "a.png"), ref("Audio1", "s.mp3")]
    );
    expect(out).toEqual([{ placeholder: "[[REF2]]", url: `${OWN}a.png` }]);
  });

  it("外部 URL 一律挡掉——不能拿我们的账户去取任意地址", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(
      ["Image1", "Image2"],
      [
        { token: "Image1", url: "https://evil.example.com/x.png" },
        ref("Image2", "ok.png"),
      ]
    );
    expect(out).toEqual([{ placeholder: "[[REF2]]", url: `${OWN}ok.png` }]);
  });

  it("同一张图被引用两次只带一次", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(
      ["Image1", "Image1"],
      [ref("Image1", "a.png")]
    );
    expect(out).toHaveLength(1);
  });

  it("最多带 4 张，超出的丢掉", async () => {
    const { resolveVisionImages, MAX_VISION_IMAGES } = await import("./vision");
    const tokens = Array.from({ length: 8 }, (_, i) => `Image${i + 1}`);
    const refs = tokens.map((t, i) => ref(t, `${i}.png`));
    expect(await resolveVisionImages(tokens, refs)).toHaveLength(MAX_VISION_IMAGES);
  });

  it("提示词里没引用的素材不带", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(["Image1"], [ref("Image1", "a.png"), ref("Image2", "b.png")]);
    expect(out).toEqual([{ placeholder: "[[REF1]]", url: `${OWN}a.png` }]);
  });

  it("引用了但前端没给 URL 时跳过，不占位", async () => {
    const { resolveVisionImages } = await import("./vision");
    const out = await resolveVisionImages(["Image1", "Image2"], [ref("Image2", "b.png")]);
    expect(out).toEqual([{ placeholder: "[[REF2]]", url: `${OWN}b.png` }]);
  });

  it("没有引用就不查库也不带图", async () => {
    const { resolveVisionImages } = await import("./vision");
    expect(await resolveVisionImages([], [ref("Image1", "a.png")])).toEqual([]);
    expect(await resolveVisionImages(["Image1"], [])).toEqual([]);
  });
});

describe("告诉模型这几张图分别是谁", () => {
  it("列出占位符顺序", async () => {
    const { visionHint } = await import("./vision");
    const hint = visionHint([
      { placeholder: "[[REF1]]", url: "x" },
      { placeholder: "[[REF2]]", url: "y" },
    ]);
    // 不加这句的话两张图时模型会张冠李戴
    expect(hint).toContain("[[REF1]]、[[REF2]]");
  });

  it("没有图就不加任何东西", async () => {
    const { visionHint } = await import("./vision");
    expect(visionHint([])).toBe("");
  });
});
