/**
 * 草稿 / 模板的表单快照编解码。
 *
 * 为什么单独抽一层，而不是直接 JSON.parse 存进去的字符串：
 * 这份 JSON 是**跨版本**的——用户三个月前存的草稿，今天的代码要能读。
 * 字段增删、类型改变、手工改坏的数据都会撞上来，所以解码一律走
 * 「逐字段校验 + 缺失落默认值」，任何一处不合预期都不能让整条草稿读不出来。
 *
 * 客户端与服务端共用，不要在这里引 server-only 的东西。
 */

/** 与 MediaInputFields 的 UploadedMedia 对齐，但在这里重新声明一遍：
 *  快照是持久化格式，不该跟着组件的类型一起漂。 */
export type SnapshotMedia = {
  id: string;
  url: string;
  name: string;
  kind: "image" | "video" | "audio";
};

export type DraftSnapshot = {
  gender: string;
  /** 脱衣高级选项，形状由 undress-options 决定，这里只做透传 */
  undressOptions: Record<string, unknown> | null;
  ratio: string;
  batch: number;
  duration: string;
  advancedOpen: boolean;
  extraParams: Record<string, string>;
  /** 字段名 → 已上传媒体 */
  media: Record<string, SnapshotMedia[]>;
  /** 旧链路那张参考图的文件名。图本身不进快照，见下面的说明 */
  imageFilename: string | null;
};

export const EMPTY_SNAPSHOT: DraftSnapshot = {
  gender: "female",
  undressOptions: null,
  ratio: "1:1",
  batch: 1,
  duration: "5",
  advancedOpen: false,
  extraParams: {},
  media: {},
  imageFilename: null,
};

const MEDIA_KINDS = new Set(["image", "video", "audio"]);

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
  }
  return out;
}

function mediaMap(v: unknown): Record<string, SnapshotMedia[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, SnapshotMedia[]> = {};
  for (const [field, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    const items: SnapshotMedia[] = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      // URL 是唯一不能缺的：缺了这条媒体就指不到任何东西
      if (typeof o.url !== "string" || !/^https?:\/\//i.test(o.url)) continue;
      const kind = typeof o.kind === "string" && MEDIA_KINDS.has(o.kind) ? o.kind : "image";
      items.push({
        // id 只在前端用来做拖动排序的稳定 key；老快照没有就现补一个
        id: typeof o.id === "string" && o.id ? o.id : `s${items.length}-${Date.now().toString(36)}`,
        url: o.url,
        name: typeof o.name === "string" ? o.name : o.url.split("/").pop() ?? "media",
        kind: kind as SnapshotMedia["kind"],
      });
    }
    if (items.length) out[field] = items;
  }
  return out;
}

/**
 * 编码。
 *
 * **不收 imageBase64**：旧链路那张参考图是 data URL，动辄几 MB。
 * 每次防抖回写都把它推上服务端、再塞进一行 Postgres，既拖慢保存
 * 也把表撑坏，而它在生成时本来就会被换成对象存储的 URL。
 * 本地 IndexedDB 那层照旧存它，刷新页面不会丢。
 */
export function encodeDraftSnapshot(input: Partial<DraftSnapshot>): string {
  const s: DraftSnapshot = { ...EMPTY_SNAPSHOT, ...input };
  return JSON.stringify({
    gender: s.gender,
    undressOptions: s.undressOptions,
    ratio: s.ratio,
    batch: s.batch,
    duration: s.duration,
    advancedOpen: s.advancedOpen,
    extraParams: s.extraParams,
    media: s.media,
    imageFilename: s.imageFilename,
  });
}

/** 解码。任何形状不对的地方都落默认值，绝不抛。 */
export function decodeDraftSnapshot(raw: string | null | undefined): DraftSnapshot {
  if (!raw) return { ...EMPTY_SNAPSHOT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_SNAPSHOT };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY_SNAPSHOT };
  }
  const o = parsed as Record<string, unknown>;
  return {
    gender: str(o.gender, EMPTY_SNAPSHOT.gender),
    undressOptions:
      o.undressOptions && typeof o.undressOptions === "object" && !Array.isArray(o.undressOptions)
        ? (o.undressOptions as Record<string, unknown>)
        : null,
    ratio: str(o.ratio, EMPTY_SNAPSHOT.ratio),
    batch: num(o.batch, EMPTY_SNAPSHOT.batch),
    duration: str(o.duration, EMPTY_SNAPSHOT.duration),
    advancedOpen: o.advancedOpen === true,
    extraParams: strMap(o.extraParams),
    media: mediaMap(o.media),
    imageFilename: typeof o.imageFilename === "string" ? o.imageFilename : null,
  };
}

/** 草稿里有没有值得保存的内容。空编辑器不该在列表里留下一条空草稿。 */
export function draftHasContent(prompt: string, snapshot: DraftSnapshot): boolean {
  if (prompt.trim()) return true;
  return Object.values(snapshot.media).some((items) => items.length > 0);
}

/** 列表里显示的标题：用户没命名就取提示词首行 */
export function draftDisplayTitle(
  title: string | null,
  prompt: string,
  fallback = "未命名草稿"
): string {
  if (title?.trim()) return title.trim();
  const line = prompt.trim().split(/\r?\n/)[0]?.trim();
  if (!line) return fallback;
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
