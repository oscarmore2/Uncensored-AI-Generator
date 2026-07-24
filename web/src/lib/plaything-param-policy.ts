/** 玩物专区参数策略：敏感档位 + 媒体约束（前后端共用） */

export type MediaFieldPolicy = {
  maxItems?: number;
  accept?: string[];
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxDurationSec?: number;
};

export type TierFieldPolicy = {
  tiers: Array<string | number>;
  labels?: string[];
  default?: string | number;
};

export type PlaythingParamPolicy = {
  duration?: TierFieldPolicy;
  num_frames?: TierFieldPolicy;
  size?: TierFieldPolicy;
  resolution?: TierFieldPolicy;
  aspect_ratio?: TierFieldPolicy;
  images?: MediaFieldPolicy;
  image?: MediaFieldPolicy;
  video?: MediaFieldPolicy;
  audio?: MediaFieldPolicy;
  [key: string]: TierFieldPolicy | MediaFieldPolicy | undefined;
};

export const SENSITIVE_TIER_KEYS = new Set([
  "duration",
  "num_frames",
  "frames",
  "video_length",
  "length",
  "size",
  "resolution",
  "aspect_ratio",
  "aspect",
  "output_resolution",
]);

export const DEFAULT_IMAGE_POLICY: MediaFieldPolicy = {
  maxItems: 10,
  accept: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  maxBytes: 15 * 1024 * 1024,
  maxWidth: 4096,
  maxHeight: 4096,
  minWidth: 64,
  minHeight: 64,
};

export const DEFAULT_VIDEO_POLICY: MediaFieldPolicy = {
  maxItems: 1,
  accept: ["video/mp4", "video/webm", "video/quicktime"],
  maxBytes: 100 * 1024 * 1024,
  maxDurationSec: 30,
  maxWidth: 1920,
  maxHeight: 1920,
  minWidth: 64,
  minHeight: 64,
};

export const DEFAULT_AUDIO_POLICY: MediaFieldPolicy = {
  maxItems: 1,
  accept: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg", "audio/x-wav"],
  maxBytes: 20 * 1024 * 1024,
};

export const DEFAULT_DURATION_TIERS: TierFieldPolicy = {
  tiers: [5, 10],
  labels: ["5 秒", "10 秒"],
  default: 5,
};

