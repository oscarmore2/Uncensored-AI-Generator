/**
 * 媒体删除原因。存的是稳定的机器码，展示文案交给 i18n，
 * 这样以后改措辞不用回头迁移历史数据。
 */
export const MEDIA_DELETE_REASONS = {
  /** 到了保留期，被清理任务回收 */
  RETENTION_EXPIRED: "retention_expired",
  /** 管理端手工清理 */
  ADMIN_MANUAL: "admin_manual",
} as const;

export type MediaDeleteReason =
  (typeof MEDIA_DELETE_REASONS)[keyof typeof MEDIA_DELETE_REASONS];

/** 兜底文案：历史数据没有原因，或出现未知码时用 */
export const UNKNOWN_DELETE_REASON = "unknown";

export function normalizeDeleteReason(raw: string | null | undefined): string {
  if (!raw) return UNKNOWN_DELETE_REASON;
  const known = Object.values(MEDIA_DELETE_REASONS) as string[];
  return known.includes(raw) ? raw : UNKNOWN_DELETE_REASON;
}

/** 原始文件名入库前的清洗：去掉路径、限长，空名给个兜底 */
export function sanitizeFilename(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(/[\\/]/).pop()?.trim();
  if (!base) return null;
  return base.slice(0, 200);
}
