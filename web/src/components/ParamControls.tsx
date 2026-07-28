"use client";

import {
  CHIP_THRESHOLD,
  accentOf,
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
  const inputClass = `w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none transition-colors ${a.focusBorder} disabled:opacity-50`;

  if (control.kind === "enum") {
    if (control.options.length === 0) return null;

    if (control.options.length <= CHIP_THRESHOLD) {
      return (
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">{title}</label>
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
                    active ? a.activeChip : "bg-white/5 border-white/10 text-gray-300 hover:border-white/25"
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
        <label className="text-xs text-gray-400 block mb-1">{title}</label>
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
        <span className="text-xs text-gray-400">{title}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(on ? "false" : "true")}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
            on ? a.switchOn : "bg-white/15"
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
            <label className="text-xs text-gray-400">{title}</label>
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
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>{control.min}</span>
            <span>{control.max}</span>
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className="text-xs text-gray-400 block mb-1">{title}</label>
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

  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{title}</label>
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 divide-y divide-white/5">
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
