/**
 * 脱衣模式系统提示词：按性别注入，用户不可编辑。
 * VIP2 高级选项非默认时会重构 prompt，把穿着/身材片段塞入。
 */

import {
  collectUndressPromptExtras,
  normalizeUndressAdvanced,
  type UndressAdvancedOptions,
} from "./undress-options";

export const UNDRESS_GENDERS = ["female", "male", "couple"] as const;
export type UndressGender = (typeof UNDRESS_GENDERS)[number];

export type UndressPromptPair = {
  prompt: string;
  negative_prompt: string;
};

/** 人体结构 / 肢体畸形类负向词：优先压住多肢、断肢、手部崩坏 */
const ANATOMY_NEGATIVE =
  "bad anatomy, bad proportions, deformed, disfigured, malformed, mutation, mutated, " +
  "extra limbs, missing limbs, floating limbs, disconnected limbs, cloned body, " +
  "extra arms, extra legs, missing arms, missing legs, fused limbs, " +
  "extra hands, missing hands, poorly drawn hands, mutated hands, malformed hands, " +
  "too many fingers, fewer fingers, fused fingers, long fingers, missing fingers, " +
  "extra fingers, bad hands, bad feet, poorly drawn feet, " +
  "extra heads, two heads, poorly drawn face, asymmetrical face, " +
  "long neck, twisted torso, broken spine, contorted pose, unnatural pose, " +
  "distorted body, elongated limbs, shortened limbs, liquid body, " +
  "anatomical nonsense, grotesque, mangled";

const IDENTITY_NEGATIVE =
  "change face, different person, identity change, change pose, " +
  "change hairstyle, change background, change lighting, change camera angle, change aspect ratio, " +
  "crop, zoom, stretch, warp, reshape canvas, " +
  "style transfer, artistic filter, makeup change, age change, child, minor, underage, " +
  "low quality, blurry, jpeg artifacts, watermark, text, logo, signature";

const KEEP_FRAMING =
  "Preserve the exact original aspect ratio, framing, and canvas size. " +
  "Do not crop, stretch, pad, or reframe the image.";

function subjectPhrase(gender: UndressGender): string {
  if (gender === "female") return "the woman in the picture";
  if (gender === "male") return "the man in the picture";
  return "both the man and the woman in the picture";
}

function buildBasePrompt(gender: UndressGender, extras: ReturnType<typeof collectUndressPromptExtras>): string {
  const subject = subjectPhrase(gender);
  const keepBody = extras.altersBody
    ? "Keep face, hairstyle, skin tone, pose, hands, fingers, feet, expression, background, lighting, and camera framing consistent with the source."
    : "Keep face, hairstyle, body shape, skin tone, pose, hands, fingers, feet, expression, background, lighting, and camera framing exactly the same.";

  const bodyPermit = extras.altersBody
    ? "Allowed body edits are limited strictly to the attributes listed below; do not change unrelated body parts."
    : "Do not redesign, restyle, or modify body shape.";

  const clothingRule = extras.addsClothing
    ? "After undressing, apply only the listed clothing or footwear items; do not add any other garments or accessories."
    : "Only undress; do not add clothes, accessories, or footwear.";

  const coupleExtra =
    gender === "couple"
      ? " Do not add or remove people, swap identities, or change relative positions."
      : "";

  const head =
    gender === "couple"
      ? `Remove all the clothes of ${subject}. ${keepBody} ${KEEP_FRAMING} ${clothingRule} ${bodyPermit}${coupleExtra}`
      : `Remove all the clothes of ${subject}. ${keepBody} ${KEEP_FRAMING} ${clothingRule} ${bodyPermit}`;

  const anatomy =
    " Keep anatomically correct human proportions with natural hands and fingers.";

  if (!extras.additions.length) {
    return `${head}${anatomy}`;
  }

  return `${head}${anatomy} Additionally apply these exact edits only: ${extras.additions.join("; ")}.`;
}

function buildNegative(
  gender: UndressGender,
  extras: ReturnType<typeof collectUndressPromptExtras>
): string {
  const parts = [ANATOMY_NEGATIVE, IDENTITY_NEGATIVE];

  if (!extras.altersBody) {
    parts.push("change body shape");
  }
  if (!extras.addsClothing) {
    parts.push(
      "add clothes, add accessories, add jewelry, restyle outfit, add shoes, add socks, add stockings"
    );
  } else {
    parts.push("add unrelated clothes, extra jackets, coats, shirts, pants beyond specified items");
  }

  if (gender === "couple") {
    parts.push("add person, remove person, swap gender, change number of people, face swap");
  }

  return parts.join(", ");
}

export function isUndressGender(v: unknown): v is UndressGender {
  return typeof v === "string" && (UNDRESS_GENDERS as readonly string[]).includes(v);
}

export function resolveUndressPrompts(
  gender: UndressGender,
  advanced?: UndressAdvancedOptions | null
): UndressPromptPair {
  // VIP2 穿着/身材高级选项仅对女性生效；男 / 一男一女一律走基础脱衣 prompt
  const options =
    gender === "female" ? normalizeUndressAdvanced(advanced ?? null) : normalizeUndressAdvanced(null);
  const extras = collectUndressPromptExtras(options);
  return {
    prompt: buildBasePrompt(gender, extras),
    negative_prompt: buildNegative(gender, extras),
  };
}

/** 脱衣模式 UI 不展示宽高比 / 尺寸：由服务端按原图强制写入 */
export const UNDRESS_LOCKED_UI_KEYS = new Set(["ratio", "size"]);
