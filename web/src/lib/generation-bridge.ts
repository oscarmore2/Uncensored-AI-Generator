import "server-only";
import type { GenerationProduct, ModeParamMapping } from "@prisma/client";
import { MODE_META, isGenerationMode } from "./generation-modes";
import { parseSizeValue, type ParamControl } from "./param-controls";
import { parseModelSchema } from "./model-schema";

/**
 * 站内参数 → 上游 input 的桥接层。
 *
 * 不同模型的字段名差异很大（image / image_url / images[] / input_image…），
 * 这里一律读同步下来的 api_schema 做匹配，而不是按模型名写死分支，
 * 这样管理端换绑模型、甚至换渠道时都无需改代码。schema 缺失时退回保守白名单。
 *
 * 两家上游给 schema 的形状不同：WaveSpeed 内联 api_schemas[].request_schema，
 * Atlas 是独立的 OpenAPI 3.0 文档（components.schemas.Input）。
 * 差异只在 parseRequestSchema 里吃掉，下游一律拿归一后的 {properties, required}。
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
  return parseModelSchema<PropSpec>(apiSchema);
}

/**
 * 参考图字段候选，按优先级排列。
 * 单图字段排在数组字段前面：站内一次只传一张参考图，
 * 命中 image 比命中 images 更贴合模型对「主体图」的语义。
 */
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
  // Atlas 的 reference-to-video 系列用这个名字
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

/**
 * 按 schema 把值转成上游要的类型，并收敛到允许范围。
 *
 * 站内 UI 的选项都是字符串，而上游对 integer 字段是严格校验的
 * （wan-2.2 的 duration 传 "8" 会直接 400）。各模型的 enum 又互不相同，
 * 所以类型转换和枚举收敛都必须以模型自带的 schema 为准，不能靠手工映射表。
 *
 * 返回 null 表示该值无法安全转换，调用方应丢弃该字段而不是硬塞给上游。
 */
export function coerceToSchema(
  value: unknown,
  spec: PropSpec | undefined
): { value: unknown; snappedFrom?: unknown } | null {
  if (!spec) return { value };

  let out: unknown = value;

  switch (spec.type) {
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      out = Math.round(n);
      break;
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      out = n;
      break;
    }
    case "boolean": {
      if (typeof value === "boolean") out = value;
      else if (value === "true" || value === "1" || value === 1) out = true;
      else if (value === "false" || value === "0" || value === 0) out = false;
      else return null;
      break;
    }
    case "string": {
      out = typeof value === "string" ? value : String(value);
      break;
    }
    case "array": {
      out = Array.isArray(value) ? value : [value];
      break;
    }
    default:
      out = value;
  }

  // 数值范围收敛
  if (typeof out === "number") {
    let n: number = out;
    if (typeof spec.minimum === "number" && n < spec.minimum) n = spec.minimum;
    if (typeof spec.maximum === "number" && n > spec.maximum) n = spec.maximum;
    out = n;
  }

  // 枚举收敛：不在允许集合里时靠拢最近的合法值，而不是原样发出去触发 400
  if (Array.isArray(spec.enum) && spec.enum.length > 0) {
    const allowed = spec.enum;
    if (!allowed.some((a) => a === out)) {
      const original = out;
      if (typeof out === "number") {
        const numeric = allowed.filter((a): a is number => typeof a === "number");
        if (numeric.length) {
          out = numeric.reduce((best, cur) =>
            Math.abs(cur - (original as number)) < Math.abs(best - (original as number)) ? cur : best
          );
        } else {
          return null;
        }
      } else {
        // 字符串枚举：忽略大小写再试一次，否则放弃该字段用模型默认值
        const hit = allowed.find(
          (a) => typeof a === "string" && a.toLowerCase() === String(out).toLowerCase()
        );
        if (hit === undefined) return null;
        out = hit;
      }
      return { value: out, snappedFrom: original };
    }
  }

  return { value: out };
}

export type SupportedParam = ParamControl;

/**
 * 算出「该模型实际支持哪些 UI 参数」。
 *
 * 参数映射是按 mode 全局配的，但字段支持是按模型的：
 * qwen-image/edit-plus 根本没有 aspect_ratio，wan-2.2 的 duration 只收 [5,8]。
 * 不做这层过滤，生成端就会显示一堆点了没用（被静默丢弃）或直接触发 400 的选项。
 *
 * schema 缺失时返回全部映射，保持旧行为。
 */
export function supportedParams(
  schema: RequestSchema | null,
  mappings: Array<Pick<ModeParamMapping, "uiKey" | "providerPath" | "options">>
): SupportedParam[] {
  const out: SupportedParam[] = [];

  for (const m of mappings) {
    const configured = parseOptionList(m.options);

    // 下划线开头是站内私有参数，不参与上游字段匹配
    if (m.providerPath.startsWith("_") || !schema) {
      out.push({
        key: m.uiKey,
        kind: configured.length ? "enum" : "text",
        options: configured,
      });
      continue;
    }

    const spec = schema.properties[m.providerPath];
    if (!spec) continue; // 模型不认这个字段，直接不给用户看

    out.push({
      ...controlFromSpec(m.uiKey, spec, configured),
      required: schema.required.includes(m.providerPath),
    });
  }

  return out;
}

