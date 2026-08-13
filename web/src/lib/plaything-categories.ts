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
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i;
/** 有没有扩展名——没有的多半是 CDN 直链，可以当图片赌一把；有扩展名却不是图片的就别赌 */
const HAS_EXT = /\.[a-z0-9]{2,5}(\?|#|$)/i;

/**
 * 把一组 3D 结果拆成「模型本体 + 封面图」。
 *
 * 上游的 3D 输出不止一条：Atlas 的 schema 写的是
 * primary mesh first, preview image appended last。那张预览图是模型的封面，
 * 不是第二件作品——两者都取第一条的话，卡片上只会剩一个立方体占位。
 *
 * 关键是封面不能再走 mode 兜底：预览图常常没有扩展名，
 * 而 txt23d / img23d 的兜底是 "3d"，于是预览图自己也被认成模型，
 * 找封面就永远返回空。
 *
 * 也不能简单取「第一个非模型文件」：实测 hunyuan3d 的输出是三条
 * —— mesh.glb、源文件包 .zip、512×512 预览 .png，
 * 按顺序取会抓到那个 zip，卡片上就是一张破图。明确是图片的优先。
 */
export function splitModelResult(urls: string[] | null | undefined): {
  model: string | null;
  poster: string | null;
} {
  const list = (urls ?? []).filter((u) => typeof u === "string" && u);
  const model =
    list.find((u) => VIEWABLE_MODEL_FILE.test(u)) ?? list.find((u) => MODEL_FILE.test(u)) ?? null;
  if (!model) return { model: null, poster: null };

  const rest = list.filter((u) => u !== model && !MODEL_FILE.test(u));
  const poster =
    rest.find((u) => IMAGE_FILE.test(u)) ?? // 明确的图片
    rest.find((u) => !HAS_EXT.test(u)) ?? // 其次赌无扩展名的 CDN 直链
    null; // .zip / .bin 这类有扩展名但不是图片的，一律不当封面
  return { model, poster };
}

/**
 * 下载文件名用的后缀，以实际 URL 为准。
 * 不能按 mode 猜：那样 3D 会被存成 .jpg，用户下下来打不开。
 */
export function downloadExtOf(url: string | null | undefined, fallback = "jpg"): string {
  const m = (url ?? "").split(/[?#]/)[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : fallback;
}

/** 无扩展名的 CDN 直链只能靠模式猜；txt23d / vidupscale 这些都要认出来 */
export function fallbackKindOfMode(mode?: string): PlaythingMediaKind {
  if (!mode) return "image";
  if (mode.endsWith("3d")) return "3d";
  if (mode.endsWith("vid") || mode.startsWith("vid") || mode.includes("video")) return "video";
  if (mode === "lipsync" || mode === "faceswap") return "video";
  return "image";
}

/** 先按 URL 后缀判定，判不出来时用生成模式兜底 */
export function mediaKindOf(
  urls: string[] | null | undefined,
  mode?: string
): PlaythingMediaKind {
  return detectMediaKindFromUrls(urls, fallbackKindOfMode(mode));
}

/** 富媒体优先级：一个任务同时产出封面图和视频时，作品本体是视频 */
const KIND_WEIGHT: Record<PlaythingMediaKind, number> = {
  video: 3,
  "3d": 3,
  audio: 2,
  image: 1,
};

/**
 * 一组结果里最能代表作品的类型。
 * 逐条判定后取权重最高的——否则 [cover.jpg, clip.mp4] 会被当成图片，
 * 卡片就丢了视频角标和播放入口。
 */
export function primaryMediaKind(
  urls: string[] | null | undefined,
  mode?: string
): PlaythingMediaKind {
  if (!urls?.length) return mediaKindOf(urls, mode);
  let best = mediaKindOf([urls[0]], mode);
  for (const u of urls) {
    const k = mediaKindOf([u], mode);
    if (KIND_WEIGHT[k] > KIND_WEIGHT[best]) best = k;
  }
  return best;
}

export interface WorkGalleryItem {
  url: string;
  /** 视频/3D 的封面，图片没有 */
  poster: string | null;
}

export interface WorkGalleryFile {
  url: string;
  ext: string;
  /** 对应画廊里的第几项；封面等附属件不进画廊，为 null */
  galleryIndex: number | null;
}

export interface WorkGallery {
  kind: PlaythingMediaKind;
  items: WorkGalleryItem[];
  files: WorkGalleryFile[];
  /** 是否值得出缩略图条与翻页 */
  multi: boolean;
}

/**
 * 把一次生成的结果 URL 拆成「画廊条目」与「文件清单」两份。
 *
 * 规则：**只有图片可以是多件**。
 *
 * 视频 / 3D / 音频固定单件——上游给的第二条几乎总是封面图或附属件
 * （3D 是 模型+预览图，视频是 mp4+封面），它们是同一件作品的组成部分，
 * 不是第二个产出。以前 AdaptiveMedia 拿到 [mp4, jpg] 会铺成两格网格，
 * 左边视频右边一张封面，看着像生成了两件东西。
 *
 * 另一层原因是成本：视频与 3D 每挂一个实例就是一份解码缓冲/WebGL 上下文，
 * 做成可切换的画廊等于同时压着两份内存，不值当。
 */
export function buildWorkGallery(
  urls: string[] | null | undefined,
  mode?: string,
  /** 调用方已经知道类型时直接给（玩物专区的 media_kind），比按 URL 猜准 */
  knownKind?: PlaythingMediaKind
): WorkGallery {
  const list = (urls ?? []).filter((u): u is string => typeof u === "string" && Boolean(u));
  const kind = knownKind ?? primaryMediaKind(list, mode);

  const file = (url: string, galleryIndex: number | null): WorkGalleryFile => ({
    url,
    ext: downloadExtOf(url),
    galleryIndex,
  });

  if (!list.length) return { kind, items: [], files: [], multi: false };

  if (kind === "image") {
    const items = list.map((url) => ({ url, poster: null }));
    return {
      kind,
      items,
      files: list.map((url, i) => file(url, i)),
      multi: items.length > 1,
    };
  }

  // 单件类：挑出主体，其余一律只进文件清单
  let primary: string | null = null;
  let poster: string | null = null;

  if (kind === "3d") {
    const split = splitModelResult(list);
    primary = split.model;
    poster = split.poster;
  } else {
    primary = list.find((u) => mediaKindOf([u], mode) === kind) ?? null;
    poster = list.find((u) => u !== primary && detectMediaKindFromUrl(u, "image") === "image") ?? null;
  }
  // 一条都认不出来时退回第一条，总比整个空掉强
  if (!primary) primary = list[0];

  return {
    kind,
    items: [{ url: primary, poster }],
    files: list.map((url) => file(url, url === primary ? 0 : null)),
    multi: false,
  };
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
