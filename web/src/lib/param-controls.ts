/**
 * 参数控件模型与配色（客户端 / 服务端共用，无 server-only）。
 *
 * 生成端与玩物专区桥接的都是 WaveSpeed 模型，但各模型的参数差异极大：
 * 有的只收枚举，有的是带上下限的整数，有的是布尔开关。
 * 这里把 schema 归一成统一的控件描述，两边共用同一套渲染器，
 * 换绑模型时表单自动适配，无需改代码。
 */

export type ParamControlKind = "enum" | "number" | "boolean" | "text";

export type ParamControl = {
  /** 站内参数键（生成端用 uiKey，玩物专区用上游字段名） */
  key: string;
  kind: ParamControlKind;
  /** enum 才有值 */
  options: Array<{ value: string; label: string }>;
  /** number 才有值 */
  min?: number;
  max?: number;
  integer?: boolean;
  defaultValue?: string;
  /** 上游 schema 标记为必填 */
  required?: boolean;
};

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
