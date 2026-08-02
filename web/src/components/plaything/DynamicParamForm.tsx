"use client";

import { useMemo } from "react";
import { resolveParamControls, type ResolvedControl } from "@/lib/plaything-param-policy";
import {
  createPendingMedia,
  revokePendingMedia,
  type PendingMedia,
} from "@/lib/plaything-upload-client";
import { useState } from "react";
import type { PlaythingProduct } from "./types";
import { ParamControlGrid } from "@/components/ParamControls";
import { accentOf, type AccentTone, type ParamControl } from "@/lib/param-controls";
import { useTranslations } from "next-intl";

/** 与 src/lib/prompt-optimizer.ts 的 PromptOptimizeStyle 保持一致；那边有 server-only 不便直接导入类型以外的东西 */
export type PromptOptimizeStyle =
  | "default"
  | "artistic"
  | "photographic"
  | "technical"
  | "anime"
  | "realistic";

const OPTIMIZE_STYLES: PromptOptimizeStyle[] = [
  "default",
  "artistic",
  "photographic",
  "technical",
  "anime",
  "realistic",
];

export type DynamicFormState = {
  prompt: string;
  negativePrompt: string;
  /** 非媒体字段（档位/数字/文本等） */
  fields: Record<string, string>;
  /** 媒体字段 → 本地待上传文件（点击生成后再上传） */
  mediaFiles: Record<string, PendingMedia[]>;
  /**
   * 媒体字段 → 已经在对象存储里的 URL（「套用」历史任务时带回来的）。
   * 这些不需要再上传一遍，提交时直接并进参数。
   */
  mediaUrls?: Record<string, string[]>;
};

export function defaultsFromProduct(product: PlaythingProduct | null): DynamicFormState {
  const fields: Record<string, string> = {};
  const mediaFiles: Record<string, PendingMedia[]> = {};
  let prompt = "";
  let negativePrompt = "";

  const props = product?.param_schema?.properties ?? {};
  if (props.prompt?.default != null) prompt = String(props.prompt.default);
  if (props.negative_prompt?.default != null) negativePrompt = String(props.negative_prompt.default);

  const controls =
    product?.controls ??
    resolveParamControls(props, product ? JSON.stringify(product.param_policy ?? {}) : null);

  for (const c of controls) {
    if (c.kind === "media") {
      mediaFiles[c.key] = [];
    } else if (c.kind === "boolean") {
      fields[c.key] = c.defaultValue ? "true" : "false";
    } else if (c.kind === "tier" || c.kind === "enum") {
      fields[c.key] = c.defaultValue;
    } else if (c.kind === "number" || c.kind === "text" || c.kind === "size") {
      // size 的 defaultValue 通常是空串（保持原图尺寸），与 number/text 走同一路径即可
      fields[c.key] = c.defaultValue;
    }
  }

  return { prompt, negativePrompt, fields, mediaFiles, mediaUrls: {} };
}

export function releaseFormMedia(form: DynamicFormState) {
  for (const items of Object.values(form.mediaFiles)) {
    revokePendingMedia(items);
  }
}

function getControls(product: PlaythingProduct): ResolvedControl[] {
  if (product.controls?.length) return product.controls;
  return resolveParamControls(
    product.param_schema?.properties ?? {},
    JSON.stringify(product.param_policy ?? {})
  );
}

/** ResolvedControl → 共用的 ParamControl 描述 */
function toParamControl(c: ResolvedControl, required: Set<string>): ParamControl | null {
  const base = { key: c.key, required: required.has(c.key) };
  switch (c.kind) {
    case "tier":
    case "enum":
      return { ...base, kind: "enum", options: c.options, defaultValue: c.defaultValue };
    case "boolean":
      return { ...base, kind: "boolean", options: [], defaultValue: c.defaultValue ? "true" : "false" };
    case "number":
      return {
        ...base,
        kind: "number",
        options: [],
        min: c.min,
        max: c.max,
        integer: c.integer,
        defaultValue: c.defaultValue,
      };
    case "text":
      return { ...base, kind: "text", options: [], defaultValue: c.defaultValue };
    case "size":
      return { ...base, kind: "size", options: [], min: c.min, max: c.max, defaultValue: c.defaultValue };
    default:
      return null;
  }
}

