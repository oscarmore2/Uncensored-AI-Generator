import "server-only";
import type { GenerationProduct, ModeParamMapping } from "@prisma/client";
import { MODE_META, isGenerationMode } from "./generation-modes";

/**
 * 站内参数 → WaveSpeed input 的桥接层。
 *
 * 不同模型的字段名差异很大（image / image_url / images[] / input_image…），
 * 这里一律读同步下来的 api_schema 做匹配，而不是按模型名写死分支，
 * 这样管理端换绑模型时无需改代码。schema 缺失时退回保守白名单。
 */

type PropSpec = {
  type?: string;
  default?: unknown;
  enum?: unknown[];
  items?: { type?: string };
  maximum?: number;
  minimum?: number;
};

export type RequestSchema = {
  properties: Record<string, PropSpec>;
  required: string[];
};

export function parseRequestSchema(apiSchema: string | null | undefined): RequestSchema | null {
  if (!apiSchema) return null;
  try {
    const root = JSON.parse(apiSchema) as {
      api_schemas?: Array<{
        request_schema?: { properties?: Record<string, PropSpec>; required?: string[] };
      }>;
      request_schema?: { properties?: Record<string, PropSpec>; required?: string[] };
      properties?: Record<string, PropSpec>;
      required?: string[];
    };
    const rs =
      root.api_schemas?.[0]?.request_schema ??
      root.request_schema ??
      (root.properties ? { properties: root.properties, required: root.required } : null);
    if (!rs?.properties) return null;
    return {
      properties: rs.properties,
      required: Array.isArray(rs.required) ? rs.required.filter((r) => typeof r === "string") : [],
    };
  } catch {
    return null;
  }
}

/** 参考图字段候选，按优先级排列 */
const IMAGE_FIELD_ORDER = [
  "image",
  "image_url",
  "images",
  "image_urls",
  "input_image",
  "input_images",
  "start_image",
  "first_frame_image",
  "reference_image",
  "reference_images",
  "source_image",
];

export type ImageField = { name: string; isArray: boolean };

/** 在 schema 里找该模型接收参考图的字段；找不到返回 null */
export function resolveImageField(schema: RequestSchema | null): ImageField | null {
  if (!schema) return { name: "image", isArray: false };
  for (const candidate of IMAGE_FIELD_ORDER) {
    const spec = schema.properties[candidate];
    if (spec) return { name: candidate, isArray: spec.type === "array" };
  }
  // schema 里字段名不在候选表内时，兜底扫一遍名字里带 image 的字符串/数组字段
  for (const [name, spec] of Object.entries(schema.properties)) {
    if (!/image/i.test(name)) continue;
    if (spec.type === "string" || spec.type === "array") {
      return { name, isArray: spec.type === "array" };
    }
  }
  return null;
}

/** schema 中声明的默认值 */
export function schemaDefaults(schema: RequestSchema | null): Record<string, unknown> {
  if (!schema) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    if (v && typeof v === "object" && "default" in v && v.default !== undefined) {
      out[k] = v.default;
    }
  }
  return out;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** schema 未知时允许透传的字段，避免把站内私有参数发给上游 */
const FALLBACK_ALLOWED = new Set([
  "prompt",
  "negative_prompt",
  "image",
  "image_url",
  "images",
  "size",
  "resolution",
  "aspect_ratio",
  "duration",
  "seed",
  "num_images",
  "guidance_scale",
  "enable_audio",
  "enable_base64_output",
  "enable_sync_mode",
]);

export type BuildInputsArgs = {
  product: Pick<
    GenerationProduct,
    "mode" | "tier" | "spicy" | "defaultInputs" | "unitSeconds" | "providerModelId"
  >;
  apiSchema: string | null;
  prompt: string;
  negativePrompt: string;
  /** 已上传到对象存储的参考图公开 URL（或 data URI 兜底） */
  imageUrl: string | null;
  /** 生成端提交的 UI 参数 */
  uiParams: Record<string, unknown>;
  mappings: ModeParamMapping[];
};

export type BuiltInputs = {
  inputs: Record<string, unknown>;
  /** 供报价与日志使用，不返回给生成端 */
  droppedKeys: string[];
};

export function buildProviderInputs(args: BuildInputsArgs): BuiltInputs {
  const schema = parseRequestSchema(args.apiSchema);
  const meta = isGenerationMode(args.product.mode) ? MODE_META[args.product.mode] : null;

  const inputs: Record<string, unknown> = {
    ...schemaDefaults(schema),
    ...parseJsonObject(args.product.defaultInputs),
  };

  // UI 参数按管理端配置的映射写入；下划线开头只在站内使用
  for (const m of args.mappings) {
    if (m.providerPath.startsWith("_")) continue;
    const raw = args.uiParams[m.uiKey];
    if (raw === undefined || raw === null || raw === "") continue;
    const valueMap = parseJsonObject(m.valueMap);
    const key = String(raw);
    inputs[m.providerPath] = Object.prototype.hasOwnProperty.call(valueMap, key)
      ? valueMap[key]
      : raw;
  }

  if (args.prompt.trim()) inputs.prompt = args.prompt.trim();
  if (meta?.supportsNegative && args.negativePrompt.trim()) {
    inputs.negative_prompt = args.negativePrompt.trim();
  } else {
    delete inputs.negative_prompt;
  }

  if (args.imageUrl) {
    const field = resolveImageField(schema);
    if (field) {
      inputs[field.name] = field.isArray ? [args.imageUrl] : args.imageUrl;
    }
  }

  // 视频时长必须是模型支持的整数秒
  if (args.product.unitSeconds > 0 && inputs.duration !== undefined) {
    const d = Number(inputs.duration);
    if (Number.isFinite(d)) inputs.duration = Math.max(1, Math.round(d));
  }

  // 过滤掉上游不认识的字段：多余字段会直接 400
  const droppedKeys: string[] = [];
  for (const key of Object.keys(inputs)) {
    const known = schema ? key in schema.properties : FALLBACK_ALLOWED.has(key);
    const empty = inputs[key] === null || inputs[key] === undefined || inputs[key] === "";
    if (!known || empty) {
      droppedKeys.push(key);
      delete inputs[key];
    }
  }

  return { inputs, droppedKeys };
}

/**
 * 估价用输入：把必填的媒体字段填占位 URL，
 * 否则 /model/pricing 会因缺图报错，导致管理端看不到成本。
 */
export function inputsForPricing(
  inputs: Record<string, unknown>,
  apiSchema: string | null
): Record<string, unknown> {
  const schema = parseRequestSchema(apiSchema);
  const out: Record<string, unknown> = { ...inputs };
  const placeholder = "https://picsum.photos/1024/1024";

  const field = resolveImageField(schema);
  if (field && (out[field.name] === undefined || out[field.name] === "")) {
    out[field.name] = field.isArray ? [placeholder] : placeholder;
  }
  if (!out.prompt) out.prompt = "pricing estimate";
  return out;
}
