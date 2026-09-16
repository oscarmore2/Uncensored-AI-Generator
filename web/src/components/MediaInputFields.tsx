"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaInputSpec } from "@/lib/client";
import {
  clipboardImageName,
  imageFilesFrom,
  pasteTargetField,
  yieldsToText,
} from "@/lib/clipboard-image";
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

/** ⌘V 还是 Ctrl+V。只能在客户端判，否则首屏水合会对不上 */
function usePasteKeyLabel(): string {
  const [label, setLabel] = useState("Ctrl + V");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) setLabel("⌘ + V");
  }, []);
  return label;
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
  /*
   * 每个图片位把自己的「收下这些文件」登记进来，粘贴时按 pasteTargetField
   * 选中的字段名分发。做成注册表是因为上传逻辑和进度都在 MediaSlot 里，
   * 提到父组件来就得把 items/busy/预览全搬上去。
   */
  const sinks = useRef(new Map<string, (files: File[]) => void>());
  const registerSink = useCallback((field: string, fn: ((files: File[]) => void) | null) => {
    if (fn) sinks.current.set(field, fn);
    else sinks.current.delete(field);
  }, []);

  /* 监听器只挂一次，要读的又是每次渲染都在变的 props——用 ref 转一手 */
  const latest = useRef({ specs, value, disabled });
  useEffect(() => {
    latest.current = { specs, value, disabled };
  });

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const { specs, value, disabled } = latest.current;
      if (disabled) return;
      const images = imageFilesFrom(e.clipboardData);
      if (!images.length) return;
      if (yieldsToText(e.clipboardData, e.target)) return;

      const field = pasteTargetField(specs, value);
      const sink = field ? sinks.current.get(field) : null;
      /* 没有空位就别拦：让默认粘贴照常走，总比「按了没反应」强 */
      if (!sink) return;

      /*
       * **捕获阶段拦下并停止传播**，而不是等冒泡上来。
       * 提示词编辑器（Lexical）在它自己的根节点上挂了 paste 监听，冒泡阶段
       * 轮到我们时它已经处理完了——两处都动手，一次粘贴会既插进编辑器
       * 又进上传位。这里先手拦住，Lexical 根本不会看到这个事件。
       */
      e.preventDefault();
      e.stopPropagation();
      sink(images);
    };
    /*
     * 挂在 document 上：用户按 ⌘V 时焦点多半在提示词编辑器里，甚至不在任何
     * 可聚焦元素上，挂在上传区自己身上根本收不到。
     */
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  const target = pasteTargetField(specs, value);

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
          isPasteTarget={!disabled && spec.field === target}
          registerSink={registerSink}
        />
      ))}
    </div>
  );
}

/** 正在上传、还没拿到 URL 的一件。previewUrl 是本地 objectURL，用完必须 revoke */
type PendingMedia = { id: string; previewUrl: string | null; name: string };

