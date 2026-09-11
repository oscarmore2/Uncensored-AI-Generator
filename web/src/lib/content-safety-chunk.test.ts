import { describe, it, expect, beforeAll } from "vitest";

/* content-safety 顺着 hf.ts 拉到 env.ts，后者在 import 期就校验环境变量 */
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AUTH_SECRET ??= "test-only-secret-test-only-secret-abc";

let chunksForModeration: (text: string) => { chunks: string[]; truncated: boolean };
beforeAll(async () => {
  ({ chunksForModeration } = await import("./content-safety"));
});

/**
 * 分片错了不会报错，只会「有一段没被审到」——而那正是这次放开长度限制之后
 * 唯一真正的风险。所以边界要钉死。
 */
describe("送审分片", () => {
  it("短文本原样一片，不做任何切分", () => {
    expect(chunksForModeration("一句话")).toEqual({ chunks: ["一句话"], truncated: false });
  });

  it("刚好等于分片长度时仍是一片", () => {
    const text = "字".repeat(4000);
    expect(chunksForModeration(text).chunks).toEqual([text]);
  });

  it("**每个字符都至少被审到一次**", () => {
    /* 每个位置一个不同的汉字（CJK 基本区有两万多个），这样 indexOf 找到的
       位置是唯一的——用重复字符的话覆盖率是算不准的 */
    const text = Array.from({ length: 12000 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("");
    const { chunks, truncated } = chunksForModeration(text);
    expect(truncated).toBe(false);

    const seen = new Array<boolean>(text.length).fill(false);
    for (const c of chunks) {
      const at = text.indexOf(c);
      expect(at).toBeGreaterThanOrEqual(0);
      for (let i = at; i < at + c.length; i++) seen[i] = true;
    }
    expect(seen.every(Boolean)).toBe(true);
  });

  it("相邻分片有重叠——被切在边界上的一句话不会两边都判安全", () => {
    const text = "字".repeat(9000);
    const { chunks } = chunksForModeration(text);
    expect(chunks.length).toBeGreaterThan(1);
    // 步长 = 分片长 - 重叠，所以总长度之和必然大于原文
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBeGreaterThan(text.length);
  });

  it("一句越线的话被切在边界上，至少有一片能完整看到它", () => {
    const needle = "这是一句完整的越线描述";
    // 故意放在第一片的末尾附近
    const text = "安".repeat(3995) + needle + "全".repeat(5000);
    const { chunks } = chunksForModeration(text);
    expect(chunks.some((c) => c.includes(needle))).toBe(true);
  });

  it("超长到撞上分片数硬顶时如实报 truncated", () => {
    const { truncated } = chunksForModeration("字".repeat(4_000_000));
    expect(truncated).toBe(true);
  });

  it("上层 5 万字的上限远够不到硬顶", () => {
    const { chunks, truncated } = chunksForModeration("字".repeat(50_000));
    expect(truncated).toBe(false);
    expect(chunks.length).toBeLessThan(32);
  });

  it("空串不炸", () => {
    expect(chunksForModeration("")).toEqual({ chunks: [""], truncated: false });
  });
});
