import { z } from "zod";
import { GENERATION_MODES, GENERATION_TIERS, MODE_META } from "./generation-modes";
import { UNDRESS_GENDERS } from "./undress-prompts";
import {
  UNDRESS_BODY_DECORATION,
  UNDRESS_BODY_TYPE,
  UNDRESS_BREAST_SHAPE,
  UNDRESS_BREAST_SIZE,
  UNDRESS_FOOTWEAR,
  UNDRESS_LEG_ENHANCE,
  UNDRESS_LOWER_WEAR,
  UNDRESS_NIPPLE_SIZE,
  UNDRESS_PUBIC_TYPE,
  UNDRESS_UNDERWEAR_COLORS,
} from "./undress-options";

/**
 * 单个字段最多几条媒体 URL。
 * 目前两家上游声明过的最大值是 14（nano-banana-2/edit 的 images），
 * 留一倍余量，免得上游哪天加到 16 就得跟着改代码。
 */
const MEDIA_URLS_PER_FIELD_LIMIT = 32;
/** 一次生成全部字段加起来最多几条 */
const MEDIA_URLS_TOTAL_LIMIT = 64;

export const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  password: z.string().min(8, "密码至少 8 个字符").max(128),
});

export const undressAdvancedSchema = z
  .object({
    lower_wear: z.enum(UNDRESS_LOWER_WEAR).optional(),
    underwear_color: z.enum(UNDRESS_UNDERWEAR_COLORS).optional(),
    footwear: z.enum(UNDRESS_FOOTWEAR).optional(),
    breast_size: z.enum(UNDRESS_BREAST_SIZE).optional(),
    breast_shape: z.enum(UNDRESS_BREAST_SHAPE).optional(),
    nipple_size: z.enum(UNDRESS_NIPPLE_SIZE).optional(),
    body_decoration: z.enum(UNDRESS_BODY_DECORATION).optional(),
    pubic_type: z.enum(UNDRESS_PUBIC_TYPE).optional(),
    body_type: z.enum(UNDRESS_BODY_TYPE).optional(),
    leg_enhance: z.enum(UNDRESS_LEG_ENHANCE).optional(),
  })
  .optional();

