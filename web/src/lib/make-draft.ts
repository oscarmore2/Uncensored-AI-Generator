import type { UndressAdvancedOptions } from "./undress-options";
import type { UploadedMedia } from "@/components/MediaInputFields";

/**
 * 一个生成类型下的编辑状态。
 *
 * 拆出来是因为**每个生成类型该有自己的一份**：文生图写到一半切去文生视频，
 * 回来时提示词、参数、素材都该还在原处。以前整页共用一条草稿、一个 prompt，
 * 切类型时文本跟着走，素材还会被 pruneMediaToSpecs 直接裁掉——
 * 切回去就什么都没了，而且没有任何提示。
 */
export type ModeSlot = {
  tier: string;
  spicy: boolean;
  prompt: string;
  negative: string;
  gender: string;
  undressOptions: UndressAdvancedOptions;
  ratio: string;
  batch: number;
  duration: string;
  advancedOpen: boolean;
  imageBase64: string | null;
  imageFilename: string | null;
  extraParams: Record<string, string>;
  media: Record<string, UploadedMedia[]>;
};

export type MakeDraft = {
  mode: string;
  /** 各生成类型各自的那一份。老草稿没有这个字段，按下面的平铺字段恢复 */
  slots?: Record<string, ModeSlot>;
  tier: string;
  spicy: boolean;
  prompt: string;
  negative: string;
  gender: string;
  undressOptions: UndressAdvancedOptions;
  ratio: string;
  batch: number;
  duration: string;
  advancedOpen: boolean;
  imageBase64: string | null;
  imageFilename: string | null;
  extraParams: Record<string, string>;
  /** 按字段分组的输入媒体；已经是 OSS URL，刷新后可直接复用 */
  media: Record<string, UploadedMedia[]>;
};

/**
 * 配额写满时的降级：把所有 base64 参考图丢掉，只保住文字。
 *
 * **每个生成类型的槽里都可能有一份**，只清当前这一个基本没用——
 * 撑爆配额的往往正是别的类型里那几张。
 */
export function stripDraftMedia(d: MakeDraft): MakeDraft {
  return {
    ...d,
    imageBase64: null,
    slots: Object.fromEntries(
      Object.entries(d.slots ?? {}).map(([m, slot]) => [m, { ...slot, imageBase64: null }])
    ),
  };
}
