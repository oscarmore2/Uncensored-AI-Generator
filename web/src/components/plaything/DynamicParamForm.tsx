"use client";

import { useCallback, useMemo, useState } from "react";
import type { ParamSchemaProp, PlaythingProduct } from "./types";

const MEDIA_KEYS = new Set([
  "image",
  "image_url",
  "images",
  "mask",
  "video",
  "video_url",
  "audio",
  "audio_url",
]);

const PROMPT_KEYS = new Set(["prompt", "negative_prompt"]);

function isMediaProp(key: string, meta: ParamSchemaProp): boolean {
  if (MEDIA_KEYS.has(key)) return true;
  if (meta.format === "uri" && /image|video|mask|audio/i.test(key)) return true;
  return false;
}

export type DynamicFormState = {
  prompt: string;
  negativePrompt: string;
  extra: Record<string, string>;
  /** 单图/视频 data URL（主参考） */
  mediaFiles: Record<string, string | null>;
};

export function defaultsFromProduct(product: PlaythingProduct | null): DynamicFormState {
  const extra: Record<string, string> = {};
  const mediaFiles: Record<string, string | null> = {};
  let prompt = "";
  let negativePrompt = "";
  const props = product?.param_schema?.properties ?? {};
  for (const [k, v] of Object.entries(props)) {
    if (PROMPT_KEYS.has(k)) {
      if (k === "prompt" && v.default != null) prompt = String(v.default);
      if (k === "negative_prompt" && v.default != null) negativePrompt = String(v.default);
      continue;
    }
    if (isMediaProp(k, v)) {
      mediaFiles[k] = null;
      continue;
    }
    if (v.default !== undefined && v.default !== null) {
      extra[k] = String(v.default);
    }
  }
  return { prompt, negativePrompt, extra, mediaFiles };
}

