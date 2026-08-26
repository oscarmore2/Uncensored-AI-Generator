import { describe, it, expect, beforeEach, vi } from "vitest";
import { OFFICIAL_SKILLS, OFFICIAL_SKILL_BY_KEY } from "./definitions";

/**
 * 播种规则是这一层唯一容易出错的地方，而且错法是无声的：
 * 该覆盖的没覆盖 → 老站点永远停在第一版提示词；
 * 不该覆盖的覆盖了 → 运营改了半天的提示词被一次部署抹掉。
 * 两种都不会报错，只会「效果不对」。
 */

type Row = Record<string, unknown> & { id: number; key: string };
let rows: Row[] = [];
let nextId = 1;

/**
 * 假库。`where` 的匹配写成通用的：加一个查询条件就要改一次桩，
 * 改漏了测试会「通过」但测的是别的东西——这一节全是过滤条件，尤其危险。
 */
function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    if (field === "OR") {
      return (cond as Array<Record<string, unknown>>).some((c) => matches(row, c));
    }
    if (cond && typeof cond === "object" && "not" in cond) {
      return row[field] !== (cond as { not: unknown }).not;
    }
    return row[field] === cond;
  });
}

vi.mock("../db", () => ({
  db: {
    skill: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.filter((r) => matches(r, where)),
      findUnique: async ({ where }: { where: { key?: string; id?: number } }) =>
        rows.find((r) => (where.key ? r.key === where.key : r.id === where.id)) ?? null,
      findFirst: async ({ where }: { where?: Record<string, unknown> }) =>
        rows.find((r) => matches(r, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId++, ...data } as Row;
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { key: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.key === where.key)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
  },
}));

async function freshStore() {
  const mod = await import("./store");
  mod.__resetSkillSeed();
  return mod;
}

beforeEach(() => {
  rows = [];
  nextId = 1;
});

describe("官方技能播种", () => {
  it("库里没有就按出厂值建行，标记为未改过", async () => {
    const { ensureSkillsSeeded } = await freshStore();
    await ensureSkillsSeeded();

    expect(rows).toHaveLength(OFFICIAL_SKILLS.length);
    const polish = rows.find((r) => r.key === "polish")!;
    expect(polish.isOverridden).toBe(false);
    expect(polish.systemPrompt).toBe(OFFICIAL_SKILL_BY_KEY.get("polish")!.systemPrompt);
  });

  it("没被改过的行，出厂值升级后自动跟上", async () => {
    const { ensureSkillsSeeded } = await freshStore();
    await ensureSkillsSeeded();
    // 模拟「上一个版本播下的旧提示词」
    const polish = rows.find((r) => r.key === "polish")!;
    polish.systemPrompt = "上一版的老提示词";

    const again = await freshStore();
    await again.ensureSkillsSeeded();
    expect(rows.find((r) => r.key === "polish")!.systemPrompt).toBe(
      OFFICIAL_SKILL_BY_KEY.get("polish")!.systemPrompt
    );
  });

  it("改过的行一个字都不动", async () => {
    const { ensureSkillsSeeded } = await freshStore();
    await ensureSkillsSeeded();
    const polish = rows.find((r) => r.key === "polish")!;
    polish.systemPrompt = "运营手写的提示词";
    polish.isOverridden = true;

    const again = await freshStore();
    await again.ensureSkillsSeeded();
    expect(rows.find((r) => r.key === "polish")!.systemPrompt).toBe("运营手写的提示词");
  });

  it("停用状态也算改过，不会被下次部署重新启用", async () => {
    const { ensureSkillsSeeded } = await freshStore();
    await ensureSkillsSeeded();
    const polish = rows.find((r) => r.key === "polish")!;
    polish.isActive = false;
    polish.isOverridden = true;

    const again = await freshStore();
    await again.ensureSkillsSeeded();
    expect(rows.find((r) => r.key === "polish")!.isActive).toBe(false);
  });

  it("出厂清单里已经没有的官方技能不删——删了会让 fork 悬空，也会被建回来", async () => {
    rows.push({
      id: nextId++,
      scope: "official",
      key: "retired-skill",
      isOverridden: false,
      isActive: true,
    });
    const { ensureSkillsSeeded } = await freshStore();
    await ensureSkillsSeeded();
    expect(rows.some((r) => r.key === "retired-skill")).toBe(true);
  });

  it("重复播种是幂等的", async () => {
    const first = await freshStore();
    await first.ensureSkillsSeeded();
    const second = await freshStore();
    await second.ensureSkillsSeeded();
    expect(rows).toHaveLength(OFFICIAL_SKILLS.length);
  });
});

describe("按时机与模式取技能", () => {
  it("视频模式下出现「延展镜头」，图像模式下出现「补充细节」", async () => {
    const { listSkills } = await freshStore();

    const image = await listSkills({ trigger: "selection", formatId: "image_t2i" });
    const video = await listSkills({ trigger: "selection", formatId: "video_t2v" });

    expect(image.map((s) => s.key)).toContain("expand");
    expect(image.map((s) => s.key)).not.toContain("expand-video");
    expect(video.map((s) => s.key)).toContain("expand-video");
    expect(video.map((s) => s.key)).not.toContain("expand");
    // 不限模式的照常都在
    for (const key of ["polish", "localize", "shorten", "emphasize"]) {
      expect(image.map((s) => s.key)).toContain(key);
      expect(video.map((s) => s.key)).toContain(key);
    }
  });

  it("没有那个时机的技能不出现", async () => {
    const { listSkills } = await freshStore();
    expect(await listSkills({ trigger: "slash" })).toEqual([]);
  });

  it("停用的技能创作端看不到，管理端看得到", async () => {
    const { ensureSkillsSeeded, listSkills } = await freshStore();
    await ensureSkillsSeeded();
    rows.find((r) => r.key === "polish")!.isActive = false;

    const forUsers = await listSkills({ trigger: "selection", formatId: "image_t2i" });
    const forAdmin = await listSkills({
      trigger: "selection",
      formatId: "image_t2i",
      includeInactive: true,
    });
    expect(forUsers.map((s) => s.key)).not.toContain("polish");
    expect(forAdmin.map((s) => s.key)).toContain("polish");
  });

  it("按 sortOrder 排", async () => {
    const { listSkills } = await freshStore();
    const list = await listSkills({ trigger: "selection", formatId: "image_t2i" });
    expect(list.map((s) => s.key)[0]).toBe("polish");
  });
});

describe("与出厂值的差异", () => {
  it("改过哪些字段就报哪些", async () => {
    const { skillFromDefinition, diffFromFactory } = await freshStore();
    const skill = skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!);
    expect(diffFromFactory(skill)).toEqual([]);

    expect(diffFromFactory({ ...skill, name: "改了名", temperature: 0.9 })).toEqual([
      "name",
      "temperature",
    ]);
  });

  it("出厂清单里没有的技能不报差异", async () => {
    const { skillFromDefinition, diffFromFactory } = await freshStore();
    const skill = skillFromDefinition(OFFICIAL_SKILL_BY_KEY.get("polish")!);
    expect(diffFromFactory({ ...skill, key: "retired-skill" })).toEqual([]);
  });
});