export function parseParamPolicy(raw: string | null | undefined): PlaythingParamPolicy {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as PlaythingParamPolicy;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export type SchemaProp = {
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

export type ResolvedControl =
  | {
      kind: "tier";
      key: string;
      options: Array<{ value: string; label: string }>;
      defaultValue: string;
    }
  | {
      kind: "enum";
      key: string;
      options: Array<{ value: string; label: string }>;
      defaultValue: string;
    }
  | {
      kind: "media";
      key: string;
      mediaKind: "image" | "video" | "audio";
      multiple: boolean;
      policy: MediaFieldPolicy;
    }
  | {
      kind: "boolean";
      key: string;
      defaultValue: boolean;
    }
  | {
      kind: "number";
      key: string;
      defaultValue: string;
      min?: number;
      max?: number;
      integer?: boolean;
    }
  | {
      kind: "text";
      key: string;
      defaultValue: string;
    };

const MEDIA_KEY_HINTS = /^(image|images|image_url|mask|video|video_url|audio|audio_url|reference|references)/i;

export function inferMediaKind(key: string): "image" | "video" | "audio" {
  if (/video/i.test(key)) return "video";
  if (/audio/i.test(key)) return "audio";
  return "image";
}

export function isMediaSchemaKey(key: string, meta: SchemaProp): boolean {
  if (MEDIA_KEY_HINTS.test(key)) return true;
  if (meta.format === "uri" && /image|video|mask|audio|reference/i.test(key)) return true;
  if (meta.type === "array" && /image|reference/i.test(key)) return true;
  return false;
}

function mediaPolicyFor(
  key: string,
  policy: PlaythingParamPolicy,
  meta: SchemaProp
): MediaFieldPolicy {
  const kind = inferMediaKind(key);
  const base =
    kind === "video"
      ? DEFAULT_VIDEO_POLICY
      : kind === "audio"
        ? DEFAULT_AUDIO_POLICY
        : DEFAULT_IMAGE_POLICY;
  const fromPolicy =
    (policy[key] as MediaFieldPolicy | undefined) ||
    (kind === "video" ? policy.video : kind === "audio" ? policy.audio : policy.images || policy.image);
  const maxItems =
    meta.maxItems ??
    fromPolicy?.maxItems ??
    (meta.type === "array" || /images|references/i.test(key) ? base.maxItems : 1);
  return {
    ...base,
    ...fromPolicy,
    maxItems,
  };
}

function tierFromPolicyOrDefault(
  key: string,
  policy: PlaythingParamPolicy,
  meta: SchemaProp
): TierFieldPolicy | null {
  const p = policy[key] as TierFieldPolicy | undefined;
  if (p?.tiers?.length) return p;
  if (key === "duration" || key === "video_length" || key === "length") {
    const min = typeof meta.minimum === "number" ? meta.minimum : 5;
    const max = typeof meta.maximum === "number" ? meta.maximum : 10;
    if (min === max) {
      return { tiers: [min], labels: [`${min} 秒`], default: min };
    }
    // 在 min..max 间取常见档，否则默认 5/10 夹在范围内
    const candidates = [5, 6, 8, 10, 12, 15, 20, 25, 30].filter((t) => t >= min && t <= max);
    const tiers = candidates.length ? candidates : [min, max];
    return {
      tiers,
      labels: tiers.map((t) => `${t} 秒`),
      default: typeof meta.default === "number" ? meta.default : tiers[0],
    };
  }
  if (SENSITIVE_TIER_KEYS.has(key)) {
    return DEFAULT_DURATION_TIERS;
  }
  return null;
}

/** 根据 schema + paramPolicy 解析控件 */
export function resolveParamControls(
  properties: Record<string, SchemaProp>,
  policyRaw: string | null | undefined,
  opts?: { skipKeys?: Set<string> }
): ResolvedControl[] {
  const policy = parseParamPolicy(policyRaw);
  const skip = opts?.skipKeys ?? new Set(["prompt", "negative_prompt"]);
  const controls: ResolvedControl[] = [];

  for (const [key, meta] of Object.entries(properties)) {
    if (skip.has(key)) continue;

    if (isMediaSchemaKey(key, meta)) {
      const mediaKind = inferMediaKind(key);
      const mp = mediaPolicyFor(key, policy, meta);
      controls.push({
        kind: "media",
        key,
        mediaKind,
        multiple: (mp.maxItems ?? 1) > 1 || meta.type === "array" || /images|references/i.test(key),
        policy: mp,
      });
      continue;
    }

    if (meta.enum?.length) {
      const options = meta.enum.map((v) => ({ value: String(v), label: String(v) }));
      const defaultValue =
        meta.default !== undefined && meta.default !== null
          ? String(meta.default)
          : options[0]?.value ?? "";
      controls.push({ kind: "enum", key, options, defaultValue });
      continue;
    }

    if (SENSITIVE_TIER_KEYS.has(key) || policy[key]) {
      const tier = tierFromPolicyOrDefault(key, policy, meta);
      if (tier?.tiers?.length) {
        const options = tier.tiers.map((v, i) => ({
          value: String(v),
          label: tier.labels?.[i] ?? String(v),
        }));
        const defaultValue = String(tier.default ?? tier.tiers[0]);
        controls.push({ kind: "tier", key, options, defaultValue });
        continue;
      }
    }

    if (meta.type === "boolean") {
      controls.push({
        kind: "boolean",
        key,
        defaultValue: Boolean(meta.default),
      });
      continue;
    }

    if (meta.type === "integer" || meta.type === "number") {
      controls.push({
        kind: "number",
        key,
        defaultValue: meta.default != null ? String(meta.default) : "",
        min: meta.minimum,
        max: meta.maximum,
        integer: meta.type === "integer",
      });
      continue;
    }

    controls.push({
      kind: "text",
      key,
      defaultValue: meta.default != null ? String(meta.default) : "",
    });
  }

  return controls;
}

/** 校验敏感字段是否落在允许档位 */
export function assertTierValue(
  key: string,
  value: unknown,
  properties: Record<string, SchemaProp>,
  policyRaw: string | null | undefined
): string | null {
  if (!SENSITIVE_TIER_KEYS.has(key) && !parseParamPolicy(policyRaw)[key]) return null;
  const meta = properties[key] ?? {};
  if (meta.enum?.length) {
    const ok = meta.enum.some((e) => String(e) === String(value));
    return ok ? null : `${key} 不在允许枚举内`;
  }
  const tier = tierFromPolicyOrDefault(key, parseParamPolicy(policyRaw), meta);
  if (!tier?.tiers?.length) return null;
  const ok = tier.tiers.some((t) => String(t) === String(value));
  return ok ? null : `${key} 必须选择预设档位`;
}

export function mergeMediaPolicy(
  field: string,
  policyRaw: string | null | undefined,
  mediaKind: "image" | "video" | "audio"
): MediaFieldPolicy {
  const policy = parseParamPolicy(policyRaw);
  const base =
    mediaKind === "video"
      ? DEFAULT_VIDEO_POLICY
      : mediaKind === "audio"
        ? DEFAULT_AUDIO_POLICY
        : DEFAULT_IMAGE_POLICY;
  const fromField = policy[field] as MediaFieldPolicy | undefined;
  const fromKind =
    mediaKind === "video" ? policy.video : mediaKind === "audio" ? policy.audio : policy.images || policy.image;
  return { ...base, ...fromKind, ...fromField };
}
