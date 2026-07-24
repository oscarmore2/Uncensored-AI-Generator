"use client";

import { useMemo } from "react";
import { resolveParamControls, type ResolvedControl } from "@/lib/plaything-param-policy";
import {
  createPendingMedia,
  revokePendingMedia,
  type PendingMedia,
} from "@/lib/plaything-upload-client";
import type { PlaythingProduct } from "./types";

export type DynamicFormState = {
  prompt: string;
  negativePrompt: string;
  /** 非媒体字段（档位/数字/文本等） */
  fields: Record<string, string>;
  /** 媒体字段 → 本地待上传文件（点击生成后再上传） */
  mediaFiles: Record<string, PendingMedia[]>;
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
    } else if (c.kind === "number" || c.kind === "text") {
      fields[c.key] = c.defaultValue;
    }
  }

  return { prompt, negativePrompt, fields, mediaFiles };
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

export function DynamicParamForm({
  product,
  value,
  onChange,
  onError,
}: {
  product: PlaythingProduct;
  value: DynamicFormState;
  onChange: (next: DynamicFormState) => void;
  onError?: (msg: string) => void;
}) {
  const controls = useMemo(() => getControls(product), [product]);
  const props = product.param_schema?.properties ?? {};
  const required = new Set(product.param_schema?.required ?? []);
  const hasPrompt = "prompt" in props || Object.keys(props).length === 0;
  const hasNegative = "negative_prompt" in props;

  const mediaControls = controls.filter((c) => c.kind === "media");
  const otherControls = controls.filter((c) => c.kind !== "media");

  // 组件卸载时不 revoke（由 page 在切模型时 release），避免误清

  async function handleFiles(c: Extract<ResolvedControl, { kind: "media" }>, files: FileList | null) {
    if (!files?.length) return;
    const max = c.policy.maxItems ?? (c.multiple ? 10 : 1);
    const existing = value.mediaFiles[c.key] ?? [];
    const room = Math.max(0, max - existing.length);
    if (room <= 0) {
      onError?.(`最多选择 ${max} 个文件`);
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
      onError?.(e instanceof Error ? e.message : "文件校验失败");
    }
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
          <label className="text-xs text-gray-400 block mb-1">
            提示词{required.has("prompt") ? " *" : ""}
          </label>
          <textarea
            value={value.prompt}
            onChange={(e) => onChange({ ...value, prompt: e.target.value })}
            rows={4}
            placeholder="描述你想生成的内容…"
            className="w-full bg-[#111] border border-white/10 rounded-2xl px-4 py-3 text-sm outline-none resize-y focus:border-rose-500/40"
          />
        </div>
      )}

      {hasNegative && (
        <div>
          <label className="text-xs text-gray-400 block mb-1">负面提示词</label>
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
          <div className="text-xs text-gray-400">参考媒体（生成时上传）</div>
          {mediaControls.map((c) => {
            if (c.kind !== "media") return null;
            const items = value.mediaFiles[c.key] ?? [];
            const accept = (c.policy.accept ?? []).join(",");
            const max = c.policy.maxItems ?? (c.multiple ? 10 : 1);
            return (
              <div key={c.key}>
                <label className="text-xs text-gray-500 block mb-1">
                  {c.key}
                  {required.has(c.key) ? " *" : ""}
                  <span className="text-gray-600">
                    {" "}
                    · 最多 {max} · {c.policy.accept?.join(", ") || c.mediaKind}
                  </span>
                </label>
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-3">
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
                    disabled={items.length >= max}
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

      {otherControls.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {otherControls.slice(0, 16).map((c) => {
            const label = `${c.key}${required.has(c.key) ? " *" : ""}`;
            if (c.kind === "tier" || c.kind === "enum") {
              return (
                <div key={c.key}>
                  <label className="text-xs text-gray-400 block mb-1">{label}</label>
                  <select
                    value={value.fields[c.key] ?? c.defaultValue}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        fields: { ...value.fields, [c.key]: e.target.value },
                      })
                    }
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  >
                    {c.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            if (c.kind === "boolean") {
              return (
                <label key={c.key} className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={value.fields[c.key] === "true"}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        fields: {
                          ...value.fields,
                          [c.key]: e.target.checked ? "true" : "false",
                        },
                      })
                    }
                  />
                  {label}
                </label>
              );
            }
            if (c.kind === "number") {
              return (
                <div key={c.key}>
                  <label className="text-xs text-gray-400 block mb-1">{label}</label>
                  <input
                    type="number"
                    value={value.fields[c.key] ?? ""}
                    min={c.min}
                    max={c.max}
                    step={c.integer ? 1 : "any"}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        fields: { ...value.fields, [c.key]: e.target.value },
                      })
                    }
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              );
            }
            return (
              <div key={c.key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input
                  type="text"
                  value={value.fields[c.key] ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      fields: { ...value.fields, [c.key]: e.target.value },
                    })
                  }
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 组装非媒体参数；媒体由 upload 后再 merge */
export function buildFieldParams(product: PlaythingProduct, form: DynamicFormState) {
  const controls = getControls(product);
  const required = new Set(product.param_schema?.required ?? []);
  const params: Record<string, unknown> = {};

  if (form.negativePrompt.trim()) {
    params.negative_prompt = form.negativePrompt.trim();
  }

  for (const c of controls) {
    if (c.kind === "media") {
      const items = form.mediaFiles[c.key] ?? [];
      if (!items.length && required.has(c.key)) {
        return { ok: false as const, error: `请选择 ${c.key}` };
      }
      continue;
    }
    const raw = form.fields[c.key];
    if (raw === undefined || raw === "") {
      if (required.has(c.key)) {
        return { ok: false as const, error: `请填写 ${c.key}` };
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
