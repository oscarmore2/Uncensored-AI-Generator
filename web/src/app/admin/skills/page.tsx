"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

/**
 * 官方技能。
 *
 * 这一页最要紧的不是「能改」，而是**改过的地方看得见**：
 * 提示词随版本升级，没被动过的技能会自动跟上，动过的永远停在原地。
 * 运营要是不知道自己改过哪几条，就会遇到「为什么别人的润色变好了我的没有」。
 */

interface Skill {
  id: number;
  key: string;
  name: string;
  name_en: string;
  icon: string;
  description: string;
  triggers: string[];
  modes: string[];
  system_prompt: string;
  user_template: string;
  model_key: string;
  output_mode: string;
  max_output_tokens: number;
  temperature: number;
  requires_vip_rank: number;
  is_active: boolean;
  sort_order: number;
  is_overridden: boolean;
  has_factory: boolean;
  drift: string[];
  factory: { system_prompt: string; user_template: string } | null;
}

interface Resp {
  skills: Skill[];
  meta: {
    triggers: string[];
    implemented_triggers: string[];
    output_modes: string[];
    models: Array<{ key: string; label: string; tier: string; gated: boolean }>;
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

const TRIGGER_LABEL: Record<string, string> = {
  selection: "选中文字",
  manual: "工具栏按钮",
  block: "块菜单",
  slash: "斜杠命令",
  empty: "空编辑器",
  submit: "提交前",
};

const FIELD_LABEL: Record<string, string> = {
  name: "名称",
  nameEn: "英文名",
  icon: "图标",
  description: "说明",
  triggers: "时机",
  modes: "模式",
  systemPrompt: "任务提示词",
  userTemplate: "用户消息模板",
  modelKey: "模型",
  outputMode: "输出方式",
  maxOutputTokens: "输出上限",
  temperature: "温度",
  requiresVipRank: "VIP 门槛",
  sortOrder: "排序",
};

export default function AdminSkillsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Resp>("/api/admin/skills"));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-1">AI 技能</h1>
        <p className="text-ink-muted text-sm">
          技能 = 提示词定义 + 模型选择 + 时机绑定。不能跑代码、不能联网、不能调工具
        </p>
      </div>

      <div className="glass rounded-3xl p-4 mb-5 text-xs leading-relaxed text-ink-muted">
        <i className="fas fa-circle-info mr-1.5 text-sky-700" />
        没改过的技能会<strong>随版本升级自动更新提示词</strong>；改过一次之后就停在原地，
        标着「已改」。想重新跟上升级，点「恢复默认」。
        <br />
        任务提示词只写「要做什么」——审查口径和输出格式由平台在前后各包一层，技能改不了。
        <br />
        当前只有「选中文字」这个时机有前端实现，其余勾了也不会触发（S4 才做）。
      </div>

