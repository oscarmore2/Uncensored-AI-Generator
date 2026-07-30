/**
 * 脱衣模式 VIP2 高级选项：穿着 / 身材。
 * 「默认」表示不追加任何额外 prompt；选中其它值时拼进系统 prompt。
 */

export const UNDRESS_LOWER_WEAR = [
  "default",
  "pantyhose",
  "thigh_highs",
  "fishnets",
  "cotton_socks",
] as const;
export type UndressLowerWear = (typeof UNDRESS_LOWER_WEAR)[number];

export const UNDRESS_UNDERWEAR_COLORS = ["skin", "black", "white", "red"] as const;
export type UndressUnderwearColor = (typeof UNDRESS_UNDERWEAR_COLORS)[number];

export const UNDRESS_FOOTWEAR = [
  "default",
  "barefoot",
  "pointed_heels",
  "pointed_flats",
  "canvas_shoes",
  "basketball_shoes",
  "heeled_sandals",
  "flat_sandals",
] as const;
export type UndressFootwear = (typeof UNDRESS_FOOTWEAR)[number];

export const UNDRESS_BREAST_SIZE = ["default", "flat", "medium", "large", "huge"] as const;
export type UndressBreastSize = (typeof UNDRESS_BREAST_SIZE)[number];

export const UNDRESS_BREAST_SHAPE = [
  "default",
  "sagging",
  "perky",
  "round",
  "east_west",
  "teardrop",
  "baggy",
  "bell",
] as const;
export type UndressBreastShape = (typeof UNDRESS_BREAST_SHAPE)[number];

export const UNDRESS_NIPPLE_SIZE = ["default", "small", "medium", "large"] as const;
export type UndressNippleSize = (typeof UNDRESS_NIPPLE_SIZE)[number];

export const UNDRESS_BODY_DECORATION = ["default", "navel_piercing", "nipple_piercing"] as const;
export type UndressBodyDecoration = (typeof UNDRESS_BODY_DECORATION)[number];

export const UNDRESS_PUBIC_TYPE = [
  "default",
  "hairless",
  "light_hair",
  "heavy_hair",
  "panties",
] as const;
export type UndressPubicType = (typeof UNDRESS_PUBIC_TYPE)[number];

export const UNDRESS_BODY_TYPE = ["default", "slim", "muscular", "curvy"] as const;
export type UndressBodyType = (typeof UNDRESS_BODY_TYPE)[number];

export const UNDRESS_LEG_ENHANCE = ["default", "longer", "muscular", "both"] as const;
export type UndressLegEnhance = (typeof UNDRESS_LEG_ENHANCE)[number];

export type UndressAdvancedOptions = {
  lower_wear: UndressLowerWear;
  underwear_color: UndressUnderwearColor;
  footwear: UndressFootwear;
  breast_size: UndressBreastSize;
  breast_shape: UndressBreastShape;
  nipple_size: UndressNippleSize;
  body_decoration: UndressBodyDecoration;
  pubic_type: UndressPubicType;
  body_type: UndressBodyType;
  leg_enhance: UndressLegEnhance;
};

export const DEFAULT_UNDRESS_ADVANCED: UndressAdvancedOptions = {
  lower_wear: "default",
  underwear_color: "skin",
  footwear: "default",
  breast_size: "default",
  breast_shape: "default",
  nipple_size: "default",
  body_decoration: "default",
  pubic_type: "default",
  body_type: "default",
  leg_enhance: "default",
};

/** 下身穿着非默认（非裸体）时才显示内衣颜色 */
export function showsUnderwearColor(lowerWear: UndressLowerWear): boolean {
  return lowerWear !== "default";
}

/** 乳房为中等/大号/巨乳时才显示形状与乳头 */
export function showsBreastDetails(breastSize: UndressBreastSize): boolean {
  return breastSize === "medium" || breastSize === "large" || breastSize === "huge";
}

