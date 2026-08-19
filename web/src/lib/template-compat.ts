import type { MediaInputSpec } from "./client";
import type { SnapshotMedia } from "./draft-snapshot";

/**
 * 草稿 / 模板的兼容性判定（规格 §五）。
 *
 * 为什么在**读取时现算**而不是存储时冻结一个标志位：
 * 模式绑定的模型随时可能在管理端被换掉，媒体位的数量、类型、必填与否
 * 都会跟着变。存下来的标志位从写下那一刻就开始腐烂，而且没有任何东西
 * 会去刷新它。现算的成本是一次已经在手边的 specs 比对，但永远正确。
 *
 * 「会丢什么」与「实际丢什么」必须出自同一个函数——分成两份实现，
 * 迟早会漂成弹窗说丢一张、实际丢两张。所以 applyMediaToSpecs 既返回
 * 保留下来的媒体，也返回被丢弃的明细，判定和套用都用它。
 */

export type CompatLevel = "ok" | "degraded" | "broken";

export type CompatIssue =
  /** 这个字段当前模型根本没有 */
  | { type: "unknown_field"; field: string; dropped: number }
  /** 超出该位的容量 */
  | { type: "over_capacity"; field: string; max: number; dropped: number }
  /** 类型对不上（比如原来是图，现在这个位要视频） */
  | { type: "kind_mismatch"; field: string; expected: string; dropped: number }
  /** 必填位没东西，套用后不能直接生成 */
  | { type: "missing_required"; field: string; need: number; have: number };

export type MediaApplyResult = {
  kept: Record<string, SnapshotMedia[]>;
  issues: CompatIssue[];
  droppedCount: number;
};

/**
 * 把快照里的媒体按当前 specs 过一遍。
 * 返回能留下的那些，以及每一处丢弃的原因和条数。
 */
export function applyMediaToSpecs(
  specs: MediaInputSpec[],
  media: Record<string, SnapshotMedia[]>
): MediaApplyResult {
  const specByField = new Map(specs.map((s) => [s.field, s]));
  const kept: Record<string, SnapshotMedia[]> = {};
  const issues: CompatIssue[] = [];
  let droppedCount = 0;

  for (const [field, items] of Object.entries(media)) {
    if (!items.length) continue;
    const spec = specByField.get(field);
    if (!spec) {
      issues.push({ type: "unknown_field", field, dropped: items.length });
      droppedCount += items.length;
      continue;
    }

    const rightKind = items.filter((it) => it.kind === spec.kind);
    const wrongKind = items.length - rightKind.length;
    if (wrongKind > 0) {
      issues.push({ type: "kind_mismatch", field, expected: spec.kind, dropped: wrongKind });
      droppedCount += wrongKind;
    }

    const fitted = rightKind.slice(0, spec.maxItems);
    const overflow = rightKind.length - fitted.length;
    if (overflow > 0) {
      issues.push({ type: "over_capacity", field, max: spec.maxItems, dropped: overflow });
      droppedCount += overflow;
    }

    if (fitted.length) kept[field] = fitted;
  }

  return { kept, issues, droppedCount };
}

/**
 * 三档判定。
 *
 * broken 的判据是「套用后不能直接生成」——必填位缺东西。
 * degraded 是「能套，但有东西会被丢掉」。
 */
export function evaluateCompatibility(
  specs: MediaInputSpec[],
  media: Record<string, SnapshotMedia[]>
): { level: CompatLevel; issues: CompatIssue[]; droppedCount: number } {
  const applied = applyMediaToSpecs(specs, media);
  const issues = [...applied.issues];

  for (const spec of specs) {
    if (spec.minItems <= 0) continue;
    const have = applied.kept[spec.field]?.length ?? 0;
    if (have < spec.minItems) {
      issues.push({
        type: "missing_required",
        field: spec.field,
        need: spec.minItems,
        have,
      });
    }
  }

  const broken = issues.some((i) => i.type === "missing_required");
  const level: CompatLevel = broken ? "broken" : issues.length ? "degraded" : "ok";
  return { level, issues, droppedCount: applied.droppedCount };
}
