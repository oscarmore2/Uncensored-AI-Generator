/**
 * 生成渠道的静态元信息。
 *
 * 这一层刻意不带 server-only：管理端与玩物专区的渠道 tab / 筛选器是客户端组件，
 * 需要同一份渠道清单与名称，否则两边各写一份迟早对不上。
 * 任何涉及 API Key、上游调用的东西都在 providers/index.ts（server-only）里。
 */

export const PROVIDER_IDS = ["wavespeed", "atlas"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_PROVIDER: ProviderId = "wavespeed";

export type ProviderMeta = {
  id: ProviderId;
  /** 面向管理员的渠道名 */
  label: string;
  /** tab 上的短名 */
  shortLabel: string;
  /** 申领 API Key 的地址，给管理端表单当 placeholder */
  keyUrl: string;
  /**
   * 是否支持「按本次入参实时估价」。
   * WaveSpeed 有 /model/pricing；Atlas 只有目录上的固定基准价，
   * 差别会直接影响玩物专区的报价口径，必须让管理端看得见。
   */
  supportsDynamicPricing: boolean;
  /** 渠道强调色（Tailwind 类名片段），用于 tab 与徽标 */
  accentClass: string;
};

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  wavespeed: {
    id: "wavespeed",
    label: "WaveSpeed",
    shortLabel: "WaveSpeed",
    keyUrl: "https://wavespeed.ai/accesskey",
    supportsDynamicPricing: true,
    accentClass: "sky",
  },
  atlas: {
    id: "atlas",
    label: "Atlas Cloud",
    shortLabel: "Atlas Cloud",
    keyUrl: "https://www.atlascloud.ai/console/api-keys",
    supportsDynamicPricing: false,
    accentClass: "violet",
  },
};

export const PROVIDER_LIST: ProviderMeta[] = PROVIDER_IDS.map((id) => PROVIDER_META[id]);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** 把库里存的字符串收敛成合法渠道；老数据没有该字段时按 wavespeed 处理 */
export function toProviderId(value: unknown): ProviderId {
  return isProviderId(value) ? value : DEFAULT_PROVIDER;
}

export function providerLabel(value: unknown): string {
  return PROVIDER_META[toProviderId(value)].label;
}
