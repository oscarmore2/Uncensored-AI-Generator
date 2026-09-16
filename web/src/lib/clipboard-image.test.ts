import { describe, it, expect } from "vitest";
import {
  clipboardImageName,
  hasPlainText,
  imageFilesFrom,
  isEditableTarget,
  pasteTargetField,
  yieldsToText,
} from "./clipboard-image";

const png = (name: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

/** 构造一个结构上像 DataTransfer 的东西 */
const clip = (o: {
  files?: File[];
  items?: Array<{ kind: string; file: File | null }>;
  text?: string;
}) => ({
  files: o.files ?? [],
  items: (o.items ?? []).map((i) => ({ kind: i.kind, getAsFile: () => i.file })),
  getData: (t: string) => (t === "text/plain" ? (o.text ?? "") : ""),
});

describe("从剪贴板里挑图片", () => {
  it("files 和 items 两条路都要认", () => {
    expect(imageFilesFrom(clip({ files: [png("a.png")] }))).toHaveLength(1);
    expect(
      imageFilesFrom(clip({ items: [{ kind: "file", file: png("b.png") }] }))
    ).toHaveLength(1);
  });

  it("**同一张图出现在两条路上只算一次**——否则一次粘贴会传两份", () => {
    const f = png("same.png", 512);
    // 浏览器确实会两边都给：files 里一份，items 里同一份
    expect(imageFilesFrom(clip({ files: [f], items: [{ kind: "file", file: f }] }))).toHaveLength(1);
  });

  it("非图片一概不要——这里只服务照片栏", () => {
    const pdf = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    const mp4 = new File([new Uint8Array(10)], "a.mp4", { type: "video/mp4" });
    expect(imageFilesFrom(clip({ files: [pdf, mp4] }))).toHaveLength(0);
  });

  it("items 里 kind 不是 file 的跳过（纯文本条目就是这种）", () => {
    expect(imageFilesFrom(clip({ items: [{ kind: "string", file: png("x.png") }] }))).toHaveLength(0);
    expect(imageFilesFrom(clip({ items: [{ kind: "file", file: null }] }))).toHaveLength(0);
  });

  it("空剪贴板不炸", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
    expect(imageFilesFrom({})).toEqual([]);
  });

  it("多张图按顺序全收", () => {
    const got = imageFilesFrom(clip({ files: [png("1.png"), png("2.png", 200)] }));
    expect(got.map((f) => f.name)).toEqual(["1.png", "2.png"]);
  });
});

describe("什么时候该让给文本粘贴", () => {
  const input = { tagName: "INPUT" };
  const editor = { isContentEditable: true, tagName: "DIV" };
  const div = { tagName: "DIV" };

  it("认得出可输入的地方", () => {
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget(editor)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("**光标在输入框里且剪贴板有文本：让路**", () => {
    expect(yieldsToText(clip({ text: "你好", files: [png("a.png")] }), input)).toBe(true);
    expect(yieldsToText(clip({ text: "你好", files: [png("a.png")] }), editor)).toBe(true);
  });

  it("**没有文本就不让**——网页复制的图常常只有 text/html，那种要当贴图", () => {
    expect(yieldsToText(clip({ files: [png("a.png")] }), editor)).toBe(false);
    // 只有空白也不算文本
    expect(yieldsToText(clip({ text: "   \n ", files: [png("a.png")] }), editor)).toBe(false);
  });

  it("光标不在输入框里，有文本也不让——那时贴图才是用户要的", () => {
    expect(yieldsToText(clip({ text: "你好", files: [png("a.png")] }), div)).toBe(false);
  });

  it("getData 抛异常时按没文本处理，别让粘贴整个挂掉", () => {
    const hostile = {
      getData: () => {
        throw new Error("nope");
      },
    };
    expect(hasPlainText(hostile)).toBe(false);
  });
});

describe("给粘贴来的图片起名", () => {
  it("**通用名要换掉**——连贴三张全叫 image.png 就分不出谁是谁", () => {
    const a = clipboardImageName(png("image.png"), 0);
    const b = clipboardImageName(png("image.png"), 1);
    expect(a).not.toBe("image.png");
    expect(a).not.toBe(b);
    expect(a.endsWith(".png")).toBe(true);
  });

  it("没名字的也要起一个", () => {
    expect(clipboardImageName(png(""))).toMatch(/^粘贴-\d{6}\.png$/);
  });

  it("用户自己的文件名原样留着", () => {
    expect(clipboardImageName(png("我的猫.png"))).toBe("我的猫.png");
  });

  it("扩展名跟着 MIME 走", () => {
    const webp = new File([new Uint8Array(1)], "image.webp", { type: "image/webp" });
    expect(clipboardImageName(webp)).toMatch(/\.webp$/);
  });
});

describe("⌘V 贴到哪个位上", () => {
  const img = (field: string, maxItems = 1) => ({ field, kind: "image", maxItems });
  const vid = (field: string) => ({ field, kind: "video", maxItems: 1 });

  it("只有一个图片位时就是它", () => {
    expect(pasteTargetField([img("image")], {})).toBe("image");
  });

  it("**按顺序填**：首帧图满了才轮到尾帧图", () => {
    const specs = [img("first_frame_image"), img("end_image")];
    expect(pasteTargetField(specs, {})).toBe("first_frame_image");
    expect(pasteTargetField(specs, { first_frame_image: ["a"] })).toBe("end_image");
    expect(pasteTargetField(specs, { first_frame_image: ["a"], end_image: ["b"] })).toBe(null);
  });

  it("多图位没装满就一直是它", () => {
    const specs = [img("images", 4)];
    expect(pasteTargetField(specs, { images: ["a", "b", "c"] })).toBe("images");
    expect(pasteTargetField(specs, { images: ["a", "b", "c", "d"] })).toBe(null);
  });

  it("**视频音频位一概跳过**——剪贴板里的图不该贴进视频栏", () => {
    expect(pasteTargetField([vid("video")], {})).toBe(null);
    // 视频位排在前面也要跳过它，往后找图片位
    expect(pasteTargetField([vid("video"), img("image")], {})).toBe("image");
  });

  it("一个位都没有时返回 null，调用方据此放行默认粘贴", () => {
    expect(pasteTargetField([], {})).toBe(null);
  });
});
