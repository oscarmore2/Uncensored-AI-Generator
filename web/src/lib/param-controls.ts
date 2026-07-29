/**
 * 参数控件模型与配色（客户端 / 服务端共用，无 server-only）。
 *
 * 生成端与玩物专区桥接的都是 WaveSpeed 模型，但各模型的参数差异极大：
 * 有的只收枚举，有的是带上下限的整数，有的是布尔开关。
 * 这里把 schema 归一成统一的控件描述，两边共用同一套渲染器，
 * 换绑模型时表单自动适配，无需改代码。
 */

export type ParamControlKind = "enum" | "number" | "boolean" | "text" | "size";

export type ParamControl = {
  /** 站内参数键（生成端用 uiKey，玩物专区用上游字段名） */
  key: string;
  kind: ParamControlKind;
  /** enum 才有值 */
  options: Array<{ value: string; label: string }>;
  /** number/size 才有值：number 是数值上下限，size 是宽高各自的像素上下限（两边共用同一个范围） */
  min?: number;
  max?: number;
  integer?: boolean;
  defaultValue?: string;
  /** 上游 schema 标记为必填 */
  required?: boolean;
};

/** size 控件没有值就是「保持原图尺寸」，不会把该字段发给上游 */
export const SIZE_KEEP_ORIGINAL = "";

/** size 字段的分隔符：站内约定统一用 "*"（如 "1024*1536"），与已同步模型的 schema 默认值格式一致 */
export const SIZE_DELIMITER = "*";

export function formatSizeValue(width: number, height: number): string {
  return `${Math.round(width)}${SIZE_DELIMITER}${Math.round(height)}`;
}

export function parseSizeValue(raw: string | undefined): { width: number; height: number } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d+)\s*[*x×]\s*(\d+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

/** size 控件没有模型声明上下限时的保守兜底范围 */
export const DEFAULT_SIZE_RANGE = { min: 256, max: 2048 };

export const SIZE_ASPECT_PRESETS: Array<{ ratio: string; w: number; h: number; icon: string }> = [
  { ratio: "1:1", w: 1, h: 1, icon: "square" },
  { ratio: "16:9", w: 16, h: 9, icon: "landscape" },
  { ratio: "9:16", w: 9, h: 16, icon: "portrait" },
  { ratio: "4:3", w: 4, h: 3, icon: "landscape" },
  { ratio: "3:4", w: 3, h: 4, icon: "portrait" },
  { ratio: "3:2", w: 3, h: 2, icon: "landscape" },
  { ratio: "2:3", w: 2, h: 3, icon: "portrait" },
];

/** 按目标比例算出落在 [min,max] 内的宽高；以较长边贴范围上限，短边跟随比例 */
export function sizeForRatio(w: number, h: number, min: number, max: number): { width: number; height: number } {
  const longSide = Math.min(max, Math.max(min, max)); // 长边尽量贴近上限
  if (w >= h) {
    const width = longSide;
    const height = Math.max(min, Math.min(max, Math.round((width * h) / w)));
    return { width, height };
  }
  const height = longSide;
  const width = Math.max(min, Math.min(max, Math.round((height * w) / h)));
  return { width, height };
}

/**
 * 主体强调色。Tailwind 需要静态类名，因此用查表而不是拼接字符串。
 * rose = 创作中心普通档，fuchsia = Spicy 档，sky = 玩物专区。
 */
export type AccentTone = "rose" | "fuchsia" | "sky";

export type AccentClasses = {
  /** 输入框获得焦点时的描边 */
  focusBorder: string;
  /** 选中态背景 + 描边 */
  activeChip: string;
  /** 强调文字 */
  text: string;
  /** 开关打开时的底色 */
  switchOn: string;
  /** 滑块轨道填充 */
  accent: string;
};

export const ACCENT_CLASSES: Record<AccentTone, AccentClasses> = {
  rose: {
    focusBorder: "focus:border-rose-500/60",
    activeChip: "bg-rose-600/20 border-rose-500 text-rose-100",
    text: "text-rose-300",
    switchOn: "bg-rose-600",
    accent: "accent-rose-500",
  },
  fuchsia: {
    focusBorder: "focus:border-fuchsia-500/60",
    activeChip: "bg-fuchsia-600/20 border-fuchsia-500 text-fuchsia-100",
    text: "text-fuchsia-300",
    switchOn: "bg-fuchsia-600",
    accent: "accent-fuchsia-500",
  },
  sky: {
    focusBorder: "focus:border-sky-500/60",
    activeChip: "bg-sky-600/20 border-sky-500 text-sky-100",
    text: "text-sky-300",
    switchOn: "bg-sky-600",
    accent: "accent-sky-500",
  },
};

export function accentOf(tone: AccentTone | undefined): AccentClasses {
  return ACCENT_CLASSES[tone ?? "rose"];
}

/** 枚举项少时用横向 chip 更直观，多了才退回下拉 */
export const CHIP_THRESHOLD = 5;

/** 把控件当前值转成提交用的原始类型 */
export function coerceControlValue(control: ParamControl, raw: string): unknown {
  if (raw === "") return undefined;
  switch (control.kind) {
    case "boolean":
      return raw === "true";
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      return control.integer ? Math.round(n) : n;
    }
    default:
      return raw;
  }
}
