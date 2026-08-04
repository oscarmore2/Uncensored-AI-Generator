import type { ProviderId } from "./meta";

/** 各渠道模型列表归一后的形状 */
export type RemoteModel = {
  modelId: string;
  name: string;
  /** 细分类目，如 text-to-video / IMAGE-TO-IMAGE；玩物专区按它归品类 */
  type: string;
  description: string;
  basePriceUsd: number;
  thumbnailUrl: string | null;
  /** 参数 schema 的 JSON 字符串；上游若单独放文件则同步时再抓 */
  apiSchema: string | null;
  /** schema 文件地址（仅 Atlas 有）；未变化时同步可跳过重复抓取 */
  schemaUrl?: string | null;
  /** 上游自带的标签，仅作参考不落库（库里 tags 是管理端手工贴的） */
  remoteTags?: string[];
};

export type ProviderCredentials = {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  accountId: number | null;
  source: "db" | "env";
  label: string;
};

export type SubmitResult = { id: string; status: string };

export type PollResult = {
  status: string;
  outputs: string[];
  /** 上游若给了成品缩略图就带回来；两家目前都取不到，属常态 */
  thumbnails: string[];
  error?: string;
};

/** 提交任务时需要的模型上下文（各渠道要的东西不一样） */
export type SubmitContext = {
  modelId: string;
  /** 该模型已同步的参数 schema，Atlas 靠它定位提交端点 */
  apiSchema: string | null;
  /** 目录里的细分类目，schema 缺失时的兜底 */
  type: string;
};

export type ProviderAdapter = {
  id: ProviderId;
  /** 取当前激活凭据：优先管理端账户，其次 .env 兜底 */
  getCredentials(): Promise<ProviderCredentials | null>;
  /** 管理端「测试」按钮：Key 能不能用 */
  testKey(apiKey: string): Promise<void>;
  /** .env 兜底 Key（没有则空串），用于管理端展示 */
  envApiKey(): string;
  envBaseUrl(): string;
  listRemoteModels(apiKey: string): Promise<RemoteModel[]>;
  /** 上游把 schema 单独放文件时，同步阶段用它补齐；返回 null 表示抓不到 */
  fetchSchema?(schemaUrl: string): Promise<string | null>;
  submit(apiKey: string, ctx: SubmitContext, inputs: Record<string, unknown>): Promise<SubmitResult>;
  poll(apiKey: string, taskId: string): Promise<PollResult>;
  /**
   * 按本次入参实时估价（美元）。返回 null 表示该渠道不支持或估价失败，
   * 调用方应退回目录基准价，而不是把生成拦下来。
   */
  estimatePrice(
    apiKey: string,
    modelId: string,
    inputs: Record<string, unknown>
  ): Promise<number | null>;
};
