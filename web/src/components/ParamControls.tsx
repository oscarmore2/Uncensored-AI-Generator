"use client";

import {
  CHIP_THRESHOLD,
  DEFAULT_SIZE_RANGE,
  SIZE_ASPECT_PRESETS,
  SIZE_KEEP_ORIGINAL,
  accentOf,
  formatSizeValue,
  parseSizeValue,
  sizeForRatio,
  type AccentTone,
  type ParamControl,
} from "@/lib/param-controls";

/**
 * 自适应参数控件：按上游模型 schema 归一出的控件描述渲染，
 * 生成端与玩物专区共用同一套渲染逻辑，换绑模型时表单自动切换形态。
 *
 * 形态选择：
 *   枚举 ≤5 项 → 横向 chip（一眼可见全部选项）
 *   枚举 >5 项 → 下拉
 *   带上下限的数值 → 滑块 + 数值显示
 *   无上下限的数值 → 数字输入框
 *   布尔 → 开关
 *   字符串 → 文本框
 *
 * 主体色由 accent 决定：普通档 rose、Spicy 档 fuchsia、玩物专区 sky。
 */

export function ParamControlField({
  control,
  value,
  onChange,
  accent = "rose",
  label,
  disabled,
}: {
  control: ParamControl;
  value: string;
  onChange: (next: string) => void;
  accent?: AccentTone;
  /** 展示名；不传则用 key */
  label?: string;
  disabled?: boolean;
}) {
  const a = accentOf(accent);
  const title = `${label ?? control.key}${control.required ? " *" : ""}`;
  const inputClass = `w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none transition-colors ${a.focusBorder} disabled:opacity-50`;

  if (control.kind === "enum") {
    if (control.options.length === 0) return null;

    if (control.options.length <= CHIP_THRESHOLD) {
      return (
        <div>
          <label className="text-xs text-ink-muted block mb-1.5">{title}</label>
          <div className="flex flex-wrap gap-1.5">
            {control.options.map((o) => {
              const active = value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(o.value)}
                  className={`px-3 py-1.5 rounded-xl border text-xs transition-colors disabled:opacity-50 ${
                    active ? a.activeChip : "bg-black/[0.03] border-line text-ink-muted hover:border-line-strong"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className="text-xs text-ink-muted block mb-1">{title}</label>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          {control.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (control.kind === "boolean") {
    const on = value === "true";
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-xs text-ink-muted">{title}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(on ? "false" : "true")}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
            on ? a.switchOn : "bg-black/[0.08]"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
              on ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
    );
  }

  if (control.kind === "number") {
    const hasRange =
      typeof control.min === "number" &&
      typeof control.max === "number" &&
      control.max > control.min;

    if (hasRange) {
      const step = control.integer ? 1 : (control.max! - control.min!) / 100;
      return (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-ink-muted">{title}</label>
            <span className={`text-xs font-mono ${a.text}`}>{value || control.min}</span>
          </div>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={step}
            value={value === "" ? String(control.min) : value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full ${a.accent} disabled:opacity-50`}
          />
          <div className="flex justify-between text-[10px] text-ink-subtle mt-0.5">
            <span>{control.min}</span>
            <span>{control.max}</span>
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className="text-xs text-ink-muted block mb-1">{title}</label>
        <input
          type="number"
          value={value}
          min={control.min}
          max={control.max}
          step={control.integer ? 1 : "any"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      </div>
    );
  }

  if (control.kind === "size") {
    return (
      <SizeControlField control={control} value={value} onChange={onChange} accent={accent} title={title} disabled={disabled} />
    );
  }

  return (
    <div>
      <label className="text-xs text-ink-muted block mb-1">{title}</label>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

/**
 * 宽高像素编辑器（如 "1024*1536" 这类组合尺寸参数）。
 *
 * 默认「保持原图尺寸」——不勾开自定义时该字段值为空字符串，
 * 站内既有的「空值 = 不发送该字段」约定会自动把它从请求里剔除，
 * 图生图/图片编辑这类以输入图尺寸为准的模式不会被强行拉伸/缩小。
 * 只有用户主动关掉「保持原图尺寸」，才会按滑块拼出 WIDTH*HEIGHT 发给上游。
 */
function SizeControlField({
  control,
  value,
  onChange,
  accent,
  title,
  disabled,
}: {
  control: ParamControl;
  value: string;
  onChange: (next: string) => void;
  accent: AccentTone;
  title: string;
  disabled?: boolean;
}) {
  const a = accentOf(accent);
  const min = control.min ?? DEFAULT_SIZE_RANGE.min;
  const max = control.max ?? DEFAULT_SIZE_RANGE.max;
  const keepOriginal = value === SIZE_KEEP_ORIGINAL;
  const parsed = parseSizeValue(value);
  const width = parsed?.width ?? Math.min(max, Math.max(min, 1024));
  const height = parsed?.height ?? Math.min(max, Math.max(min, 1024));

  function setSize(w: number, h: number) {
    const clampedW = Math.min(max, Math.max(min, Math.round(w)));
    const clampedH = Math.min(max, Math.max(min, Math.round(h)));
    onChange(formatSizeValue(clampedW, clampedH));
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-ink-muted">{title}</label>
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={keepOriginal}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? SIZE_KEEP_ORIGINAL : formatSizeValue(width, height))}
            className={a.accent}
          />
          保持原图尺寸
        </label>
      </div>

      {!keepOriginal && (
        <div className="rounded-2xl border border-line bg-black/[0.03] p-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {SIZE_ASPECT_PRESETS.map((p) => {
              const target = sizeForRatio(p.w, p.h, min, max);
              const active = target.width === width && target.height === height;
              return (
                <button
                  key={p.ratio}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSize(target.width, target.height)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors disabled:opacity-50 ${
                    active ? a.activeChip : "bg-black/[0.03] border-line text-ink-muted hover:border-line-strong"
                  }`}
                >
                  {p.ratio}
                </button>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-ink-subtle">宽度 width</span>
              <span className={`text-[11px] font-mono ${a.text}`}>{width}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={width}
              disabled={disabled}
              onChange={(e) => setSize(Number(e.target.value), height)}
              className={`w-full ${a.accent} disabled:opacity-50`}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-ink-subtle">高度 height</span>
              <span className={`text-[11px] font-mono ${a.text}`}>{height}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={height}
              disabled={disabled}
              onChange={(e) => setSize(width, Number(e.target.value))}
              className={`w-full ${a.accent} disabled:opacity-50`}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-ink-subtle">
            <span>
              {width} × {height} px
            </span>
            <span>
              Range: {min} – {max}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一组控件的栅格容器；布尔单独占一行以免开关被挤扁 */
export function ParamControlGrid({
  controls,
  values,
  onChange,
  accent = "rose",
  labelOf,
  disabled,
}: {
  controls: ParamControl[];
  values: Record<string, string>;
  onChange: (key: string, next: string) => void;
  accent?: AccentTone;
  labelOf?: (control: ParamControl) => string;
  disabled?: boolean;
}) {
  if (!controls.length) return null;
  const toggles = controls.filter((c) => c.kind === "boolean");
  const rest = controls.filter((c) => c.kind !== "boolean");

  return (
    <div className="space-y-3">
      {rest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rest.map((c) => (
            <ParamControlField
              key={c.key}
              control={c}
              accent={accent}
              disabled={disabled}
              label={labelOf?.(c)}
              value={values[c.key] ?? c.defaultValue ?? ""}
              onChange={(next) => onChange(c.key, next)}
            />
          ))}
        </div>
      )}
      {toggles.length > 0 && (
        <div className="rounded-2xl border border-line bg-black/[0.03] px-3 divide-y divide-white/5">
          {toggles.map((c) => (
            <ParamControlField
              key={c.key}
              control={c}
              accent={accent}
              disabled={disabled}
              label={labelOf?.(c)}
              value={values[c.key] ?? c.defaultValue ?? "false"}
              onChange={(next) => onChange(c.key, next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
