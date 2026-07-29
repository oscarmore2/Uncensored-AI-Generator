/**
 * 脱衣模式系统提示词：按性别注入，用户不可编辑。
 * 只做 undress / remove clothing，明确禁止身份、姿态、背景、风格等任何其它修改。
 */

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

const SHARED_NEGATIVE =
  ANATOMY_NEGATIVE +
  ", change face, different person, identity change, change pose, change body shape, " +
  "change hairstyle, change background, change lighting, change camera angle, change aspect ratio, " +
  "crop, zoom, stretch, warp, reshape canvas, " +
  "add clothes, add accessories, add jewelry, restyle outfit, style transfer, " +
  "artistic filter, makeup change, age change, child, minor, underage, " +
  "low quality, blurry, jpeg artifacts, watermark, text, logo, signature";

const KEEP_FRAMING =
  "Preserve the exact original aspect ratio, framing, and canvas size. " +
  "Do not crop, stretch, pad, or reframe the image.";

const PROMPTS: Record<UndressGender, UndressPromptPair> = {
  female: {
    prompt:
      "Remove all the clothes of the woman in the picture. Keep her face, hairstyle, " +
      "body shape, skin tone, pose, hands, fingers, feet, expression, background, lighting, and camera " +
      `framing exactly the same. ${KEEP_FRAMING} ` +
      "Only undress; do not redesign, restyle, or modify anything else. " +
      "Keep anatomically correct human proportions with natural hands and fingers.",
    negative_prompt: SHARED_NEGATIVE,
  },
  male: {
    prompt:
      "Remove all the clothes of the man in the picture. Keep his face, hairstyle, " +
      "body shape, skin tone, pose, hands, fingers, feet, expression, background, lighting, and camera " +
      `framing exactly the same. ${KEEP_FRAMING} ` +
      "Only undress; do not redesign, restyle, or modify anything else. " +
      "Keep anatomically correct human proportions with natural hands and fingers.",
    negative_prompt: SHARED_NEGATIVE,
  },
  couple: {
    prompt:
      "Remove all the clothes of both the man and the woman in the picture. Keep each person's " +
      "face, hairstyle, body shape, skin tone, pose, hands, fingers, feet, relative positions, expressions, " +
      `background, lighting, and camera framing exactly the same. ${KEEP_FRAMING} ` +
      "Only undress both people; do not add or remove people, swap identities, redesign, restyle, or modify anything else. " +
      "Keep anatomically correct human proportions with natural hands and fingers for both people.",
    negative_prompt:
      SHARED_NEGATIVE +
      ", add person, remove person, swap gender, change number of people, face swap",
  },
};

export function isUndressGender(v: unknown): v is UndressGender {
  return typeof v === "string" && (UNDRESS_GENDERS as readonly string[]).includes(v);
}

export function resolveUndressPrompts(gender: UndressGender): UndressPromptPair {
  return PROMPTS[gender];
}

/** 脱衣模式 UI 不展示宽高比 / 尺寸：由服务端按原图强制写入 */
export const UNDRESS_LOCKED_UI_KEYS = new Set(["ratio", "size"]);
