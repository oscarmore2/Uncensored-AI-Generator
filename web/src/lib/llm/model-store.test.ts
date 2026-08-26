import { describe, it, expect, vi } from "vitest";
import { LLM_MODELS } from "./models";

/**
 * 模型门禁与「技能绑了哪个模型」的解析。
 *
 * 这一层错了不会报错，只会**悄悄用了另一个模型**：贵了几十倍、或者
 * 在成人模式下被拒答。两种都得等用户来投诉才发现。
 */

vi.mock("../db", () => ({
  db: {
    llmModel: {
      findFirst: async ({ where }: { where: { key?: string; tierCode?: string } }) => {
        const all = Object.values(LLM_MODELS);
        const hit = where.key
          ? all.find((m) => m.key === where.key)
          : all.find((m) => m.tierCode === where.tierCode);
        if (!hit) return null;
        return {
          ...hit,
          provider: "openrouter",
          providerModelId: hit.openRouterModelId,
          priceSyncedAt: null,
        };
      },
      findMany: async () => [],
      upsert: async () => ({}),
    },
  },
}));

describe("模型门禁", () => {
  it("VIP 不够就用不了", async () => {
    const { canUseModel } = await import("./model-store");
    expect(canUseModel(LLM_MODELS.advanced, { vipRank: 0, adultAccess: true })).toBe(false);
    expect(canUseModel(LLM_MODELS.advanced, { vipRank: 1, adultAccess: true })).toBe(true);
  });

  it("uncensored 的模型要成人验证", async () => {
    const { canUseModel } = await import("./model-store");
    expect(canUseModel(LLM_MODELS.unrestricted, { vipRank: 9, adultAccess: false })).toBe(false);
    expect(canUseModel(LLM_MODELS.unrestricted, { vipRank: 0, adultAccess: true })).toBe(true);
  });

  it("基础档谁都能用", async () => {
    const { canUseModel } = await import("./model-store");
    expect(canUseModel(LLM_MODELS.basic, { vipRank: 0, adultAccess: false })).toBe(true);
  });
});

describe("技能绑定的模型怎么解析", () => {
  it("auto 按是否成人模式选档", async () => {
    const { resolveSkillModel } = await import("./model-store");
    expect((await resolveSkillModel("auto", {})).model.key).toBe("basic-4o-mini");
    expect((await resolveSkillModel("auto", { allowSensitive: true })).model.key).toBe(
      "unrestricted-dolphin-venice"
    );
  });

  it("绑了固定模型就用那个", async () => {
    const { resolveSkillModel } = await import("./model-store");
    expect((await resolveSkillModel("advanced-4o", {})).model.key).toBe("advanced-4o");
  });

  it("**成人模式下会拒答的模型仍然自动改用无限制档**", async () => {
    // 不换的话只会得到一句「抱歉我无法协助」，那比不给这个功能更糟
    const { resolveSkillModel } = await import("./model-store");
    const r = await resolveSkillModel("advanced-4o", { allowSensitive: true });
    expect(r.model.key).toBe("unrestricted-dolphin-venice");
    expect(r.switched).toBe(true);
  });

  it("绑的模型不存在时退回 auto，而不是让整条技能失效", async () => {
    const { resolveSkillModel } = await import("./model-store");
    expect((await resolveSkillModel("gone-forever", {})).model.key).toBe("basic-4o-mini");
  });
});