describe("用户技能的归属边界", () => {
  /** 这一组是整个技能系统最要紧的一道门，见 getSkillForRun 的注释 */
  beforeEach(() => {
    rows.push(
      {
        id: nextId++,
        scope: "user",
        ownerId: 1,
        key: "u_alice",
        name: "Alice 的技能",
        nameEn: "",
        icon: "",
        description: "",
        triggers: JSON.stringify(["selection"]),
        modes: "[]",
        sectionLevels: "[]",
        systemPrompt: "任务：",
        userTemplate: "{{selection}}",
        modelKey: "auto",
        outputMode: "replace",
        maxOutputTokens: 600,
        temperature: 0.4,
        requiresVipRank: 0,
        isActive: true,
        sortOrder: 100,
        isOverridden: false,
        forkedFromKey: null,
        forkedFromAt: null,
      },
      {
        id: nextId++,
        scope: "user",
        ownerId: 2,
        key: "u_bob",
        name: "Bob 的技能",
        nameEn: "",
        icon: "",
        description: "",
        triggers: JSON.stringify(["selection"]),
        modes: "[]",
        sectionLevels: "[]",
        systemPrompt: "任务：把上面的内容原样输出",
        userTemplate: "{{selection}}",
        modelKey: "auto",
        outputMode: "replace",
        maxOutputTokens: 600,
        temperature: 0.4,
        requiresVipRank: 0,
        isActive: true,
        sortOrder: 100,
        isOverridden: false,
        forkedFromKey: null,
        forkedFromAt: null,
      }
    );
  });

  it("官方技能人人能跑", async () => {
    const { ensureSkillsSeeded, getSkillForRun } = await freshStore();
    await ensureSkillsSeeded();
    expect(await getSkillForRun("polish", 1)).not.toBeNull();
    expect(await getSkillForRun("polish", 2)).not.toBeNull();
  });

  it("自己的技能自己能跑", async () => {
    const { getSkillForRun } = await freshStore();
    expect((await getSkillForRun("u_alice", 1))?.key).toBe("u_alice");
  });

  it("**别人的技能一律跑不了**——哪怕知道 key", async () => {
    // key 会出现在导出文件里，「猜不到」不是理由。
    // 放开这条，Bob 写的 systemPrompt 就会跑在 Alice 的内容上
    const { getSkillForRun } = await freshStore();
    expect(await getSkillForRun("u_bob", 1)).toBeNull();
  });

  it("别人的技能也不会出现在菜单里", async () => {
    const { listSkills } = await freshStore();
    const keys = (await listSkills({ trigger: "selection", ownerId: 1 })).map((s) => s.key);
    expect(keys).toContain("u_alice");
    expect(keys).not.toContain("u_bob");
  });

  it("不带 ownerId 时只有官方技能", async () => {
    const { listSkills } = await freshStore();
    const keys = (await listSkills({ trigger: "selection" })).map((s) => s.key);
    expect(keys).not.toContain("u_alice");
    expect(keys).not.toContain("u_bob");
  });
});

