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

const SHARED_NEGATIVE =
  "change face, different person, identity change, change pose, change body shape, " +
  "change hairstyle, change background, change lighting, change camera angle, " +
  "add clothes, add accessories, add jewelry, restyle outfit, style transfer, " +
  "artistic filter, makeup change, age change, child, minor, underage, " +
  "low quality, blurry, deformed, extra limbs, watermark, text, logo";

const PROMPTS: Record<UndressGender, UndressPromptPair> = {
  female: {
    prompt:
      "Remove all the clothes of the woman in the picture. Keep her face, hairstyle, " +
      "body shape, skin tone, pose, hands, expression, background, lighting, and camera " +
      "framing exactly the same. Only undress; do not redesign, restyle, or modify anything else.",
    negative_prompt: SHARED_NEGATIVE,
  },
  male: {
    prompt:
      "Remove all the clothes of the man in the picture. Keep his face, hairstyle, " +
      "body shape, skin tone, pose, hands, expression, background, lighting, and camera " +
      "framing exactly the same. Only undress; do not redesign, restyle, or modify anything else.",
    negative_prompt: SHARED_NEGATIVE,
  },
  couple: {
    prompt:
      "Remove all the clothes of both the man and the woman in the picture. Keep each person's " +
      "face, hairstyle, body shape, skin tone, pose, relative positions, expressions, " +
      "background, lighting, and camera framing exactly the same. Only undress both people; " +
      "do not add or remove people, swap identities, redesign, restyle, or modify anything else.",
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