export function DynamicParamForm({
  product,
  value,
  onChange,
}: {
  product: PlaythingProduct;
  value: DynamicFormState;
  onChange: (next: DynamicFormState) => void;
}) {
  const props = product.param_schema?.properties ?? {};
  const required = new Set(product.param_schema?.required ?? []);

  const hasPrompt = "prompt" in props || Object.keys(props).length === 0;
  const hasNegative = "negative_prompt" in props;

  const mediaFields = useMemo(
    () => Object.entries(props).filter(([k, m]) => isMediaProp(k, m)),
    [props]
  );

  const extraFields = useMemo(
    () =>
      Object.entries(props).filter(
        ([k, m]) => !PROMPT_KEYS.has(k) && !isMediaProp(k, m)
      ),
    [props]
  );

  const readFile = useCallback((file: File, key: string) => {
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...value,
        mediaFiles: { ...value.mediaFiles, [key]: String(reader.result) },
      });
    };
    reader.readAsDataURL(file);
  }, [onChange, value]);

  // 无 schema 时仍展示提示词 + 可选参考图
  const showFallbackImage =
    mediaFields.length === 0 &&
    (required.has("image") ||
      /i2v|i2i|image|face|breast|infinite|avatar/i.test(product.model_id + product.type));

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

      {(mediaFields.length > 0 || showFallbackImage) && (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">参考媒体</div>
          {(mediaFields.length > 0
            ? mediaFields
            : ([["image", { description: "参考图" }]] as [string, ParamSchemaProp][])
          ).map(([key, meta]) => {
            const accept = /video/i.test(key) ? "video/*" : /audio/i.test(key) ? "audio/*" : "image/*";
            const data = value.mediaFiles[key];
            return (
              <MediaUploadSlot
                key={key}
                label={`${key}${required.has(key) ? " *" : ""}${
                  meta.description ? ` · ${meta.description.slice(0, 48)}` : ""
                }`}
                accept={accept}
                preview={data}
                onFile={(f) => {
                  if (!f) {
                    onChange({
                      ...value,
                      mediaFiles: { ...value.mediaFiles, [key]: null },
                    });
                    return;
                  }
                  readFile(f, key);
                }}
              />
            );
          })}
        </div>
      )}

      {extraFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {extraFields.slice(0, 12).map(([key, meta]) => (
            <div key={key}>
              <label className="text-xs text-gray-400 block mb-1">
                {key}
                {required.has(key) ? " *" : ""}
                {meta.description ? (
                  <span className="text-gray-600"> · {meta.description.slice(0, 36)}</span>
                ) : null}
              </label>
              {meta.enum ? (
                <select
                  value={value.extra[key] ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      extra: { ...value.extra, [key]: e.target.value },
                    })
                  }
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                >
                  {meta.enum.map((opt) => (
                    <option key={String(opt)} value={String(opt)}>
                      {String(opt)}
                    </option>
                  ))}
                </select>
              ) : meta.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={value.extra[key] === "true"}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        extra: { ...value.extra, [key]: e.target.checked ? "true" : "false" },
                      })
                    }
                  />
                  启用
                </label>
              ) : (
                <input
                  type={meta.type === "integer" || meta.type === "number" ? "number" : "text"}
                  value={value.extra[key] ?? ""}
                  min={meta.minimum}
                  max={meta.maximum}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      extra: { ...value.extra, [key]: e.target.value },
                    })
                  }
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaUploadSlot({
  label,
  accept,
  preview,
  onFile,
}: {
  label: string;
  accept: string;
  preview: string | null | undefined;
  onFile: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          onFile(f);
        }}
        className={`rounded-2xl border border-dashed p-4 text-center transition-colors ${
          dragging ? "border-rose-500/50 bg-rose-500/10" : "border-white/15 bg-white/[0.02]"
        }`}
      >
        {preview && accept.startsWith("image") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="mx-auto max-h-28 rounded-xl mb-2" />
        ) : preview ? (
          <p className="text-xs text-emerald-300 mb-2">已选择文件</p>
        ) : (
          <p className="text-xs text-gray-500 mb-2">拖拽到此处，或点击选择</p>
        )}
        <input
          type="file"
          accept={accept}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="text-xs text-gray-400 w-full"
        />
        {preview && (
          <button
            type="button"
            className="mt-2 text-[11px] text-gray-400 hover:text-white"
            onClick={() => onFile(null)}
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}

/** 组装提交用 params + image_base64 */
export function buildSubmitPayload(product: PlaythingProduct, form: DynamicFormState) {
  const props = product.param_schema?.properties ?? {};
  const params: Record<string, unknown> = {};

  if (form.negativePrompt.trim() && ("negative_prompt" in props || form.negativePrompt)) {
    params.negative_prompt = form.negativePrompt.trim();
  }

  for (const [k, v] of Object.entries(form.extra)) {
    if (v === "") continue;
    const meta = props[k];
    if (meta?.type === "integer" || meta?.type === "number") {
      const n = Number(v);
      if (!Number.isNaN(n)) params[k] = n;
    } else if (meta?.type === "boolean") {
      params[k] = v === "true" || v === "1";
    } else {
      params[k] = v;
    }
  }

  let image_base64: string | null = null;
  for (const [k, data] of Object.entries(form.mediaFiles)) {
    if (!data) continue;
    if (k === "image" || k === "image_url" || k === "mask" || k === "images") {
      image_base64 = image_base64 ?? data;
      if (k !== "image_url") params[k] = data;
    } else {
      params[k] = data;
    }
  }

  const required = product.param_schema?.required ?? [];
  const needsMedia =
    required.some((k) => MEDIA_KEYS.has(k)) ||
    Object.keys(form.mediaFiles).some((k) => required.includes(k)) ||
    (/i2v|i2i|image|face|breast|infinite|avatar/i.test(product.model_id + product.type) &&
      mediaFieldsHint(product));

  return {
    prompt: form.prompt,
    params,
    image_base64,
    needsMedia: Boolean(needsMedia && !image_base64 && !Object.values(form.mediaFiles).some(Boolean)),
  };
}

function mediaFieldsHint(product: PlaythingProduct): boolean {
  const props = product.param_schema?.properties ?? {};
  return Object.keys(props).some((k) => MEDIA_KEYS.has(k)) || Object.keys(props).length === 0;
}
