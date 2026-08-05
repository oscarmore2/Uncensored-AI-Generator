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
 * 「X-to-Y」里的 Y 才是产出物。
 *
 * 不看这个的话，audio-to-video 会因为名字里带 audio 被判成音频，
 * 结果拿音频播放器去渲染一段视频。分隔符两种都要认：
 * WaveSpeed 用连字符，Atlas 有一批标签用下划线。
 */
function outputMedia(h: string): "image" | "video" | "audio" | "3d" | "text" | null {
  const m = h.match(/[-_]to[-_](image|video|audio|speech|3d|text)\b/);
  if (!m) return null;
  if (m[1] === "speech") return "audio";
  return m[1] as "image" | "video" | "audio" | "3d" | "text";
}

/**
 * 根据上游 type + model_id 归类。
 * 顺序：3D → Audio → Avatar → Video → Image → Tools（兜底）
 */
export function resolvePlaythingCategory(
  type: string,
  modelId: string
): { category: PlaythingCategoryId; media_kind: PlaythingMediaKind } {
  const h = haystack(type, modelId);
  const out = outputMedia(h);

  if (
    out === "3d" ||
    ((/image-to-3d|text-to-3d|3d|mesh|gaussian|nerf|\.glb|\.gltf|\.obj/.test(h) ||
      /\b3d\b/.test(h)) &&
      out === null)
  ) {
    return { category: "3d", media_kind: "3d" };
  }

  // 产出物明确是视频/图片时不进音频分支，哪怕名字里带 audio / speech
  if (
    out !== "video" &&
    out !== "image" &&
    /audio|tts|music|speech|sound|text-to-audio|audio-to-/.test(h)
  ) {
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

/** 浏览器能直接渲染的模型格式；其余只能给下载入口 */
const VIEWABLE_MODEL_FILE = /\.(glb|gltf)(\?|#|$)/i;
const MODEL_FILE = /\.(glb|gltf|obj|fbx|usdz|ply|stl)(\?|#|$)/i;

/**
 * 把一组 3D 结果拆成「模型本体 + 封面图」。
 *
 * 上游的 3D 输出不止一条：Atlas 的 schema 写的是
 * primary mesh first, preview image appended last。那张预览图是模型的封面，
 * 不是第二件作品——两者都取第一条的话，卡片上只会剩一个立方体占位。
 *
 * 关键是封面不能再走 mode 兜底：预览图常常没有扩展名，
 * 而 txt23d / img23d 的兜底是 "3d"，于是预览图自己也被认成模型，
 * 找封面就永远返回空。这里显式排除模型文件，剩下的就是封面。
 */
export function splitModelResult(urls: string[] | null | undefined): {
  model: string | null;
  poster: string | null;
} {
  const list = (urls ?? []).filter((u) => typeof u === "string" && u);
  const model =
    list.find((u) => VIEWABLE_MODEL_FILE.test(u)) ?? list.find((u) => MODEL_FILE.test(u)) ?? null;
  if (!model) return { model: null, poster: null };
  const poster =
    list.find(
      (u) =>
        u !== model &&
        !MODEL_FILE.test(u) &&
        !/\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(u)
    ) ?? null;
  return { model, poster };
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
