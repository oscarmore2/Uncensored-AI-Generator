"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/client";
import { portableFileName } from "@/lib/skills/portable-file";
import type { PortableSkill } from "@/lib/skills/portable";
import { useApp } from "@/components/AppContext";

/**
 * 自建技能。
 *
 * 用户对官方技能只有两个动作：用、复制一份改。不能就地编辑官方技能——
 * 那会把这个用户从版本升级链路上摘下来，而且分不清「这条技能表现变差」
 * 是官方改的还是他自己改的。
 */

interface MySkill {
  id: number;
  key: string;
  name: string;
  icon: string;
  description: string;
  triggers: string[];
  modes: string[];
  system_prompt: string;
  user_template: string;
  max_output_tokens: number;
  temperature: number;
  is_active: boolean;
  forked_from_key: string | null;
  forked_from_name: string | null;
  source_updated: boolean;
  portable: PortableSkill;
}

interface Resp {
  can_author: boolean;
  quota: { used: number; max: number };
  skills: MySkill[];
  forkable: Array<{ key: string; name: string; icon: string; description: string }>;
  meta: {
    triggers: string[];
    modes: string[];
    variables: Array<{ name: string; desc: string }>;
  };
}

const MODE_LABEL: Record<string, string> = {
  image_t2i: "文生图",
  image_i2i: "图生图",
  image_edit: "图片编辑",
  video_t2v: "文生视频",
  video_i2v: "图生视频",
};