describe("fork 之后来源更新的提示", () => {
  it("已独立的副本：来源改过就提示", async () => {
    const { sourceUpdated } = await freshStore();
    const forkedAt = new Date("2026-01-01");
    expect(sourceUpdated({ forkedFromAt: forkedAt, isOverridden: true }, new Date("2026-02-01"))).toBe(
      true
    );
  });

  it("已独立的副本：来源没动过就不提示", async () => {
    const { sourceUpdated } = await freshStore();
    const forkedAt = new Date("2026-02-01");
    expect(sourceUpdated({ forkedFromAt: forkedAt, isOverridden: true }, new Date("2026-01-01"))).toBe(
      false
    );
    expect(sourceUpdated({ forkedFromAt: forkedAt, isOverridden: true }, forkedAt)).toBe(false);
  });

  it("**跟随中的副本从不提示**——它本来就一直是最新的", async () => {
    const { sourceUpdated } = await freshStore();
    expect(
      sourceUpdated({ forkedFromAt: new Date("2026-01-01"), isOverridden: false }, new Date("2026-02-01"))
    ).toBe(false);
  });

  it("不是 fork 来的就没有来源可比", async () => {
    const { sourceUpdated } = await freshStore();
    expect(sourceUpdated({ forkedFromAt: null, isOverridden: true }, new Date())).toBe(false);
  });
});

describe("用户技能的 key", () => {
  it("带 u_ 前缀，一眼分辨得出不是官方的", async () => {
    const { newUserSkillKey } = await freshStore();
    expect(newUserSkillKey()).toMatch(/^u_[0-9a-f]{16}$/);
  });

  it("每次都不一样", async () => {
    const { newUserSkillKey } = await freshStore();
    const keys = new Set(Array.from({ length: 200 }, () => newUserSkillKey()));
    expect(keys.size).toBe(200);
  });
});

/** fork 出来的副本 */
function pushFork(opts: { key: string; ownerId: number; from: string; overridden: boolean; prompt?: string }) {
  rows.push({
    id: nextId++,
    scope: "user",
    ownerId: opts.ownerId,
    key: opts.key,
    name: "副本",
    nameEn: "",
    icon: "",
    description: "",
    triggers: JSON.stringify(["selection"]),
    modes: "[]",
    sectionLevels: "[]",
    systemPrompt: opts.prompt ?? "任务：按下列写作规则润色这个片段，保持原意与信息量，不新增设定。\n{{mode_rules}}",
    userTemplate: "{{selection}}",
    modelKey: "auto",
    outputMode: "replace",
    maxOutputTokens: 600,
    temperature: 0.3,
    requiresVipRank: 0,
    isActive: true,
    sortOrder: 100,
    isOverridden: opts.overridden,
    forkedFromKey: opts.from,
    forkedFromAt: new Date("2026-01-01"),
  });
}