function MediaSlot({
  spec,
  items,
  onChange,
  onError,
  disabled,
  isPasteTarget,
  registerSink,
}: {
  spec: MediaInputSpec;
  items: UploadedMedia[];
  onChange: (items: UploadedMedia[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  isPasteTarget?: boolean;
  registerSink: (field: string, fn: ((files: File[]) => void) | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMedia[]>([]);
  const pasteKey = usePasteKeyLabel();
  const meta = KIND_META[spec.kind];
  /* 在传的也算占了位：单图位粘贴中还显示「点击上传」会让人以为没生效 */
  const full = items.length + pending.length >= spec.maxItems;
  const required = spec.minItems > 0;
  /* 这个位能装多件、且确实装了两件以上，排序才有意义 */
  const sortable = spec.maxItems > 1 && items.length > 1;
  const inputRef = useRef<HTMLInputElement>(null);

  /* 本地预览的 objectURL 全记在这儿，卸载时统一释放，别留内存 */
  const previews = useRef(new Set<string>());
  const dropPreview = useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    previews.current.delete(url);
  }, []);
  useEffect(() => {
    const held = previews.current;
    return () => {
      for (const url of held) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  /*
   * 同一时刻只许一批在传。
   *
   * upload 的闭包里捏着当时那份 items，收尾时做 [...items, ...added]——
   * 两批并发的话，后收尾的那批会拿着过期的 items 把先收尾的成果覆盖掉。
   * 点击那条路本来就被 disabled={busy} 挡住了，粘贴这条得自己挡。
   */
  const busyRef = useRef(false);
  const upload = useCallback(
    async (files: File[], fromClipboard = false) => {
      if (busyRef.current) return;
      const room = spec.maxItems - items.length - pending.length;
      if (room <= 0) return;
      const batch = files.slice(0, room);
      if (!batch.length) return;

      /*
       * **先出缩略图再上传。** 上传一张手机照片走几秒很正常，这段时间里
       * 没有任何反馈的话，用户只会以为粘贴没生效然后再按一次。
       * 图片和视频能直接用 objectURL 预览，音频没有可看的画面，留空走图标。
       */
      const queued: PendingMedia[] = batch.map((file, i) => {
        let previewUrl: string | null = null;
        if (spec.kind !== "audio") {
          previewUrl = URL.createObjectURL(file);
          previews.current.add(previewUrl);
        }
        const name = fromClipboard ? clipboardImageName(file, i) : file.name;
        return { id: newMediaId(), previewUrl, name };
      });
      setPending((p) => [...p, ...queued]);
      busyRef.current = true;
      setBusy(true);

      const added: UploadedMedia[] = [];
      let duplicates = 0;
      try {
        for (let i = 0; i < batch.length; i++) {
          const file = batch[i];
          const slot = queued[i];
          const form = new FormData();
          form.append("file", file);
          form.append("kind", spec.kind);
          form.append("field", spec.field);
          // 尺寸/时长由服务端按策略校验，客户端先量一遍能给出更快的失败提示
          const dims = await readMeta(file, spec.kind).catch(() => null);
          if (dims?.width) form.append("width", String(dims.width));
          if (dims?.height) form.append("height", String(dims.height));
          if (dims?.duration) form.append("duration_sec", String(dims.duration));

          try {
            const resp = await fetch("/api/uploads", { method: "POST", body: form });
            const data = (await resp.json().catch(() => null)) as
              | { url?: string; error?: string }
              | null;
            if (!resp.ok || !data?.url) {
              throw new Error(data?.error || `${slot.name} 上传失败`);
            }
            /*
             * 同一张图不进两次。上传是内容寻址的（uploads/sha256/…），
             * 同样的字节必然拿回同一个 URL——所以比对 URL 就等于比对内容，
             * 不用在前端自己算哈希。
             */
            if (items.some((it) => it.url === data.url) || added.some((a) => a.url === data.url)) {
              duplicates += 1;
              continue;
            }
            added.push({ id: slot.id, url: data.url, name: slot.name, kind: spec.kind });
          } finally {
            // 这一件有结论了就撤掉它的占位，别等整批跑完
            setPending((p) => p.filter((q) => q.id !== slot.id));
            dropPreview(slot.previewUrl);
          }
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        // 已经传成功的那几个仍然留下，重传只补缺的那些
        if (added.length) onChange([...items, ...added]);
        // 整批都是重复时也得说一声，否则就是「按了没反应」
        if (!added.length && duplicates) onError("这张图已经在列表里了");
        setPending((p) => p.filter((q) => !queued.some((x) => x.id === q.id)));
        for (const q of queued) dropPreview(q.previewUrl);
        busyRef.current = false;
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [dropPreview, items, onChange, onError, pending.length, spec.field, spec.kind, spec.maxItems]
  );

  /* 只有当前的粘贴目标位才登记，省得多个位同时抢同一次粘贴 */
  useEffect(() => {
    if (!isPasteTarget) return;
    registerSink(spec.field, (files) => void upload(files, true));
    return () => registerSink(spec.field, null);
  }, [isPasteTarget, registerSink, spec.field, upload]);

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

      {(items.length > 0 || pending.length > 0) && (
        <>
          {items.length > 0 && (
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
          )}
          {pending.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${items.length ? "-mt-1 mb-3" : "mb-3"}`}>
              {pending.map((p) => (
                <PendingChip key={p.id} item={p} kind={spec.kind} />
              ))}
            </div>
          )}
          {sortable && (
            <p className="mb-3 -mt-1 text-[11px] text-ink-subtle">
              <i className="fas fa-arrows-up-down-left-right mr-1" />
              拖动可调整顺序（触屏长按后拖动）。序号既是提交给模型的次序，
              也是 @ 引用的编号——不改提示词，光换顺序就能换引用
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
              if (e.target.files?.length) void upload(Array.from(e.target.files));
            }}
          />
          <i className={`fas ${busy ? "fa-spinner fa-spin" : meta.icon} mb-2 text-2xl text-ink-subtle`} />
          <p className="text-sm text-ink-muted">
            {busy ? "上传中…" : `点击上传${meta.label}`}
            {spec.maxItems > 1 && !busy && <span className="text-ink-subtle">（可多选）</span>}
          </p>
          {isPasteTarget && !busy && (
            /* 贴到哪个位上得看得见，否则多个图片位时用户只能猜 */
            <p className="mt-1 text-[11px] text-ink-subtle">
              或按 <kbd className="rounded border border-line px-1 font-sans">{pasteKey}</kbd> 粘贴剪贴板里的图片
            </p>
          )}
        </label>
      )}
    </div>
  );
}

/** 已经在传、还没拿到 URL 的一件：缩略图先出来，上面盖一层转圈 */
function PendingChip({ item, kind }: { item: PendingMedia; kind: MediaInputSpec["kind"] }) {
  return (
    <div
      className="relative h-24 w-24 overflow-hidden rounded-2xl border border-line bg-stage"
      title={item.name}
    >
      {item.previewUrl && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
      )}
      {item.previewUrl && kind === "video" && (
        <video src={item.previewUrl} className="h-full w-full object-cover" preload="metadata" muted playsInline />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
        <i className="fas fa-spinner fa-spin text-lg text-white" />
      </div>
      <span className="sr-only">{item.name} 上传中</span>
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