export default function MySkillsPage() {
  const t = useTranslations("Skills");
  const { toast } = useApp();
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [forking, setForking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Resp>("/api/skills/mine"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("failed"), true);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, okMsg?: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        if (okMsg) toast(okMsg);
        await load();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : t("failed"), true);
      } finally {
        setBusy(false);
      }
    },
    [busy, load, t, toast]
  );

  function download(skill: MySkill) {
    /* 用 Blob 而不是 data: URI——技能提示词可能有几千字，URL 长度是有上限的 */
    const blob = new Blob([JSON.stringify(skill.portable, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = portableFileName(skill.name);
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) return <p className="p-6 text-sm text-ink-subtle">…</p>;

  if (!data.can_author) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm leading-relaxed text-ink-muted">{t("noAccess")}</p>
      </div>
    );
  }

  const full = data.quota.used >= data.quota.max;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <span className="text-xs text-ink-subtle">
          {t("quota", { used: data.quota.used, max: data.quota.max })}
        </span>
      </div>
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">{t("subtitle")}</p>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || full}
          onClick={() => void run(() => api("/api/skills/mine", { method: "POST", body: JSON.stringify({ from: "blank" }) }))}
          className="rounded-2xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("createBlank")}
        </button>
        <button
          type="button"
          disabled={busy || full}
          onClick={() => setForking((v) => !v)}
          className="rounded-2xl border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          {t("createFork")}
        </button>
        <button
          type="button"
          disabled={busy || full}
          onClick={() => setImporting((v) => !v)}
          className="rounded-2xl border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          {t("createImport")}
        </button>
      </div>

      {forking && (
        <div className="mb-5 rounded-3xl border border-line bg-surface p-4">
          <p className="mb-1 text-sm font-semibold">{t("forkPick")}</p>
          <p className="mb-3 text-xs leading-relaxed text-ink-subtle">{t("forkNote")}</p>
          <div className="flex flex-wrap gap-2">
            {data.forkable.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={busy}
                title={o.description}
                onClick={() =>
                  void run(async () => {
                    await api("/api/skills/mine", {
                      method: "POST",
                      body: JSON.stringify({ from: "fork", key: o.key }),
                    });
                    setForking(false);
                  })
                }
                className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                {o.icon && <i className={`fas ${o.icon} text-[12px]`} />}
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {importing && (
        <div className="mb-5 rounded-3xl border border-line bg-surface p-4">
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t("importHint")}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-orange-500/60"
          />
          <button
            type="button"
            disabled={busy || !importText.trim()}
            onClick={() => {
              let payload: unknown;
              try {
                payload = JSON.parse(importText);
              } catch {
                toast(t("importBad"), true);
                return;
              }
              void run(async () => {
                await api("/api/skills/mine", {
                  method: "POST",
                  body: JSON.stringify({ from: "import", payload }),
                });
                setImportText("");
                setImporting(false);
              });
            }}
            className="mt-2 rounded-xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("createImport")}
          </button>
        </div>
      )}

      <details className="mb-5 rounded-3xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm text-ink-muted">{t("variables")}</summary>
        <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {data.meta.variables.map((v) => (
            <div key={v.name} className="text-xs">
              <code className="font-mono text-ink">{`{{${v.name}}}`}</code>
              <span className="ml-2 text-ink-subtle">{v.desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
          {t("variablesNote", { section: "{{#context_before}}…{{/context_before}}" })}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{t("envelopeNote")}</p>
      </details>

      {data.skills.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {data.skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              modes={data.meta.modes}
              busy={busy}
              onExport={() => download(skill)}
              onPatch={(body, msg) =>
                void run(
                  () =>
                    api(`/api/skills/mine/${skill.id}`, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    }),
                  msg
                )
              }
              onDelete={() => {
                if (!confirm(t("removeConfirm"))) return;
                void run(() => api(`/api/skills/mine/${skill.id}`, { method: "DELETE" }));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  modes,
  busy,
  onPatch,
  onExport,
  onDelete,
}: {
  skill: MySkill;
  modes: string[];
  busy: boolean;
  onPatch(body: Record<string, unknown>, msg?: string): void;
  onExport(): void;
  onDelete(): void;
}) {
  const t = useTranslations("Skills");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: skill.name,
    icon: skill.icon,
    description: skill.description,
    triggers: skill.triggers,
    modes: skill.modes,
    system_prompt: skill.system_prompt,
    user_template: skill.user_template,
    temperature: String(skill.temperature),
    max_output_tokens: String(skill.max_output_tokens),
  });

  const triggerLabel: Record<string, string> = {
    selection: t("triggerSelection"),
    manual: t("triggerManual"),
  };

  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {skill.icon && <i className={`fas ${skill.icon} w-4 text-center text-xs text-ink-muted`} />}
        <span className="text-sm font-semibold">{skill.name}</span>
        {skill.triggers.map((x) => (
          <span key={x} className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] text-ink-muted">
            {triggerLabel[x] ?? x}
          </span>
        ))}
        {skill.modes.length > 0 && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-700">
            {skill.modes.map((m) => MODE_LABEL[m] ?? m).join(" / ")}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPatch({ is_active: !skill.is_active })}
            className={`rounded-xl border border-line px-3 py-1.5 text-xs ${
              skill.is_active ? "text-emerald-700" : "text-ink-subtle"
            }`}
          >
            {skill.is_active ? t("enabled") : t("disabled")}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-xl border border-line px-3 py-1.5 text-xs"
          >
            {open ? t("collapse") : t("edit")}
          </button>
        </div>
      </div>

      {skill.source_updated && (
        /* 只提示，**不自动合并**——用户已经改过自己这份，合并只能靠猜 */
        <div className="mt-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          {t("sourceUpdated", { name: skill.forked_from_name ?? skill.forked_from_key ?? "" })}
          <br />
          {t("sourceUpdatedHint")}
          <button
            type="button"
            disabled={busy}
            onClick={() => onPatch({ acknowledge_source: true })}
            className="ml-2 underline"
          >
            {t("acknowledge")}
          </button>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t("fieldName")}>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60"
              />
            </Field>
            <Field label={t("fieldIcon")}>
              <input
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-orange-500/60"
              />
            </Field>
          </div>

          <Field label={t("fieldDescription")}>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60"
            />
          </Field>

          <Field label={t("fieldTriggers")}>
            <div className="flex flex-wrap gap-3">
              {(["selection", "manual"] as const).map((x) => (
                <label key={x} className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={draft.triggers.includes(x)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        triggers: e.target.checked
                          ? [...draft.triggers, x]
                          : draft.triggers.filter((y) => y !== x),
                      })
                    }
                  />
                  {triggerLabel[x]}
                </label>
              ))}
            </div>
          </Field>

          <Field label={t("fieldModes")}>
            <div className="flex flex-wrap gap-3">
              {modes.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={draft.modes.includes(m)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        modes: e.target.checked
                          ? [...draft.modes, m]
                          : draft.modes.filter((y) => y !== m),
                      })
                    }
                  />
                  {MODE_LABEL[m] ?? m}
                </label>
              ))}
            </div>
          </Field>

          <Field label={t("fieldSystem")}>
            <textarea
              rows={5}
              value={draft.system_prompt}
              onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-orange-500/60"
            />
          </Field>

          <Field label={t("fieldTemplate")}>
            <textarea
              rows={6}
              value={draft.user_template}
              onChange={(e) => setDraft({ ...draft, user_template: e.target.value })}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-orange-500/60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label={t("fieldTemperature")}>
              <input
                value={draft.temperature}
                onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-orange-500/60"
              />
            </Field>
            <Field label={t("fieldMaxTokens")}>
              <input
                value={draft.max_output_tokens}
                onChange={(e) => setDraft({ ...draft, max_output_tokens: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-orange-500/60"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || draft.triggers.length === 0}
              onClick={() =>
                onPatch(
                  {
                    name: draft.name,
                    icon: draft.icon,
                    description: draft.description,
                    triggers: draft.triggers,
                    modes: draft.modes,
                    system_prompt: draft.system_prompt,
                    user_template: draft.user_template,
                    temperature: Number(draft.temperature),
                    max_output_tokens: Number(draft.max_output_tokens),
                  },
                  t("saved")
                )
              }
              className="rounded-xl bg-orange-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={onExport}
              className="rounded-xl border border-line px-4 py-2 text-xs"
            >
              {t("export")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-xl border border-line px-4 py-2 text-xs text-red-700 disabled:opacity-50"
            >
              {t("remove")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-ink-subtle">{label}</div>
      {children}
    </div>
  );
}
