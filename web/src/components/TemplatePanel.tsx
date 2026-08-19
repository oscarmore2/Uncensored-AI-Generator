"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type MediaInputSpec } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { decodeDraftSnapshot, type DraftSnapshot } from "@/lib/draft-snapshot";
import {
  applyMediaToSpecs,
  evaluateCompatibility,
  type CompatIssue,
  type CompatLevel,
} from "@/lib/template-compat";

/**
 * 当前模式下的模板：列出、存为模板、套用。
 *
 * 兼容性一律**现算**（见 lib/template-compat）：模式绑定的模型随时可能在
 * 管理端被换掉，存下来的标志位写下就开始腐烂。这里比对的是当前 specs，
 * 所以换了模型之后标记立刻就是对的。
 *
 * 套用前必须先弹窗说清楚会丢什么——模板可能是几个月前在另一个模型下存的，
 * 直接覆盖会让用户既丢了手上的内容、又拿到一个残缺的模板。
 */

export type ApiTemplate = {
  id: number;
  mode: string;
  tier: string | null;
  spicy: boolean;
  name: string;
  prompt: string;
  negative_prompt: string | null;
  snapshot: string;
  source_generation_id: number | null;
  use_count: number;
  updated_at: string;
};

export type TemplateApplyPayload = {
  template: ApiTemplate;
  snapshot: DraftSnapshot;
  /** 已按当前 specs 过滤过的媒体——弹窗说丢什么，这里就真的丢什么 */
  media: DraftSnapshot["media"];
};

export function TemplatePanel({
  mode,
  specs,
  onApply,
  currentPayload,
}: {
  mode: string;
  specs: MediaInputSpec[];
  onApply: (payload: TemplateApplyPayload) => void;
  /** 点「存为模板」时调用，拿到当前编辑内容 */
  currentPayload: () => {
    tier: string;
    spicy: boolean;
    prompt: string;
    negative_prompt: string;
    snapshot: string;
  };
}) {
  const t = useTranslations("Make");
  const { toast } = useApp();
  const [items, setItems] = useState<ApiTemplate[]>([]);
  const [pending, setPending] = useState<ApiTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<ApiTemplate[]>(`/api/templates?mode=${encodeURIComponent(mode)}`));
    } catch {
      // 模板列不出来不该打断创作，静默即可——存的时候会再报一次
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    const name = window.prompt(t("templateSavePrompt"))?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const cur = currentPayload();
      await api<ApiTemplate>("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name, mode, ...cur }),
      });
      toast(t("templateSaved"));
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("templateSaveFailed"), true);
    } finally {
      setSaving(false);
    }
  }, [currentPayload, load, mode, t, toast]);

  const remove = useCallback(
    async (id: number) => {
      if (!window.confirm(t("templateDeleteConfirm"))) return;
      try {
        await api(`/api/templates/${id}`, { method: "DELETE" });
        setItems((prev) => prev.filter((x) => x.id !== id));
      } catch {
        toast(t("templateSaveFailed"), true);
      }
    },
    [t, toast]
  );

  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-muted">
          <i className="fas fa-bookmark mr-1.5 text-ink-subtle" />
          {t("templates")}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:border-orange-500/40 hover:text-ink disabled:opacity-40"
        >
          <i className="fas fa-plus mr-1" />
          {t("templateSave")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-ink-subtle">{t("templateEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((tpl) => {
            const snap = decodeDraftSnapshot(tpl.snapshot);
            const { level } = evaluateCompatibility(specs, snap.media);
            return (
              <span
                key={tpl.id}
                className="group inline-flex items-center gap-1 rounded-full border border-line bg-surface pl-1 pr-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setPending(tpl)}
                  className="flex items-center gap-1.5 rounded-full px-2 py-1.5 hover:bg-black/[0.04]"
                >
                  <CompatDot level={level} />
                  <span className="max-w-[9rem] truncate">{tpl.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(tpl.id)}
                  aria-label={t("templateDelete")}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-ink-subtle hover:text-red-700"
                >
                  <i className="fas fa-times text-[10px]" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {pending && (
        <ApplyDialog
          template={pending}
          specs={specs}
          onCancel={() => setPending(null)}
          onConfirm={(payload) => {
            setPending(null);
            onApply(payload);
            void api(`/api/templates/${payload.template.id}`, {
              method: "PATCH",
              body: JSON.stringify({ used: true }),
            }).catch(() => null);
            toast(t("templateApplied"));
          }}
        />
      )}
    </div>
  );
}

function CompatDot({ level }: { level: CompatLevel }) {
  const color =
    level === "ok" ? "bg-emerald-600" : level === "degraded" ? "bg-amber-500" : "bg-red-600";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

function ApplyDialog({
  template,
  specs,
  onCancel,
  onConfirm,
}: {
  template: ApiTemplate;
  specs: MediaInputSpec[];
  onCancel: () => void;
  onConfirm: (payload: TemplateApplyPayload) => void;
}) {
  const t = useTranslations("Make");
  const snap = decodeDraftSnapshot(template.snapshot);
  const { level, issues } = evaluateCompatibility(specs, snap.media);
  const applied = applyMediaToSpecs(specs, snap.media);

  const levelLabel =
    level === "ok"
      ? t("templateCompatOk")
      : level === "degraded"
        ? t("templateCompatDegraded")
        : t("templateCompatBroken");

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-stage shadow-2xl">
        <div className="border-b border-line px-5 py-3">
          <div className="text-sm font-semibold">{t("templateApplyTitle")}</div>
          <div className="mt-0.5 truncate text-xs text-ink-subtle">{template.name}</div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="flex items-center gap-2 text-xs">
            <CompatDot level={level} />
            <span
              className={
                level === "ok"
                  ? "text-emerald-700"
                  : level === "degraded"
                    ? "text-amber-700"
                    : "text-red-700"
              }
            >
              {levelLabel}
            </span>
          </div>

          {issues.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-black/[0.03] p-3 text-[11px] text-ink-muted">
              {issues.map((issue, i) => (
                <li key={i} className="flex gap-1.5">
                  <i className="fas fa-circle-exclamation mt-0.5 text-ink-subtle" />
                  <span>{describeIssue(t, issue)}</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              prompt
            </div>
            <p className="line-clamp-6 whitespace-pre-wrap rounded-2xl bg-surface p-3 text-xs">
              {template.prompt || "—"}
            </p>
          </div>

          <p className="text-[11px] text-ink-subtle">{t("templateWillReplace")}</p>
        </div>

        <div className="flex gap-3 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-line bg-black/[0.03] py-2.5 text-sm hover:bg-black/[0.06]"
          >
            {t("templateCancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ template, snapshot: snap, media: applied.kept })}
            className="flex-1 rounded-2xl bg-orange-700 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
          >
            {t("templateApplyConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeIssue(t: ReturnType<typeof useTranslations<"Make">>, issue: CompatIssue): string {
  switch (issue.type) {
    case "unknown_field":
      return t("templateIssueUnknownField", { field: issue.field, dropped: issue.dropped });
    case "over_capacity":
      return t("templateIssueOverCapacity", {
        field: issue.field,
        max: issue.max,
        dropped: issue.dropped,
      });
    case "kind_mismatch":
      return t("templateIssueKindMismatch", {
        field: issue.field,
        expected: issue.expected,
        dropped: issue.dropped,
      });
    case "missing_required":
      return t("templateIssueMissingRequired", {
        field: issue.field,
        need: issue.need,
        have: issue.have,
      });
  }
}
