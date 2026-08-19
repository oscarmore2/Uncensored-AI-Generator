"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { CANONICAL_SAMPLE, renderPromptRefs } from "@/lib/model-ref-syntax";

/**
 * 各家模型的媒体引用语法。
 *
 * 提示词里存的是规范形式（@Image1 / @Video1 / @Audio1），提交上游前按这里的
 * 规则改写。匹配不到任何一行就原样透传——所以这张表是空的时候，行为与
 * 接入这套机制之前完全一致。
 */

type Rule = {
  id: number;
  label: string;
  match_model_id: string;
  provider: string | null;
  image_format: string;
  video_format: string;
  audio_format: string;
  enabled: boolean;
  sort_order: number;
};

type Form = Omit<Rule, "id">;

const BLANK: Form = {
  label: "",
  match_model_id: "",
  provider: null,
  image_format: "@image{n}",
  video_format: "@video{n}",
  audio_format: "@audio{n}",
  enabled: true,
  sort_order: 0,
};

/** 已经确认过的写法，一键填入省得手打错 */
const PRESETS: { name: string; note: string; form: Partial<Form> }[] = [
  {
    name: "Seedance",
    note: "schema 原话：Cite reference inputs in submission order with @-syntax",
    form: {
      label: "Seedance",
      match_model_id: "seedance",
      image_format: "@image{n}",
      video_format: "@video{n}",
      audio_format: "@audio{n}",
      sort_order: 10,
    },
  },
  {
    name: "Wan 2.x",
    note: '文档原话：Use labels like "character1" and "character2" to map reference materials to characters',
    form: {
      label: "Wan 2.x（参考生视频）",
      match_model_id: "wan",
      image_format: "character{n}",
      video_format: "character{n}",
      audio_format: "",
      sort_order: 20,
    },
  },
  {
    name: "兜底：删掉引用",
    note: "只认数组顺序的模型。留着它不认识的记号会被当成正文读进去",
    form: {
      label: "兜底：删掉引用",
      match_model_id: "",
      image_format: "",
      video_format: "",
      audio_format: "",
      sort_order: 9000,
    },
  },
];

export default function RefSyntaxPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<Form>(BLANK);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await api<Rule[]>("/api/admin/ref-syntax"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body = JSON.stringify(form);
      if (editingId === null) {
        await api("/api/admin/ref-syntax", { method: "POST", body });
      } else {
        await api(`/api/admin/ref-syntax/${editingId}`, { method: "PATCH", body });
      }
      setForm(BLANK);
      setEditingId(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }, [editingId, form, load]);

  const remove = useCallback(
    async (id: number) => {
      if (!window.confirm("删除这条规则？")) return;
      try {
        await api(`/api/admin/ref-syntax/${id}`, { method: "DELETE" });
        await load();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "删除失败");
      }
    },
    [load]
  );

  const preview = renderPromptRefs(CANONICAL_SAMPLE, {
    matchModelId: form.match_model_id,
    provider: form.provider,
    imageFormat: form.image_format,
    videoFormat: form.video_format,
    audioFormat: form.audio_format,
  });

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">媒体引用语法</h1>
      <p className="mb-6 text-sm text-ink-muted">
        提示词里存的是规范形式 <code className="rounded bg-black/[0.05] px-1">@Image1</code>，
        提交上游前按这里的规则改写。<b>匹配不到任何一行就原样透传</b>，
        所以这张表空着时行为与接入前完全一致。
      </p>

      {msg && (
        <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {msg}
        </div>
      )}

      <div className="mb-6 rounded-3xl border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{editingId === null ? "新增规则" : `编辑 #${editingId}`}</span>
          <span className="text-xs text-ink-subtle">一键填入：</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.note}
              onClick={() => {
                setForm({ ...BLANK, ...p.form });
                setEditingId(null);
              }}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] hover:border-orange-500/40"
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="名称" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <Field
            label="匹配 modelId（子串，留空=兜底）"
            value={form.match_model_id}
            onChange={(v) => setForm({ ...form, match_model_id: v })}
            placeholder="wan"
          />
          <Field
            label="限定渠道（留空=不限）"
            value={form.provider ?? ""}
            onChange={(v) => setForm({ ...form, provider: v || null })}
            placeholder="atlas"
          />
          <Field
            label="排序（越小越先匹配）"
            value={String(form.sort_order)}
            onChange={(v) => setForm({ ...form, sort_order: Number(v) || 0 })}
          />
          <Field
            label="图片写法（{n}=序号，留空=删掉引用）"
            value={form.image_format}
            onChange={(v) => setForm({ ...form, image_format: v })}
            placeholder="character{n}"
          />
          <Field
            label="视频写法"
            value={form.video_format}
            onChange={(v) => setForm({ ...form, video_format: v })}
          />
          <Field
            label="音频写法"
            value={form.audio_format}
            onChange={(v) => setForm({ ...form, audio_format: v })}
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用
          </label>
        </div>

        <div className="mt-4 rounded-2xl bg-black/[0.03] p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            实时预览
          </div>
          <div className="font-mono text-xs">
            <div className="text-ink-subtle">{CANONICAL_SAMPLE}</div>
            <div className="mt-1">↓</div>
            <div className="mt-1 text-orange-800">{preview || "（全部删掉）"}</div>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => void submit()}
            disabled={busy || !form.label.trim()}
            className="rounded-2xl bg-orange-700 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            {editingId === null ? "新增" : "保存"}
          </button>
          {editingId !== null && (
            <button
              onClick={() => {
                setForm(BLANK);
                setEditingId(null);
              }}
              className="rounded-2xl border border-line px-5 py-2 text-sm"
            >
              取消
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-subtle">
              <th className="px-4 py-2.5">名称</th>
              <th className="px-4 py-2.5">匹配</th>
              <th className="px-4 py-2.5">图 / 视频 / 音频</th>
              <th className="px-4 py-2.5">排序</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-subtle">
                  还没有规则——当前所有模型都按原样透传
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    {r.label}
                    {!r.enabled && <span className="ml-2 text-[10px] text-ink-subtle">已停用</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.match_model_id || <span className="text-ink-subtle">兜底</span>}
                    {r.provider && <span className="ml-1 text-ink-subtle">@{r.provider}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {[r.image_format, r.video_format, r.audio_format]
                      .map((f) => f || "（删）")
                      .join(" / ")}
                  </td>
                  <td className="px-4 py-3">{r.sort_order}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setForm({ ...r });
                        setEditingId(r.id);
                      }}
                      className="mr-3 text-xs text-orange-700"
                    >
                      编辑
                    </button>
                    <button onClick={() => void remove(r.id)} className="text-xs text-red-700">
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-line bg-stage px-3 py-2 text-sm outline-none focus:border-orange-500/50"
      />
    </label>
  );
}
