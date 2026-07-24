/** 玩物专区品类 / 媒体类型映射（前后端共用，无 server-only） */

export type PlaythingCategoryId =
  | "image"
  | "video"
  | "avatar"
  | "audio"
  | "3d"
  | "tools";

export type PlaythingMediaKind = "image" | "video" | "audio" | "3d";

export type PlaythingCategoryMeta = {
  id: PlaythingCategoryId;
  label: string;
  icon: string; // font-awesome class suffix e.g. fa-image
  mediaKind: PlaythingMediaKind;
};

export const PLAYTHING_CATEGORIES: PlaythingCategoryMeta[] = [
  { id: "image", label: "Image", icon: "fa-image", mediaKind: "image" },
  { id: "video", label: "Video", icon: "fa-film", mediaKind: "video" },
  { id: "avatar", label: "Avatar", icon: "fa-user", mediaKind: "image" },
  { id: "audio", label: "Audio", icon: "fa-music", mediaKind: "audio" },
  { id: "3d", label: "3D", icon: "fa-cube", mediaKind: "3d" },
  { id: "tools", label: "Tools", icon: "fa-screwdriver-wrench", mediaKind: "image" },
];

const CATEGORY_BY_ID = Object.fromEntries(
  PLAYTHING_CATEGORIES.map((c) => [c.id, c])
) as Record<PlaythingCategoryId, PlaythingCategoryMeta>;

function haystack(type: string, modelId: string): string {
  return `${type} ${modelId}`.toLowerCase();
}

/**
 * 根据 WaveSpeed type + model_id 归类。
 * 顺序：3D → Audio → Avatar → Video → Image → Tools（兜底）
 */
export function resolvePlaythingCategory(
  type: string,
  modelId: string
): { category: PlaythingCategoryId; media_kind: PlaythingMediaKind } {
  const h = haystack(type, modelId);

  if (
    /image-to-3d|text-to-3d|3d|mesh|gaussian|nerf|\.glb|\.gltf|\.obj/.test(h) ||
    /\b3d\b/.test(h)
  ) {
    return { category: "3d", media_kind: "3d" };
  }

  if (/audio|tts|music|speech|sound|text-to-audio|audio-to-/.test(h)) {
    return { category: "audio", media_kind: "audio" };
  }

  if (
    /avatar|talking|lipsync|lip-sync|face.?swap|infinite-you|infinite_you|live.?portrait|portrait.?live/.test(
      h
    )
  ) {
    // Avatar 输出可能是图或视频，默认按 video 若含 video/talking，否则 image
    const media_kind: PlaythingMediaKind =
      /video|talking|lipsync|lip-sync|live/.test(h) ? "video" : "image";
    return { category: "avatar", media_kind };
  }

  if (
    /text-to-video|image-to-video|video-to-video|t2v|i2v|\bvideo\b|img2vid|seedance/.test(h)
  ) {
    return { category: "video", media_kind: "video" };
  }

  if (
    /text-to-image|image-to-image|img2img|txt2img|\bimage\b|uncensored|chroma|flux|sdxl|diffusion/.test(
      h
    )
  ) {
    return { category: "image", media_kind: "image" };
  }

  // 特效工具类（丰乳等）
  if (/breast|expansion|undress|inpaint|upscale|enhance|effect|tool/.test(h)) {
    return { category: "tools", media_kind: "image" };
  }

  // 未识别：有 video 字样归视频，否则 Tools 图
  if (/video/.test(h)) return { category: "video", media_kind: "video" };
  return { category: "tools", media_kind: "image" };
}

export function categoryMeta(id: PlaythingCategoryId): PlaythingCategoryMeta {
  return CATEGORY_BY_ID[id];
}

/** 按 URL 后缀推断媒体类型（覆盖 avatar 等不确定输出） */
export function detectMediaKindFromUrl(
  url: string,
  fallback: PlaythingMediaKind = "image"
): PlaythingMediaKind {
  if (/\.(glb|gltf|obj|fbx)(\?|#|$)/i.test(url)) return "3d";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(url)) return "audio";
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return "video";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(url)) return "image";
  return fallback;
}

export function detectMediaKindFromUrls(
  urls: string[] | null | undefined,
  fallback: PlaythingMediaKind
): PlaythingMediaKind {
  if (!urls?.length) return fallback;
  for (const u of urls) {
    const k = detectMediaKindFromUrl(u, fallback);
    if (k !== fallback || /\.(glb|gltf|mp4|webm|mp3|wav)/i.test(u)) return k;
  }
  return detectMediaKindFromUrl(urls[0], fallback);
}
