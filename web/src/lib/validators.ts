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
  })
  .superRefine((v, ctx) => {
    const meta = MODE_META[v.mode];
    if (meta.needsPrompt && !v.prompt?.trim()) {
      ctx.addIssue({ code: "custom", message: "请输入提示词", path: ["prompt"] });
    }
    if (meta.needsImage && !v.image_base64) {
      ctx.addIssue({ code: "custom", message: "该模式需要上传参考图片", path: ["image_base64"] });
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
