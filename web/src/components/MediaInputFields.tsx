"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaInputSpec } from "@/lib/client";
import { Reorderable } from "./Reorderable";

/**
 * 创作中心的输入媒体上传区。
 *
 * 有几个位、每个位收什么类型、最多几个，全部由绑定模型的 schema 决定：
 * 对口型是「视频 + 音频」、换脸是「视频 + 人脸图」、
 * reference-to-video 各家差得更远：vidu 收 4 张、seedance 收 9 张、
 * nano-banana-2/edit 收 14 张——写死在模式上表达不了这些差异。
 *
 * 上传立即发生（拿到 URL 才算数），提交时只带 URL：
 * 视频动辄几十 MB，塞进 JSON body 既超限也会把二进制压进任务参数。
 */

export type UploadedMedia = {
  /**
   * 仅存在于前端，不提交。用来在拖动排序时稳定认元素。
   *
   * 不能拿 url 当 key：上传做了内容寻址去重，同一个文件传两次会拿到同一个 URL；
   * 也不能用下标，排序时下标本身就在变，React 会按位置复用 DOM，
   * 正在拖的那件就会“换了芯子”。
   */
  id: string;
  url: string;
  name: string;
  kind: MediaInputSpec["kind"];
};

let mediaSeq = 0;

export function newMediaId(): string {
  // randomUUID 只在安全上下文里有；退回自增序号 + 时间戳，
  // 后者是为了让刷新后新建的 id 不会撞上草稿里存着的老 id
  return globalThis.crypto?.randomUUID?.() ?? `m${++mediaSeq}-${Date.now().toString(36)}`;
}

/**
 * 从草稿、套用这类外部来源恢复回来的媒体可能没有 id
 * （草稿是改动之前存的），在入口处补齐，别让缺 id 漏进 state。
 */
export function withMediaIds(
  value: Record<string, UploadedMedia[]> | null | undefined
): Record<string, UploadedMedia[]> {
  const out: Record<string, UploadedMedia[]> = {};
  for (const [field, items] of Object.entries(value ?? {})) {
    if (!Array.isArray(items)) continue;
    out[field] = items.map((it) => (it?.id ? it : { ...it, id: newMediaId() }));
  }
  return out;
}

/**
 * 字段名 → 面向用户的名字。
 * 这份表覆盖了两家上游全部模型里真正会出现的媒体字段名
 * （扫过一遍 schema 得来的，不是猜的）；漏网的退回字段名本身，
 * 难看但不会是空白。
 */
const FIELD_LABELS: Record<string, string> = {
  // 图
  image: "参考图",
  Image: "参考图",
  images: "参考图",
  image_url: "参考图",
  image_urls: "参考图",
  input_image: "参考图",
  reference_image: "参考图",
  reference_images: "参考图",
  reference_image_urls: "参考图",
  references: "参考图",
  refers: "参考图",
  sref: "风格参考图",
  first_frame_image: "首帧图",
  start_image: "起始帧",
  end_image: "尾帧图",
  last_image: "尾帧图",
  mask_image: "蒙版图",
  face_image: "人脸图",
  // 视频
  video: "输入视频",
  videos: "输入视频",
  video_url: "输入视频",
  video_clips: "输入视频",
  source_video: "输入视频",
  input_video: "输入视频",
  reference_videos: "参考视频",
  // 音频
  audio: "音频",
  audios: "音频",
  audio_url: "音频",
  reference_audios: "参考音频",
  voice: "音频",
};

const KIND_META: Record<MediaInputSpec["kind"], { icon: string; accept: string; label: string }> = {
  image: { icon: "fa-image", accept: "image/*", label: "图片" },
  video: { icon: "fa-film", accept: "video/*", label: "视频" },
  audio: { icon: "fa-music", accept: "audio/*", label: "音频" },
};

function labelOf(spec: MediaInputSpec): string {
  return FIELD_LABELS[spec.field] ?? spec.field;
}