export function DynamicParamForm({
  product,
  value,
  onChange,
  onError,
  accent = "sky",
  promptOptimizerEnabled = false,
  optimizing = false,
  onOptimizePrompt,
}: {
  product: PlaythingProduct;
  value: DynamicFormState;
  onChange: (next: DynamicFormState) => void;
  onError?: (msg: string) => void;
  /** 主体强调色；玩物专区默认 sky */
  accent?: AccentTone;
  /** 是否显示「AI 优化」入口（feature flag + 该品类是否支持） */
  promptOptimizerEnabled?: boolean;
  /** 优化请求进行中；由父组件管理（涉及先上传参考图再调用接口） */
  optimizing?: boolean;
  onOptimizePrompt?: (style: PromptOptimizeStyle) => void;
}) {
  const t = useTranslations("Plaything");
  const controls = useMemo(() => getControls(product), [product]);
  const props = product.param_schema?.properties ?? {};
  const required = new Set(product.param_schema?.required ?? []);
  const hasPrompt = "prompt" in props || Object.keys(props).length === 0;
  const hasNegative = "negative_prompt" in props;
  const [optimizeStyle, setOptimizeStyle] = useState<PromptOptimizeStyle>("default");
  // 优化器只对图片/视频类产出有意义（音频/3D/工具类没有对应的视觉描述规则）
  const showOptimizer =
    promptOptimizerEnabled &&
    hasPrompt &&
    (product.media_kind === "image" || product.media_kind === "video");

  const mediaControls = controls.filter((c) => c.kind === "media");
  const otherControls = controls.filter((c) => c.kind !== "media");
  const a = accentOf(accent);
  // 复用生成端同一套自适应控件：枚举少则 chip、数值带上下限则滑块、布尔则开关
  const paramControls = otherControls
    .slice(0, 16)
    .map((c) => toParamControl(c, required))
    .filter((c): c is ParamControl => c !== null);

  // 组件卸载时不 revoke（由 page 在切模型时 release），避免误清

  async function handleFiles(c: Extract<ResolvedControl, { kind: "media" }>, files: FileList | null) {
    if (!files?.length) return;
    const max = c.policy.maxItems ?? (c.multiple ? 10 : 1);
    const existing = value.mediaFiles[c.key] ?? [];
    const room = Math.max(0, max - existing.length);
    if (room <= 0) {
      onError?.(t("maxFiles", { max }));
      return;
    }
    const list = Array.from(files).slice(0, room);
    try {
      const pending: PendingMedia[] = [];
      for (const file of list) {
        pending.push(
          await createPendingMedia({
            file,
            kind: c.mediaKind,
            policy: c.policy,
          })
        );
      }
      const nextList = c.multiple ? [...existing, ...pending] : pending.slice(0, 1);
      if (!c.multiple && existing.length) {
        revokePendingMedia(existing);
      }
      onChange({
        ...value,
        mediaFiles: {
          ...value.mediaFiles,
          [c.key]: nextList,
        },
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : t("fileValidationFailed"));
    }
  }

  function removeReusedMedia(key: string, url: string) {
    const current = value.mediaUrls ?? {};
    onChange({
      ...value,
      mediaUrls: { ...current, [key]: (current[key] ?? []).filter((u) => u !== url) },
    });
  }

  function removeMedia(key: string, id: string) {
    const existing = value.mediaFiles[key] ?? [];
    const removed = existing.filter((m) => m.id === id);
    revokePendingMedia(removed);
    onChange({
      ...value,
      mediaFiles: {
        ...value.mediaFiles,
        [key]: existing.filter((m) => m.id !== id),
      },
    });
  }

  return (
    <div className="space-y-4">
      {hasPrompt && (
        <div>
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <label className="text-xs text-gray-400">
              {t("prompt")}{required.has("prompt") ? " *" : ""}
            </label>
            {showOptimizer && (
              <div className="flex items-center gap-1.5">
                <select
                  value={optimizeStyle}
                  onChange={(e) => setOptimizeStyle(e.target.value as PromptOptimizeStyle)}
                  disabled={optimizing}
                  className="bg-[#111] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-gray-300 outline-none disabled:opacity-50"
                >
                  {OPTIMIZE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {t(`optimizeStyles.${s}` as "optimizeStyles.default")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={optimizing || !value.prompt.trim()}
                  onClick={() => onOptimizePrompt?.(optimizeStyle)}
                  title={t("optimizeHint")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${a.activeChip}`}
                >
                  <i className={`fas ${optimizing ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"} mr-1`} />
                  {optimizing ? t("optimizing") : t("optimize")}
                </button>
              </div>
            )}
          </div>
          <textarea
            value={value.prompt}
            onChange={(e) => onChange({ ...value, prompt: e.target.value })}
            rows={4}
            placeholder={t("promptPlaceholder")}
            className={`w-full bg-[#111] border border-white/10 rounded-2xl px-4 py-3 text-sm outline-none resize-y ${a.focusBorder}`}
          />
        </div>
      )}

      {hasNegative && (
        <div>
          <label className="text-xs text-gray-400 block mb-1">{t("negativePrompt")}</label>
          <textarea
            value={value.negativePrompt}
            onChange={(e) => onChange({ ...value, negativePrompt: e.target.value })}
            rows={2}
            className="w-full bg-[#111] border border-white/10 rounded-2xl px-4 py-3 text-sm outline-none resize-y"
          />
        </div>
      )}

      {mediaControls.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">{t("referenceMedia")}</div>
          {mediaControls.map((c) => {
            if (c.kind !== "media") return null;
            const items = value.mediaFiles[c.key] ?? [];
            const reusedUrls = value.mediaUrls?.[c.key] ?? [];
            const accept = (c.policy.accept ?? []).join(",");
            const max = c.policy.maxItems ?? (c.multiple ? 10 : 1);
            const used = items.length + reusedUrls.length;
            return (
              <div key={c.key}>
                <label className="text-xs text-gray-500 block mb-1">
                  {c.key}
                  {required.has(c.key) ? " *" : ""}
                  <span className="text-gray-600">
                    {" "}
                    · {t("mediaLimit", { max, accept: c.policy.accept?.join(", ") || c.mediaKind })}
                  </span>
                </label>
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-3">
                  {(value.mediaUrls?.[c.key]?.length ?? 0) > 0 && (
                    // 套用历史任务带回来的图：已经在对象存储里，不必重新上传
                    <div className="flex flex-wrap gap-2 mb-2">
                      {(value.mediaUrls?.[c.key] ?? []).map((url) => (
                        <div key={url} className="relative group">
                          {c.mediaKind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="" className="h-16 w-16 object-cover rounded-lg" />
                          ) : (
                            <div className="h-16 w-24 rounded-lg bg-black/40 text-[10px] text-gray-400 flex items-center justify-center px-1 truncate">
                              {url.split("/").pop()}
                            </div>
                          )}
                          <span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/70 text-center text-[9px] text-gray-300">
                            {t("reusedMedia")}
                          </span>
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100"
                            onClick={() => removeReusedMedia(c.key, url)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {items.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {items.map((m) => (
                        <div key={m.id} className="relative group">
                          {c.mediaKind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.previewUrl}
                              alt=""
                              className="h-16 w-16 object-cover rounded-lg"
                            />
                          ) : (
                            <div className="h-16 w-24 rounded-lg bg-black/40 text-[10px] text-gray-400 flex items-center justify-center px-1 truncate">
                              {m.file.name}
                            </div>
                          )}
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100"
                            onClick={() => removeMedia(c.key, m.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input
                    type="file"
                    accept={accept || undefined}
                    multiple={c.multiple}
                    disabled={used >= max}
                    onChange={(e) => {
                      void handleFiles(c, e.target.files);
                      e.target.value = "";
                    }}
                    className="text-xs text-gray-400 w-full"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ParamControlGrid
        controls={paramControls}
        accent={accent}
        values={value.fields}
        onChange={(key, next) =>
          onChange({ ...value, fields: { ...value.fields, [key]: next } })
        }
      />
    </div>
  );
}

/** 组装非媒体参数；媒体由 upload 后再 merge */
export type PlaythingFormTranslator = (
  key: "chooseField" | "fillField",
  values: { field: string }
) => string;

export function buildFieldParams(
  product: PlaythingProduct,
  form: DynamicFormState,
  translate?: PlaythingFormTranslator
) {
  const controls = getControls(product);
  const required = new Set(product.param_schema?.required ?? []);
  const params: Record<string, unknown> = {};

  if (form.negativePrompt.trim()) {
    params.negative_prompt = form.negativePrompt.trim();
  }

  for (const c of controls) {
    if (c.kind === "media") {
      const items = form.mediaFiles[c.key] ?? [];
      const reused = form.mediaUrls?.[c.key] ?? [];
      if (!items.length && !reused.length && required.has(c.key)) {
        return {
          ok: false as const,
          error: translate ? translate("chooseField", { field: c.key }) : `请选择 ${c.key}`,
        };
      }
      continue;
    }
    const raw = form.fields[c.key];
    if (raw === undefined || raw === "") {
      if (required.has(c.key)) {
        return {
          ok: false as const,
          error: translate ? translate("fillField", { field: c.key }) : `请填写 ${c.key}`,
        };
      }
      continue;
    }
    if (c.kind === "boolean") {
      params[c.key] = raw === "true";
    } else if (c.kind === "number" || (c.kind === "tier" && /^-?\d+(\.\d+)?$/.test(raw))) {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        params[c.key] = c.kind === "number" && c.integer ? Math.round(n) : n;
      } else {
        params[c.key] = raw;
      }
    } else if (c.kind === "tier") {
      const n = Number(raw);
      params[c.key] = Number.isFinite(n) && String(n) === raw ? n : raw;
    } else {
      params[c.key] = raw;
    }
  }

  return {
    ok: true as const,
    prompt: form.prompt,
    params,
    mediaFiles: form.mediaFiles,
  };
}

/** @deprecated 兼容旧名 */
export function buildSubmitPayload(product: PlaythingProduct, form: DynamicFormState) {
  return buildFieldParams(product, form);
}

export function mediaFieldKinds(product: PlaythingProduct) {
  const controls = getControls(product);
  const map: Record<string, { kind: "image" | "video" | "audio"; accept?: string[] }> = {};
  for (const c of controls) {
    if (c.kind === "media") {
      map[c.key] = { kind: c.mediaKind, accept: c.policy.accept };
    }
  }
  return map;
}

export function mergeMediaUrlsIntoParams(
  product: PlaythingProduct,
  baseParams: Record<string, unknown>,
  mediaUrls: Record<string, string[]>
) {
  const controls = getControls(product);
  const params = { ...baseParams };
  for (const c of controls) {
    if (c.kind !== "media") continue;
    const urls = mediaUrls[c.key] ?? [];
    if (!urls.length) continue;
    params[c.key] = c.multiple || urls.length > 1 ? urls : urls[0];
  }
  const props = product.param_schema?.properties ?? {};
  if (!Object.keys(props).length) {
    const imgs = mediaUrls.image ?? [];
    if (imgs.length) params.image = imgs[0];
  }
  return params;
}