export const generationSchema = z
  .object({
    mode: z.enum(GENERATION_MODES),
    tier: z.enum(GENERATION_TIERS).optional().default("low"),
    spicy: z.boolean().optional().default(false),
    prompt: z.string().max(4000).optional().default(""),
    negative_prompt: z.string().max(2000).optional().default(""),
    gender: z.enum(UNDRESS_GENDERS).optional(),
    undress_options: undressAdvancedSchema,
    ratio: z.string().max(10).optional().default("1:1"),
    duration: z.union([z.string().max(10), z.number()]).optional(),
    seed: z.union([z.string().max(40), z.number().int()]).optional(),
    batch: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional().default(1),
    // base64 参考图（约 10MB 上限）
    image_base64: z.string().max(14_000_000).nullable().optional(),
    /** 参考图原始文件名，仅用于日后提示「这张图已被清理」时指认是哪一个文件 */
    image_filename: z.string().max(200).nullable().optional(),
    /**
     * 「套用 / 重新生成」时直接复用上次那张已在对象存储里的图，免去重新上传。
     * 服务端会校验该 URL 确属本人且未被清理，不能拿来指向任意外部地址。
     */
    image_url: z.string().url().max(2000).nullable().optional(),
    /**
     * 按上游字段名分组的输入媒体（已上传到对象存储的公开 URL）。
     * 例：{ video_url: ["https://…mp4"], audio: ["https://…mp3"] }
     * 对口型要视频+音频、换脸要视频+人脸图、reference-to-video 有的收 9 张、
     * 有的收 14 张，单个 image_base64 表达不了，所以新链路一律走这里；
     * image_base64 / image_url 仅为兼容旧草稿与「套用」保留。
     *
     * 这里的上限只是一道防滥用的粗闸——真正的每模型上限是 schema 自己的
     * maxItems（扫过两家上游：3/9/10/14 都有，写死一个数必然拦错模型），
     * 由 buildProviderInputs 按绑定模型裁剪。
     */
    media: z
      .record(
        z.string().max(64),
        z.array(z.string().url().max(2000)).max(MEDIA_URLS_PER_FIELD_LIMIT)
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    // 字段数不设限的话，几百个字段 × 每个 32 条会让下游那次 findMany({ url: { in } })
    // 拖成一条巨大的 IN 查询；总量卡死比逐字段卡死管用
    const totalMedia = Object.values(v.media ?? {}).reduce((n, list) => n + list.length, 0);
    if (totalMedia > MEDIA_URLS_TOTAL_LIMIT) {
      ctx.addIssue({
        code: "custom",
        message: `输入媒体最多 ${MEDIA_URLS_TOTAL_LIMIT} 个`,
        path: ["media"],
      });
    }
    const meta = MODE_META[v.mode];
    if (meta.needsPrompt && !v.prompt?.trim()) {
      ctx.addIssue({ code: "custom", message: "请输入提示词", path: ["prompt"] });
    }
    const hasMedia =
      Boolean(v.image_base64) ||
      Boolean(v.image_url) ||
      Object.values(v.media ?? {}).some((list) => list.length > 0);
    if (meta.needsMedia && !hasMedia) {
      ctx.addIssue({ code: "custom", message: "该模式需要上传输入媒体", path: ["media"] });
    }
    if (!meta.tiers.includes(v.tier)) {
      ctx.addIssue({ code: "custom", message: "该模式不支持所选档位", path: ["tier"] });
    }
    if (v.mode === "undress" && !v.gender) {
      ctx.addIssue({ code: "custom", message: "请选择性别", path: ["gender"] });
    }
  });

export const rechargeSchema = z.object({
  package: z.string().regex(/^\d+$/),
});

export const bulkIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

export const publicWorkImportSchema = z.object({
  media_url: z.string().url().max(2000).optional(),
  prompt: z.string().min(1).max(4000),
  mode: z.enum(GENERATION_MODES),
  negative_prompt: z.string().max(2000).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  source_job_id: z.string().max(120).optional(),
  title: z.string().max(200).optional(),
  is_adult: z.boolean().optional().default(false),
});

export const publicWorkPatchSchema = z
  .object({
    is_published: z.boolean().optional(),
    sort_order: z.number().int().min(-9999).max(9999).optional(),
    title: z.string().max(200).nullable().optional(),
    is_adult: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");

/**
 * 草稿保存。
 *
 * 校验刻意宽松：草稿是**半成品**，此刻填的档位/参数完全可能还不合法
 * （模式没选完、必填媒体还没传）。真正的严格校验在提交生成那一步。
 * 这里只挡住会撑坏存储或明显是脏数据的东西。
 */
export const draftPatchSchema = z.object({
  mode: z.enum(GENERATION_MODES).optional(),
  tier: z.enum(GENERATION_TIERS).optional(),
  spicy: z.boolean().optional(),
  product_id: z.number().int().positive().nullable().optional(),
  provider_model_id: z.string().max(200).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  prompt: z.string().max(20_000).optional(),
  negative_prompt: z.string().max(5_000).nullable().optional(),
  /** 已由 lib/draft-snapshot 编码好的 JSON 字符串 */
  snapshot: z.string().max(200_000).optional(),
  /** 点击生成后挂上的任务单；置 null 表示解绑 */
  generation_id: z.number().int().positive().nullable().optional(),
});

/** 新建时 mode 必填——一条草稿总得属于某个模式 */
export const draftCreateSchema = draftPatchSchema.extend({
  mode: z.enum(GENERATION_MODES),
});

/**
 * 存为模板。两个来源：
 * - 正在编辑的内容：直接带 mode/prompt/snapshot
 * - 已完成的作品：只带 from_generation_id，服务端去把参数翻出来
 */
export const templateCreateSchema = z
  .object({
    name: z.string().trim().min(1, "请给模板起个名字").max(60),
    from_generation_id: z.number().int().positive().optional(),
    from_draft_id: z.number().int().positive().optional(),
    mode: z.enum(GENERATION_MODES).optional(),
    tier: z.enum(GENERATION_TIERS).nullable().optional(),
    spicy: z.boolean().optional(),
    product_id: z.number().int().positive().nullable().optional(),
    provider_model_id: z.string().max(200).nullable().optional(),
    prompt: z.string().max(20_000).optional(),
    negative_prompt: z.string().max(5_000).nullable().optional(),
    snapshot: z.string().max(200_000).optional(),
  })
  .refine((v) => v.from_generation_id || v.from_draft_id || v.mode, {
    message: "缺少模板内容",
  });

export const templatePatchSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