function inSet<T extends string>(allowed: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

/** 清洗客户端提交：非法字段回落默认，条件字段在未展示时强制默认 */
export function normalizeUndressAdvanced(
  raw: unknown
): UndressAdvancedOptions {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const lower_wear = inSet(UNDRESS_LOWER_WEAR, src.lower_wear)
    ? src.lower_wear
    : "default";
  const footwear = inSet(UNDRESS_FOOTWEAR, src.footwear) ? src.footwear : "default";
  const breast_size = inSet(UNDRESS_BREAST_SIZE, src.breast_size)
    ? src.breast_size
    : "default";
  const body_decoration = inSet(UNDRESS_BODY_DECORATION, src.body_decoration)
    ? src.body_decoration
    : "default";
  const pubic_type = inSet(UNDRESS_PUBIC_TYPE, src.pubic_type) ? src.pubic_type : "default";
  const body_type = inSet(UNDRESS_BODY_TYPE, src.body_type) ? src.body_type : "default";
  const leg_enhance = inSet(UNDRESS_LEG_ENHANCE, src.leg_enhance)
    ? src.leg_enhance
    : "default";

  const underwear_color =
    showsUnderwearColor(lower_wear) && inSet(UNDRESS_UNDERWEAR_COLORS, src.underwear_color)
      ? src.underwear_color
      : DEFAULT_UNDRESS_ADVANCED.underwear_color;

  const breast_shape =
    showsBreastDetails(breast_size) && inSet(UNDRESS_BREAST_SHAPE, src.breast_shape)
      ? src.breast_shape
      : "default";
  const nipple_size =
    showsBreastDetails(breast_size) && inSet(UNDRESS_NIPPLE_SIZE, src.nipple_size)
      ? src.nipple_size
      : "default";

  return {
    lower_wear,
    underwear_color,
    footwear,
    breast_size,
    breast_shape,
    nipple_size,
    body_decoration,
    pubic_type,
    body_type,
    leg_enhance,
  };
}

const UNDERWEAR_COLOR_WORD: Record<UndressUnderwearColor, string> = {
  skin: "skin-tone",
  black: "black",
  white: "white",
  red: "red",
};

/** 连裤袜颜色写法：肤色用 nude skin-like；其它色按色名写 */
function pantyhoseColorPhrase(color: UndressUnderwearColor): string {
  switch (color) {
    case "skin":
      return "ultra sheer nude pantyhose, color skin-like";
    case "black":
      return "black sheer pantyhose in black";
    case "white":
      return "white sheer pantyhose in white";
    case "red":
      return "sheer pantyhose in red color";
  }
}

/** 连裤袜固定结构：腰头在肚脐下方，布料只从脚到腰头 */
const PANTYHOSE_FIT =
  "waistband sitting on the waist just below the navel, " +
  "pantyhose fabric covering only from the feet up to that waistband and nowhere above";

/** 下身穿着细节：颜色来自内衣颜色选项；默认项不会走到这里 */
function lowerWearPrompt(
  wear: Exclude<UndressLowerWear, "default">,
  color: UndressUnderwearColor
): string {
  const c = UNDERWEAR_COLOR_WORD[color];
  switch (wear) {
    case "pantyhose":
      return `wearing ${pantyhoseColorPhrase(color)}, ${PANTYHOSE_FIT}`;
    case "thigh_highs":
      return `wearing ${c} thigh-high stockings with decorative lace tops`;
    case "fishnets":
      return `wearing ${c} lace-trimmed thigh-high fishnet stockings`;
    case "cotton_socks":
      return `wearing ${c} short ankle-length cotton socks`;
  }
}

const FOOTWEAR_PROMPT: Record<Exclude<UndressFootwear, "default" | "barefoot">, string> = {
  pointed_heels: "wearing pointed-toe high heels",
  pointed_flats: "wearing pointed-toe flat shoes",
  canvas_shoes: "wearing canvas sneakers",
  basketball_shoes: "wearing basketball sneakers",
  heeled_sandals: "wearing heeled sandals",
  flat_sandals: "wearing flat sandals",
};

/** 丝袜类下身穿着：不穿鞋时需表现脚趾被同色丝袜包裹 */
function isSheerHosiery(wear: UndressLowerWear): boolean {
  return wear === "pantyhose" || wear === "thigh_highs" || wear === "fishnets";
}

function barefootPrompt(
  lowerWear: UndressLowerWear,
  color: UndressUnderwearColor
): string {
  if (lowerWear === "pantyhose") {
    return (
      `barefoot with no shoes, toes and feet wrapped in the ${pantyhoseColorPhrase(color)}, ` +
      `toenails visible through the sheer pantyhose`
    );
  }
  if (isSheerHosiery(lowerWear)) {
    const c = UNDERWEAR_COLOR_WORD[color];
    return (
      `barefoot with no shoes, toes and feet clearly wrapped in the ${c} sheer hosiery, ` +
      `toenails visible through the sheer fabric`
    );
  }
  if (lowerWear === "cotton_socks") {
    return "barefoot with no shoes over the short cotton socks, socked toes visible";
  }
  return "barefoot with no shoes, bare toes and soles visible";
}

/** 未穿内裤 + 连裤袜：阴蒂隔着一层丝袜布料可见 */
function genitalsThroughPantyhosePrompt(color: UndressUnderwearColor): string {
  return (
    `no panties under the pantyhose, female clitoris clearly visible through one layer of sheer pantyhose fabric ` +
    `(${pantyhoseColorPhrase(color)}), clitoris seen under the thin pantyhose material, ` +
    `genitals and pubic area visible only through the sheer pantyhose cloth`
  );
}

/** 未穿内裤且无连裤袜：阴蒂直接可见 */
const EXPOSED_CLITORIS_PROMPT =
  "no panties, no underwear, crotch fully exposed and bare, female clitoris directly visible and uncovered";

/** 阴毛 + 连裤袜：阴毛被丝袜压住，仅透过薄层可见 */
function pubicHairUnderPantyhosePrompt(
  pubicType: "light_hair" | "heavy_hair",
  color: UndressUnderwearColor
): string {
  const hair =
    pubicType === "heavy_hair"
      ? "thick dense bushy pubic hair"
      : "light sparse pubic hair";
  return (
    `${hair} pressed flat under the ${pantyhoseColorPhrase(color)}, ` +
    `only faintly visible as a soft shadow through the thin sheer layer of the pantyhose, ` +
    `not floating above the fabric`
  );
}

const BREAST_SIZE_PROMPT: Record<Exclude<UndressBreastSize, "default">, string> = {
  flat: "small flat breasts, petite bust",
  medium: "medium-sized breasts",
  large: "large full breasts",
  huge: "very large huge breasts",
};

const BREAST_SHAPE_PROMPT: Record<Exclude<UndressBreastShape, "default">, string> = {
  sagging: "sagging hanging breast shape",
  perky: "perky upright breast shape",
  round: "round spherical breast shape",
  east_west: "east-west wide-set breast shape",
  teardrop: "teardrop breast shape",
  baggy: "soft baggy breast shape",
  bell: "bell-shaped breasts",
};

const NIPPLE_SIZE_PROMPT: Record<Exclude<UndressNippleSize, "default">, string> = {
  small: "small nipples",
  medium: "medium-sized nipples",
  large: "large prominent nipples",
};

const BODY_DECORATION_PROMPT: Record<Exclude<UndressBodyDecoration, "default">, string> = {
  navel_piercing: "navel piercing belly button ring",
  nipple_piercing: "nipple piercings",
};

const PUBIC_TYPE_PROMPT: Record<Exclude<UndressPubicType, "default">, string> = {
  hairless: "completely hairless shaved pubic area, smooth bare skin",
  light_hair: "light sparse pubic hair",
  heavy_hair: "thick dense bushy pubic hair",
  panties: "private area covered by panties, wearing panties over the genitals",
};

const BODY_TYPE_PROMPT: Record<Exclude<UndressBodyType, "default">, string> = {
  slim: "slim slender body type",
  muscular: "athletic muscular body type",
  curvy: "curvy voluptuous body type",
};

const LEG_ENHANCE_PROMPT: Record<Exclude<UndressLegEnhance, "default">, string> = {
  longer: "longer elongated legs",
  muscular: "toned muscular legs",
  both: "longer and more muscular legs",
};

export type UndressPromptExtras = {
  /** 追加到 positive 的穿着/身材短句 */
  additions: string[];
  /** 是否改动身材（需放宽 “保持身材不变”） */
  altersBody: boolean;
  /** 是否追加穿着（需放宽 “不要加衣服”） */
  addsClothing: boolean;
  /** 仅私处类型选「内裤」时为 true；否则一律裸露不穿内裤 */
  wearsPanties: boolean;
};

/** 把非默认选项收成 prompt 片段；默认项全部跳过（私处除外：未选内裤也要显式裸露） */
export function collectUndressPromptExtras(
  options: UndressAdvancedOptions
): UndressPromptExtras {
  const additions: string[] = [];
  let altersBody = false;
  let addsClothing = false;
  const wearsPanties = options.pubic_type === "panties";

  if (options.lower_wear !== "default") {
    additions.push(lowerWearPrompt(options.lower_wear, options.underwear_color));
    addsClothing = true;
    // 内衣颜色只影响丝袜/腰头等，不再自动加内裤；内裤只由私处类型「内裤」决定
  }

  if (options.footwear === "barefoot") {
    additions.push(barefootPrompt(options.lower_wear, options.underwear_color));
    addsClothing = true;
  } else if (options.footwear !== "default") {
    additions.push(FOOTWEAR_PROMPT[options.footwear]);
    addsClothing = true;
  }

  if (options.breast_size !== "default") {
    additions.push(BREAST_SIZE_PROMPT[options.breast_size]);
    altersBody = true;
    if (showsBreastDetails(options.breast_size)) {
      if (options.breast_shape !== "default") {
        additions.push(BREAST_SHAPE_PROMPT[options.breast_shape]);
      }
      if (options.nipple_size !== "default") {
        additions.push(NIPPLE_SIZE_PROMPT[options.nipple_size]);
      }
    }
  }

  if (options.body_decoration !== "default") {
    additions.push(BODY_DECORATION_PROMPT[options.body_decoration]);
    altersBody = true;
  }

  if (wearsPanties) {
    const c = UNDERWEAR_COLOR_WORD[options.underwear_color];
    additions.push(
      `wearing ${c} panties covering the genitals, private area covered by ${c} panties`
    );
    addsClothing = true;
  } else if (options.lower_wear === "pantyhose") {
    // 连裤袜且未选内裤：一律可隔着连裤袜看到私处
    additions.push(genitalsThroughPantyhosePrompt(options.underwear_color));
    if (options.pubic_type === "light_hair" || options.pubic_type === "heavy_hair") {
      additions.push(
        pubicHairUnderPantyhosePrompt(options.pubic_type, options.underwear_color)
      );
      altersBody = true;
    } else if (options.pubic_type === "hairless") {
      additions.push(PUBIC_TYPE_PROMPT.hairless);
      altersBody = true;
    }
  } else {
    // 非连裤袜：默认 / 毛发选项一律不穿内裤，阴蒂直接可见
    additions.push(EXPOSED_CLITORIS_PROMPT);
    if (options.pubic_type !== "default") {
      additions.push(PUBIC_TYPE_PROMPT[options.pubic_type]);
      altersBody = true;
    }
  }

  if (options.body_type !== "default") {
    additions.push(BODY_TYPE_PROMPT[options.body_type]);
    altersBody = true;
  }

  if (options.leg_enhance !== "default") {
    additions.push(LEG_ENHANCE_PROMPT[options.leg_enhance]);
    altersBody = true;
  }

  return { additions, altersBody, addsClothing, wearsPanties };
}

/** VIP2：有效 VIP 且等级 code 为 vip2（或更高代号 vip3+） */
export function hasUndressAdvancedAccess(
  vipActive: boolean,
  tierCode: string | null | undefined
): boolean {
  if (!vipActive || !tierCode) return false;
  const code = tierCode.toLowerCase();
  if (code === "vip2") return true;
  const m = /^vip(\d+)$/.exec(code);
  return Boolean(m && Number(m[1]) >= 2);
}