/** schema 字段 → 控件描述；枚举优先，其次按类型分流 */
function controlFromSpec(
  key: string,
  spec: PropSpec,
  configured: Array<{ value: string; label: string }>
): ParamControl {
  const labelOf = new Map(configured.map((o) => [o.value, o.label]));
  const defaultValue = spec.default !== undefined ? String(spec.default) : undefined;

  // 模型声明了枚举时以模型为准，标签沿用管理端配置里同值的那条
  if (Array.isArray(spec.enum) && spec.enum.length > 0) {
    return {
      key,
      kind: "enum",
      defaultValue,
      options: spec.enum
        .filter((v) => typeof v === "string" || typeof v === "number")
        .map((v) => {
          const value = String(v);
          return { value, label: labelOf.get(value) ?? value };
        }),
    };
  }

  // 组合尺寸字段（如 "1024*1536"）：给专门的宽高编辑器而不是自由文本框。
  // 上下限来自 schema 的 minimum/maximum；不同模型的允许范围差异很大
  // （曾经这里硬编码过 4096*4096，但有的模型上限只有 1536，直接触发上游 400），
  // 所以默认「保持原图尺寸」——不主动预填一个可能超出该模型范围的值。
  if (/^size$/i.test(key) && (!spec.type || spec.type === "string")) {
    const min = spec.minimum;
    const max = spec.maximum;
    const parsedDefault = typeof spec.default === "string" ? parseSizeValue(spec.default) : null;
    const defaultInRange =
      parsedDefault &&
      (min === undefined || (parsedDefault.width >= min && parsedDefault.height >= min)) &&
      (max === undefined || (parsedDefault.width <= max && parsedDefault.height <= max));
    return {
      key,
      kind: "size",
      options: [],
      min,
      max,
      defaultValue: defaultInRange ? (spec.default as string) : undefined,
    };
  }

  if (spec.type === "boolean") {
    return { key, kind: "boolean", options: [], defaultValue };
  }

  if (spec.type === "integer" || spec.type === "number") {
    return {
      key,
      kind: "number",
      options: [],
      min: spec.minimum,
      max: spec.maximum,
      integer: spec.type === "integer",
      defaultValue,
    };
  }

  // 无枚举的字符串：若管理端配了选项就仍按枚举给，避免退化成自由输入
  if (configured.length) {
    return { key, kind: "enum", options: configured, defaultValue };
  }
  return { key, kind: "text", options: [], defaultValue };
}

function parseOptionList(raw: string | null | undefined): Array<{ value: string; label: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as { value?: unknown; label?: unknown };
        if (typeof o.value !== "string") return null;
        return { value: o.value, label: typeof o.label === "string" ? o.label : o.value };
      })
      .filter(Boolean) as Array<{ value: string; label: string }>;
  } catch {
    return [];
  }
}

/** 档位 defaultInputs 里模型不认的字段，用于管理端提示配置失效 */
export function unsupportedDefaults(
  schema: RequestSchema | null,
  defaultInputs: Record<string, unknown>
): string[] {
  if (!schema) return [];
  return Object.keys(defaultInputs).filter((k) => !(k in schema.properties));
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
  /** 被 schema 收敛过的字段，如 duration 10 → 8 */
  snapped: Array<{ key: string; from: unknown; to: unknown }>;
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

  // 过滤掉上游不认识的字段，并按 schema 修正类型 / 收敛枚举：
  // 多余字段和类型不符都会被上游直接 400
  const droppedKeys: string[] = [];
  const snapped: BuiltInputs["snapped"] = [];

  for (const key of Object.keys(inputs)) {
    const known = schema ? key in schema.properties : FALLBACK_ALLOWED.has(key);
    const empty = inputs[key] === null || inputs[key] === undefined || inputs[key] === "";
    if (!known || empty) {
      droppedKeys.push(key);
      delete inputs[key];
      continue;
    }
    if (!schema) continue;

    const spec = schema.properties[key];
    const coerced = coerceToSchema(inputs[key], spec);
    if (!coerced) {
      // 值非法时别把它发出去。但如果这个字段是必填的，删掉等于必然触发上游 400
      // （minimax/h3 的 resolution 只收 ["768P","2K"]，档位里配的 "720P" 转换不了，
      // 删掉后请求就缺必填字段）。这种情况退回 schema 自带的默认值——
      // 它按定义一定合法；连默认值都没有才放弃。
      const fallback = schema.required.includes(key) ? spec?.default : undefined;
      if (fallback !== undefined) {
        snapped.push({ key, from: inputs[key], to: fallback });
        inputs[key] = fallback;
        continue;
      }
      droppedKeys.push(key);
      delete inputs[key];
      continue;
    }
    if (coerced.snappedFrom !== undefined) {
      snapped.push({ key, from: coerced.snappedFrom, to: coerced.value });
    }
    inputs[key] = coerced.value;
  }

  return { inputs, droppedKeys, snapped };
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
