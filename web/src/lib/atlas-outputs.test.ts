import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AUTH_SECRET ??= "test-only-secret-test-only-secret-abc";

const { normalizeOutputs } = await import("./atlas");

/**
 * 从上游回包里捞媒体地址。
 *
 * 捞不到的后果不是报错，是**上游明明出了片、我们记录里一个地址都没有**——
 * 用户看到「已完成」，点开只有一块占位图。seedance-2.5 那批的 output 是个对象
 * 而不是数组，老实现一条都捞不到，就是这么炸的。
 */
const MP4 = "https://cdn.example.com/a.mp4?X-Tos-Expires=86400&X-Tos-Signature=abc";

describe("解析上游输出", () => {
  it("单个字符串", () => {
    expect(normalizeOutputs(MP4)).toEqual([MP4]);
  });

  it("字符串数组", () => {
    expect(normalizeOutputs([MP4, "https://cdn.example.com/b.mp4"])).toEqual([
      MP4,
      "https://cdn.example.com/b.mp4",
    ]);
  });

  it("对象数组（老实现认得的那种）", () => {
    expect(normalizeOutputs([{ url: MP4 }])).toEqual([MP4]);
  });

  it("**单个对象**——老实现直接返回空，就是这条炸的", () => {
    expect(normalizeOutputs({ video_url: MP4 })).toEqual([MP4]);
    expect(normalizeOutputs({ url: MP4 })).toEqual([MP4]);
  });

  it("嵌在 data / result 里也能捞出来", () => {
    expect(normalizeOutputs({ data: { video: { url: MP4 } } })).toEqual([MP4]);
    expect(normalizeOutputs({ result: [{ download_url: MP4 }] })).toEqual([MP4]);
  });

  it("主体排在缩略图前面——画廊按顺序挑主体", () => {
    const poster = "https://cdn.example.com/poster.jpg";
    expect(normalizeOutputs({ cover: poster, url: MP4 })[0]).toBe(MP4);
  });

  it("非 http 的字符串不算地址", () => {
    expect(normalizeOutputs({ url: "pending", status: "ok" })).toEqual([]);
    expect(normalizeOutputs("processing")).toEqual([]);
  });

  it("重复地址只留一份", () => {
    expect(normalizeOutputs({ url: MP4, video_url: MP4 })).toEqual([MP4]);
  });

  it("空值一律给空数组，不抛", () => {
    for (const v of [null, undefined, 0, false, [], {}]) {
      expect(normalizeOutputs(v)).toEqual([]);
    }
  });

  it("深度和条数有上限，不会被畸形回包拖死", () => {
    let deep: unknown = MP4;
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(normalizeOutputs(deep)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => `https://cdn.example.com/${i}.mp4`);
    expect(normalizeOutputs(many).length).toBeLessThanOrEqual(16);
  });
});