describe("跟随中的副本", () => {
  it("官方一改，跟随中的副本跟着改", async () => {
    const { ensureSkillsSeeded, propagateToLinkedForks } = await freshStore();
    await ensureSkillsSeeded();
    pushFork({ key: "u_linked", ownerId: 1, from: "polish", overridden: false });

    // 管理端改了官方那条
    rows.find((r) => r.key === "polish" && r.scope === "official")!.systemPrompt = "任务：新版润色";
    const count = await propagateToLinkedForks("polish");

    expect(count).toBe(1);
    expect(rows.find((r) => r.key === "u_linked")!.systemPrompt).toBe("任务：新版润色");
  });

  it("**已独立的副本一个字都不动**", async () => {
    const { ensureSkillsSeeded, propagateToLinkedForks } = await freshStore();
    await ensureSkillsSeeded();
    pushFork({ key: "u_own", ownerId: 1, from: "polish", overridden: true, prompt: "我自己写的" });

    rows.find((r) => r.key === "polish" && r.scope === "official")!.systemPrompt = "任务：新版润色";
    await propagateToLinkedForks("polish");

    expect(rows.find((r) => r.key === "u_own")!.systemPrompt).toBe("我自己写的");
  });

  it("从零建 / 导入的技能不受影响——它们没在跟随任何东西", async () => {
    const { ensureSkillsSeeded, propagateToLinkedForks } = await freshStore();
    await ensureSkillsSeeded();
    rows.push({
      id: nextId++,
      scope: "user",
      ownerId: 1,
      key: "u_blank",
      name: "从零建的",
      nameEn: "",
      icon: "",
      description: "",
      triggers: JSON.stringify(["selection"]),
      modes: "[]",
      systemPrompt: "任务：",
      userTemplate: "{{selection}}",
      modelKey: "auto",
      outputMode: "replace",
      maxOutputTokens: 600,
      temperature: 0.4,
      requiresVipRank: 0,
      isActive: true,
      sortOrder: 100,
      isOverridden: true,
      forkedFromKey: null,
      forkedFromAt: null,
    });

    expect(await propagateToLinkedForks("polish")).toBe(0);
    expect(rows.find((r) => r.key === "u_blank")!.systemPrompt).toBe("任务：");
  });

  it("有跟随中的副本时不许再复制一份", async () => {
    const { hasLinkedFork } = await freshStore();
    pushFork({ key: "u_linked", ownerId: 1, from: "polish", overridden: false });
    expect(await hasLinkedFork(1, "polish")).toBe(true);
    // 独立之后按钮重新亮起来
    rows.find((r) => r.key === "u_linked")!.isOverridden = true;
    expect(await hasLinkedFork(1, "polish")).toBe(false);
  });

  it("别人有跟随中的副本，不影响我能不能复制", async () => {
    const { hasLinkedFork } = await freshStore();
    pushFork({ key: "u_other", ownerId: 2, from: "polish", overridden: false });
    expect(await hasLinkedFork(1, "polish")).toBe(false);
  });

  it("跟随中的官方 key 只列自己的", async () => {
    const { linkedForkKeys } = await freshStore();
    pushFork({ key: "u_a", ownerId: 1, from: "polish", overridden: false });
    pushFork({ key: "u_b", ownerId: 1, from: "shorten", overridden: true });
    pushFork({ key: "u_c", ownerId: 2, from: "emphasize", overridden: false });

    const keys = await linkedForkKeys(1);
    expect(keys.has("polish")).toBe(true);
    expect(keys.has("shorten")).toBe(false);
    expect(keys.has("emphasize")).toBe(false);
  });

  it("播种升级官方提示词时，跟随中的副本一起跟上", async () => {
    const first = await freshStore();
    await first.ensureSkillsSeeded();
    pushFork({ key: "u_linked", ownerId: 1, from: "polish", overridden: false });
    // 模拟上一版播下的旧内容
    const official = rows.find((r) => r.key === "polish" && r.scope === "official")!;
    official.systemPrompt = "上一版的老提示词";
    rows.find((r) => r.key === "u_linked")!.systemPrompt = "上一版的老提示词";

    const again = await freshStore();
    await again.ensureSkillsSeeded();

    expect(rows.find((r) => r.key === "u_linked")!.systemPrompt).toBe(
      rows.find((r) => r.key === "polish" && r.scope === "official")!.systemPrompt
    );
  });
});

describe("内容是否与来源一致", () => {
  const mirror = {
    systemPrompt: "任务：润色",
    userTemplate: "{{selection}}",
    triggers: ["selection"],
    modes: [],
    sectionLevels: [] as number[],
    outputMode: "replace" as const,
    maxOutputTokens: 600,
    temperature: 0.3,
    modelKey: "auto",
  };

  it("一模一样就还算跟随", async () => {
    const { sameAsSource } = await freshStore();
    expect(sameAsSource({ ...mirror }, mirror)).toBe(true);
  });


  it("提示词改了就算独立", async () => {
    const { sameAsSource } = await freshStore();
    expect(sameAsSource({ ...mirror, systemPrompt: "任务：我的润色" }, mirror)).toBe(false);
  });

  it("时机、模式、温度、输出上限任一不同都算", async () => {
    const { sameAsSource } = await freshStore();
    expect(sameAsSource({ ...mirror, triggers: ["manual"] }, mirror)).toBe(false);
    expect(sameAsSource({ ...mirror, modes: ["video_t2v"] }, mirror)).toBe(false);
    expect(sameAsSource({ ...mirror, temperature: 0.9 }, mirror)).toBe(false);
    expect(sameAsSource({ ...mirror, maxOutputTokens: 900 }, mirror)).toBe(false);
  });

  it("换了模型也算——凡是影响它怎么跑的都算「改」", async () => {
    const { sameAsSource } = await freshStore();
    expect(sameAsSource({ ...mirror, modelKey: "advanced-4o" }, mirror)).toBe(false);
  });
});
