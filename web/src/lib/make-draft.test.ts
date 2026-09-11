import { describe, it, expect } from "vitest";
import { stripDraftMedia, type MakeDraft, type ModeSlot } from "./make-draft";

/**
 * 配额降级：IndexedDB 写满时把 base64 参考图丢掉、只保住文字。
 *
 * 现在每个生成类型各有一份槽，撑爆配额的往往正是**别的类型**里那几张图——
 * 只清当前这一个就等于没清，而症状是「草稿又保存失败了」，看不出为什么。
 */
const slot = (over: Partial<ModeSlot> = {}): ModeSlot => ({
  tier: "low",
  spicy: false,
  prompt: "一只橘猫",
  negative: "",
  gender: "female",
  undressOptions: {} as ModeSlot["undressOptions"],
  ratio: "1:1",
  batch: 1,
  duration: "5",
  advancedOpen: false,
  imageBase64: "AAAA".repeat(1000),
  imageFilename: "cat.png",
  extraParams: {},
  media: {},
  ...over,
});

const draft = (over: Partial<MakeDraft> = {}): MakeDraft =>
  ({ mode: "txt2img", ...slot(), ...over }) as MakeDraft;

describe("草稿配额降级", () => {
  it("当前这一份的 base64 清掉", () => {
    expect(stripDraftMedia(draft()).imageBase64).toBeNull();
  });

  it("**每个生成类型的槽都要清**", () => {
    const d = draft({ slots: { txt2img: slot(), img2vid: slot(), ref2vid: slot() } });
    const out = stripDraftMedia(d);
    for (const s of Object.values(out.slots ?? {})) {
      expect(s.imageBase64).toBeNull();
    }
  });

  it("除了 base64，别的一个字都不动", () => {
    const d = draft({ slots: { txt2vid: slot({ prompt: "分镜稿", duration: "10" }) } });
    const out = stripDraftMedia(d);
    expect(out.slots?.txt2vid.prompt).toBe("分镜稿");
    expect(out.slots?.txt2vid.duration).toBe("10");
    expect(out.slots?.txt2vid.imageFilename).toBe("cat.png");
    expect(out.mode).toBe("txt2img");
  });

  it("老草稿没有 slots 时不报错", () => {
    const out = stripDraftMedia(draft({ slots: undefined }));
    expect(out.slots).toEqual({});
    expect(out.imageBase64).toBeNull();
  });

  it("不改原对象", () => {
    const d = draft({ slots: { txt2img: slot() } });
    stripDraftMedia(d);
    expect(d.imageBase64).not.toBeNull();
    expect(d.slots?.txt2img.imageBase64).not.toBeNull();
  });
});