      {data && (
        <details className="glass rounded-3xl p-4 mb-5">
          <summary className="text-sm text-ink-muted cursor-pointer">
            模板里能用的变量（{data.meta.variables.length} 个）
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {data.meta.variables.map((v) => (
              <div key={v.name} className="text-xs">
                <code className="font-mono text-ink">{`{{${v.name}}}`}</code>
                <span className="text-ink-subtle ml-2">{v.desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-subtle">
            条件段 <code className="font-mono">{`{{#context_before}}…{{/context_before}}`}</code>
            ：值为空时整段丢掉。前后文经常是空的，不用它会留下一个孤零零的标题。
            写错的变量名会原样留在提示词里——那是故意的，静默清空的话你要到模型答非所问时才发现。
          </p>
        </details>
      )}

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      <div className="space-y-3">
        {data?.skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            meta={data.meta}
            busy={busy}
            onSave={(body) =>
              action(
                () =>
                  api(`/api/admin/skills/${skill.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(body),
                  }),
                "已保存"
              )
            }
            onRestore={() =>
              action(
                () => api(`/api/admin/skills/${skill.id}/restore`, { method: "POST" }),
                "已恢复出厂设置"
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  meta,
  busy,
  onSave,
  onRestore,
}: {
  skill: Skill;
  meta: Resp["meta"];
  busy: boolean;
  onSave(body: Record<string, unknown>): void;
  onRestore(): void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: skill.name,
    name_en: skill.name_en,
    icon: skill.icon,
    description: skill.description,
    system_prompt: skill.system_prompt,
    user_template: skill.user_template,
    temperature: String(skill.temperature),
    max_output_tokens: String(skill.max_output_tokens),
    sort_order: String(skill.sort_order),
    modes: skill.modes,
    model_key: skill.model_key,
    output_mode: skill.output_mode,
  });

  return (
    <div className="glass rounded-3xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        {skill.icon && <i className={`fas ${skill.icon} text-xs text-ink-muted w-4 text-center`} />}
        <span className="font-semibold text-sm">{skill.name}</span>
        <code className="font-mono text-[11px] text-ink-subtle">{skill.key}</code>
        {skill.triggers.map((t) => (
          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.06] text-ink-muted">
            {TRIGGER_LABEL[t] ?? t}
          </span>
        ))}
        {skill.modes.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700">
            仅 {skill.modes.map((m) => MODE_LABEL[m] ?? m).join(" / ")}
          </span>
        )}
        {skill.is_overridden && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800"
            title={skill.drift.map((f) => FIELD_LABEL[f] ?? f).join("、") || "已停止跟随版本升级"}
          >
            已改{skill.drift.length > 0 && `：${skill.drift.map((f) => FIELD_LABEL[f] ?? f).join("、")}`}
          </span>
        )}
        {!skill.has_factory && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.06] text-ink-subtle">
            当前版本无出厂定义
          </span>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ is_active: !skill.is_active })}
            className={`px-3 py-1.5 text-xs rounded-xl border border-line ${
              skill.is_active ? "text-emerald-700" : "text-ink-subtle"
            }`}
          >
            {skill.is_active ? "启用中" : "已停用"}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="px-3 py-1.5 text-xs rounded-xl border border-line"
          >
            {open ? "收起" : "编辑"}
          </button>
        </div>
      </div>

      {skill.description && !open && (
        <p className="mt-1.5 text-xs text-ink-subtle">{skill.description}</p>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Labeled label="名称">
              <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            </Labeled>
            <Labeled label="英文名">
              <TextInput value={draft.name_en} onChange={(v) => setDraft({ ...draft, name_en: v })} />
            </Labeled>
            <Labeled label="图标（Font Awesome）">
              <TextInput value={draft.icon} onChange={(v) => setDraft({ ...draft, icon: v })} />
            </Labeled>
            <Labeled label="排序">
              <TextInput value={draft.sort_order} onChange={(v) => setDraft({ ...draft, sort_order: v })} />
            </Labeled>
          </div>

          <Labeled label="说明（鼠标悬停时显示）">
            <TextInput
              value={draft.description}
              onChange={(v) => setDraft({ ...draft, description: v })}
            />
          </Labeled>

          <Labeled label="限定模式（都不勾 = 全模式）">
            <div className="flex flex-wrap gap-3">
              {meta.modes.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={draft.modes.includes(m)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        modes: e.target.checked
                          ? [...draft.modes, m]
                          : draft.modes.filter((x) => x !== m),
                      })
                    }
                  />
                  {MODE_LABEL[m] ?? m}
                </label>
              ))}
            </div>
          </Labeled>

          <Labeled label="任务提示词（system）">
            <textarea
              rows={5}
              value={draft.system_prompt}
              onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
              className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-mono leading-relaxed outline-none focus:border-orange-500/60"
            />
          </Labeled>

          <Labeled label="用户消息模板">
            <textarea
              rows={7}
              value={draft.user_template}
              onChange={(e) => setDraft({ ...draft, user_template: e.target.value })}
              className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-mono leading-relaxed outline-none focus:border-orange-500/60"
            />
          </Labeled>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Labeled label="绑定模型">
              <select
                value={draft.model_key}
                onChange={(e) => setDraft({ ...draft, model_key: e.target.value })}
                className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60"
              >
                {meta.models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                    {m.gated ? "（有门槛）" : ""}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="结果怎么落地">
              <select
                value={draft.output_mode}
                onChange={(e) => setDraft({ ...draft, output_mode: e.target.value })}
                className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60"
              >
                <option value="replace">替换正文（给替换 / 插入下方按钮）</option>
                <option value="card">只读（回的不是用来顶替原文的东西）</option>
              </select>
            </Labeled>
          </div>
          <p className="text-[10px] leading-relaxed text-ink-subtle">
            绑定固定模型后，<strong>成人模式下仍会自动改用无限制档</strong>——基础 / 进阶档挂的模型
            会拒答，那比不给这个功能更糟。绑了有门槛的模型时，够不着的用户看不到这条技能。
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Labeled label="温度">
              <TextInput
                value={draft.temperature}
                onChange={(v) => setDraft({ ...draft, temperature: v })}
              />
            </Labeled>
            <Labeled label="输出上限 token">
              <TextInput
                value={draft.max_output_tokens}
                onChange={(v) => setDraft({ ...draft, max_output_tokens: v })}
              />
            </Labeled>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({
                  name: draft.name,
                  name_en: draft.name_en,
                  icon: draft.icon,
                  description: draft.description,
                  system_prompt: draft.system_prompt,
                  user_template: draft.user_template,
                  temperature: Number(draft.temperature),
                  max_output_tokens: Number(draft.max_output_tokens),
                  sort_order: Number(draft.sort_order),
                  modes: draft.modes,
                  model_key: draft.model_key,
                  output_mode: draft.output_mode,
                })
              }
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-orange-700 text-white disabled:opacity-50"
            >
              保存
            </button>
            {skill.has_factory && (
              <button
                type="button"
                disabled={busy || !skill.is_overridden}
                onClick={onRestore}
                className="px-4 py-2 text-xs rounded-xl border border-line disabled:opacity-40"
                title={
                  skill.is_overridden
                    ? "回填出厂值，并重新跟随以后的版本升级"
                    : "没有改动，本来就跟着出厂值"
                }
              >
                恢复默认
              </button>
            )}
          </div>

          {skill.factory && skill.drift.includes("systemPrompt") && (
            <details className="rounded-2xl bg-black/[0.03] p-3">
              <summary className="text-xs text-ink-muted cursor-pointer">出厂的任务提示词</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] font-mono text-ink-subtle">
                {skill.factory.system_prompt}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-ink-subtle mb-1">{label}</div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60"
    />
  );
}
