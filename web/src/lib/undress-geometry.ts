import "server-only";
import { imageSize } from "image-size";
import type { RequestSchema } from "./generation-bridge";
import { coerceToSchema } from "./generation-bridge";

/**
 * 脱衣模式输出尺寸：强制贴合参考图宽高比。
 * 不同 WaveSpeed 模型字段不一（size / aspect_ratio / width+height），按 schema 择优写入。
 */

export type ImageDims = { width: number; height: number };

const COMMON_RATIOS: Array<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
];

/** 上游常见边长上限；过大易 400，按比例缩到 maxSide 内 */
const MAX_SIDE = 2048;
/** 部分模型要求边长为 8/16 的倍数 */
const ALIGN = 8;

export function parseDataUrlBuffer(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[1], "base64");
    return buf.length >= 32 ? buf : null;
  } catch {
    return null;
  }
}

export function readImageDimsFromDataUrl(dataUrl: string): ImageDims | null {
  const buf = parseDataUrlBuffer(dataUrl);
  if (!buf) return null;
  try {
    const info = imageSize(buf);
    if (!info.width || !info.height || info.width < 8 || info.height < 8) return null;
    return { width: info.width, height: info.height };
  } catch {
    return null;
  }
}

function alignDown(n: number): number {
  return Math.max(ALIGN, Math.floor(n / ALIGN) * ALIGN);
}

/** 等比缩放到长边 ≤ maxSide，并对齐到 ALIGN */
export function fitOutputDims(dims: ImageDims, maxSide = MAX_SIDE): ImageDims {
  const scale = Math.min(1, maxSide / Math.max(dims.width, dims.height));
  let width = alignDown(Math.round(dims.width * scale));
  let height = alignDown(Math.round(dims.height * scale));
  // 对齐后可能略偏比例：以较长边为准再校正较短边
  const target = dims.width / dims.height;
  if (width / height > target * 1.02) {
    width = alignDown(Math.round(height * target));
  } else if (height / width > (1 / target) * 1.02) {
    height = alignDown(Math.round(width / target));
  }
  return { width: Math.max(ALIGN, width), height: Math.max(ALIGN, height) };
}

export function nearestAspectRatioLabel(
  width: number,
  height: number,
  allowed?: string[]
): string {
  const ratio = width / height;
  const pool = allowed?.length
    ? COMMON_RATIOS.filter((r) => allowed.includes(r.label))
    : COMMON_RATIOS;
  const list = pool.length ? pool : COMMON_RATIOS;
  let best = list[0];
  let bestDist = Math.abs(ratio - best.value);
  for (const item of list) {
    const d = Math.abs(ratio - item.value);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best.label;
}

/**
 * 按模型 schema 把原图尺寸写入 inputs（覆盖 defaultInputs 里的方图）。
 * 返回实际写入的字段，便于日志。
 */
export function applySourceAspectToInputs(
  inputs: Record<string, unknown>,
  schema: RequestSchema | null,
  dims: ImageDims
): string[] {
  const fitted = fitOutputDims(dims);
  const written: string[] = [];
  const props = schema?.properties ?? {};

  const setIfKnown = (key: string, value: unknown) => {
    if (schema && !(key in props)) return;
    const coerced = coerceToSchema(value, props[key]);
    if (!coerced) return;
    inputs[key] = coerced.value;
    written.push(key);
  };

  if (!schema || "size" in props) {
    setIfKnown("size", `${fitted.width}*${fitted.height}`);
  }
  if (!schema || "width" in props) {
    setIfKnown("width", fitted.width);
  }
  if (!schema || "height" in props) {
    setIfKnown("height", fitted.height);
  }
  if (!schema || "aspect_ratio" in props) {
    const enumVals = Array.isArray(props.aspect_ratio?.enum)
      ? props.aspect_ratio!.enum!.filter((v): v is string => typeof v === "string")
      : undefined;
    setIfKnown("aspect_ratio", nearestAspectRatioLabel(fitted.width, fitted.height, enumVals));
  }

  return written;
}
