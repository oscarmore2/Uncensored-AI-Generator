import { z } from "zod";

export const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  password: z.string().min(8, "密码至少 8 个字符").max(128),
});

export const generationSchema = z.object({
  mode: z.enum(["txt2img", "txt2vid", "img2img", "img2vid"]),
  prompt: z.string().min(1).max(4000),
  negative_prompt: z.string().max(2000).optional().default(""),
  ratio: z.string().max(10).optional().default("1:1"),
  style: z.string().max(40).optional().default("realistic"),
  quality: z.string().max(20).optional().default("quality"),
  batch: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional().default(1),
  // base64 参考图（约 10MB 上限）；与原后端一致，暂不真正上传到 Zen
  image_base64: z.string().max(14_000_000).nullable().optional(),
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
  mode: z.enum(["txt2img", "txt2vid", "img2img", "img2vid"]),
  negative_prompt: z.string().max(2000).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  source_zen_job_id: z.string().max(120).optional(),
  title: z.string().max(200).optional(),
});

export const publicWorkPatchSchema = z
  .object({
    is_published: z.boolean().optional(),
    sort_order: z.number().int().min(-9999).max(9999).optional(),
    title: z.string().max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个字段");