export function MediaInputFields({
  specs,
  value,
  onChange,
  onError,
  disabled,
}: {
  specs: MediaInputSpec[];
  /** 字段名 → 已上传的媒体 */
  value: Record<string, UploadedMedia[]>;
  onChange: (next: Record<string, UploadedMedia[]>) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  if (!specs.length) return null;
  return (
    <div className="mb-5 space-y-4">
      {specs.map((spec) => (
        <MediaSlot
          key={spec.field}
          spec={spec}
          items={value[spec.field] ?? []}
          onChange={(items) => onChange({ ...value, [spec.field]: items })}
          onError={onError}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function MediaSlot({
  spec,
  items,
  onChange,
  onError,
  disabled,
}: {
  spec: MediaInputSpec;
  items: UploadedMedia[];
  onChange: (items: UploadedMedia[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const meta = KIND_META[spec.kind];
  const full = items.length >= spec.maxItems;
  const required = spec.minItems > 0;
  /* 这个位能装多件、且确实装了两件以上，排序才有意义 */
  const sortable = spec.maxItems > 1 && items.length > 1;
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: FileList) => {
      const room = spec.maxItems - items.length;
      if (room <= 0) return;
      setBusy(true);
      const added: UploadedMedia[] = [];
      try {
        for (const file of Array.from(files).slice(0, room)) {
          const form = new FormData();
          form.append("file", file);
          form.append("kind", spec.kind);
          form.append("field", spec.field);
          // 尺寸/时长由服务端按策略校验，客户端先量一遍能给出更快的失败提示
          const dims = await readMeta(file, spec.kind).catch(() => null);
          if (dims?.width) form.append("width", String(dims.width));
          if (dims?.height) form.append("height", String(dims.height));
          if (dims?.duration) form.append("duration_sec", String(dims.duration));

          const resp = await fetch("/api/uploads", { method: "POST", body: form });
          const data = (await resp.json().catch(() => null)) as
            | { url?: string; error?: string }
            | null;
          if (!resp.ok || !data?.url) {
            throw new Error(data?.error || `${file.name} 上传失败`);
          }
          added.push({ id: newMediaId(), url: data.url, name: file.name, kind: spec.kind });
        }
        if (added.length) onChange([...items, ...added]);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
        // 已经传成功的那几个仍然留下，重传只补缺的那些
        if (added.length) onChange([...items, ...added]);
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [items, onChange, onError, spec.field, spec.kind, spec.maxItems]
  );

  return (
    <div>
      <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-muted">
        <i className={`fas ${meta.icon} text-ink-subtle`} />
        {labelOf(spec)}
        {required ? (
          <span className="text-orange-700">*</span>
        ) : (
          <span className="text-[11px] font-normal text-ink-subtle">选填</span>
        )}
        {spec.maxItems > 1 && (
          <span className="text-[11px] font-normal text-ink-subtle">
            最多 {spec.maxItems} 个 · 已选 {items.length}
          </span>
        )}
      </label>

      {spec.description && (
        <p className="mb-2 line-clamp-2 text-[11px] text-ink-subtle">{spec.description}</p>
      )}

      {items.length > 0 && (
        <>
          <Reorderable
            items={items}
            getKey={(item) => item.id}
            onReorder={onChange}
            /* 只有一件时没什么可排的，别给出 grab 光标这种假暗示 */
            disabled={disabled || !sortable}
            describeItem={(item) => item.name}
            className="mb-3 flex flex-wrap gap-2"
            itemClassName="relative h-24 w-24 overflow-hidden rounded-2xl border border-line bg-stage"
          >
            {(item, { index }) => (
              <>
                <MediaChip item={item} />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(items.filter((it) => it.id !== item.id))}
                  aria-label="移除"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-black/85"
                >
                  <i className="fas fa-times" />
                </button>
                {spec.maxItems > 1 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/70 px-1.5 text-[10px] text-white">
                    {index + 1}
                  </span>
                )}
              </>
            )}
          </Reorderable>
          {sortable && (
            <p className="mb-3 -mt-1 text-[11px] text-ink-subtle">
              <i className="fas fa-arrows-up-down-left-right mr-1" />
              拖动可调整顺序（触屏长按后拖动）；序号就是提交给模型的次序
            </p>
          )}
        </>
      )}

      {!full && (
        <label
          className={`block cursor-pointer rounded-3xl border-2 border-dashed border-line-strong p-6 text-center transition-colors hover:border-orange-500/40 ${
            disabled || busy ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={meta.accept}
            multiple={spec.maxItems > 1}
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
            }}
          />
          <i className={`fas ${busy ? "fa-spinner fa-spin" : meta.icon} mb-2 text-2xl text-ink-subtle`} />
          <p className="text-sm text-ink-muted">
            {busy ? "上传中…" : `点击上传${meta.label}`}
            {spec.maxItems > 1 && !busy && <span className="text-ink-subtle">（可多选）</span>}
          </p>
        </label>
      )}
    </div>
  );
}

function MediaChip({ item }: { item: UploadedMedia }) {
  if (item.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt={item.name} className="h-full w-full object-cover" />;
  }
  if (item.kind === "video") {
    return (
      <video src={`${item.url}#t=0.1`} className="h-full w-full object-cover" preload="metadata" muted playsInline />
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-subtle">
      <i className="fas fa-music text-xl" />
      <span className="w-full truncate px-1 text-center text-[9px]">{item.name}</span>
    </div>
  );
}

/** 读取本地文件的尺寸/时长，纯为了让超限能在上传前就报出来 */
function readMeta(
  file: File,
  kind: MediaInputSpec["kind"]
): Promise<{ width?: number; height?: number; duration?: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const done = (v: { width?: number; height?: number; duration?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读取媒体信息失败"));
    };

    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = fail;
      img.src = url;
      return;
    }
    if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
      v.onerror = fail;
      v.src = url;
      return;
    }
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => done({ duration: a.duration });
    a.onerror = fail;
    a.src = url;
  });
}

/** 提交前把上传结果压成 { 字段名: [URL] } */
export function toMediaPayload(
  value: Record<string, UploadedMedia[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, items] of Object.entries(value)) {
    if (items.length) out[field] = items.map((i) => i.url);
  }
  return out;
}

/** 必填的位是不是都填了 */
export function missingRequiredMedia(
  specs: MediaInputSpec[],
  value: Record<string, UploadedMedia[]>
): MediaInputSpec | null {
  for (const spec of specs) {
    if (spec.minItems > 0 && (value[spec.field]?.length ?? 0) < spec.minItems) return spec;
  }
  return null;
}

/** 换模型后把已上传但新模型不认的字段丢掉，避免提交时被上游拒绝 */
export function pruneMediaToSpecs(
  specs: MediaInputSpec[],
  value: Record<string, UploadedMedia[]>
): Record<string, UploadedMedia[]> {
  const allowed = new Map(specs.map((s) => [s.field, s]));
  const out: Record<string, UploadedMedia[]> = {};
  for (const [field, items] of Object.entries(value)) {
    const spec = allowed.get(field);
    if (!spec || !items.length) continue;
    out[field] = items.slice(0, spec.maxItems);
  }
  return out;
}

/** 供调用方在卸载时释放本地预览（当前实现不留 objectURL，保留钩子以防以后加） */
export function useRevokeOnUnmount(_value: Record<string, UploadedMedia[]>) {
  useEffect(() => () => undefined, []);
}
