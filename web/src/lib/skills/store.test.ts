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

vi.mock("../db", () => ({
  db: {
    skill: {
      findMany: async ({ where }: { where?: { scope?: string } }) =>
        rows.filter((r) => !where?.scope || r.scope === where.scope),
      findUnique: async ({ where }: { where: { key?: string; id?: number } }) =>
        rows.find((r) => (where.key ? r.key === where.key : r.id === where.id)) ?? null,
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
