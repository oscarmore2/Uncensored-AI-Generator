/**
 * 上游模型参数 schema 的唯一解析入口。
 *
 * 各家给的形状不一样：
 *   WaveSpeed  api_schemas[0].request_schema  （内联在模型目录里）
 *   Atlas      components.schemas.Input       （独立的 OpenAPI 3.0 文档）
 * 早先这段解析在 generation-bridge、plaything-runner 和三个玩物路由里各抄了一份，
 * 结果接入 Atlas 时只改了其中两份，玩物专区的参数表单对 Atlas 模型一直是空的。
 * 现在只留这一份，加新渠道时也只有这里要动。
 */

/** JSON Schema 属性的宽松形状；各调用方按自己的窄类型取用 */
export type SchemaProperty = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
  items?: { type?: string; format?: string };
  maxItems?: number;
  minItems?: number;
};

export type ParsedModelSchema<P = SchemaProperty> = {
  properties: Record<string, P>;
  required: string[];
};

type SchemaNode = { properties?: Record<string, unknown>; required?: unknown };

type SchemaRoot = {
  api_schemas?: Array<{ request_schema?: SchemaNode }>;
  request_schema?: SchemaNode;
  components?: { schemas?: Record<string, SchemaNode | undefined> };
  properties?: Record<string, unknown>;
  required?: unknown;
};

/**
 * 解析出 {properties, required}；解析不出返回 null。
 *
 * `model` 字段会被摘掉：它是 Atlas 的路由字段而不是生成参数，
 * 留着会在参数表单里冒出一个「模型」下拉框，提交时也由适配器权威写入。
 */
export function parseModelSchema<P = SchemaProperty>(
  raw: string | null | undefined
): ParsedModelSchema<P> | null {
  if (!raw) return null;
  let root: SchemaRoot;
  try {
    root = JSON.parse(raw) as SchemaRoot;
  } catch {
    return null;
  }

  const node =
    root.api_schemas?.[0]?.request_schema ??
    root.request_schema ??
    root.components?.schemas?.Input ??
    (root.properties ? { properties: root.properties, required: root.required } : null);

  if (!node?.properties) return null;

  const properties: Record<string, P> = {};
  for (const [key, value] of Object.entries(node.properties)) {
    if (key === "model") continue;
    properties[key] = value as P;
  }

  const required = Array.isArray(node.required)
    ? node.required.filter((r): r is string => typeof r === "string" && r !== "model")
    : [];

  return { properties, required };
}

/** 只要属性表，解析不出时给空对象（调用方普遍按「没有约束」处理） */
export function parseModelProperties<P = SchemaProperty>(
  raw: string | null | undefined
): Record<string, P> {
  return parseModelSchema<P>(raw)?.properties ?? {};
}

/** schema 里声明的默认值 */
export function parseModelDefaults(raw: string | null | undefined): Record<string, unknown> {
  const props = parseModelProperties(raw);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v && typeof v === "object" && "default" in v && v.default !== undefined) {
      out[k] = v.default;
    }
  }
  return out;
}
