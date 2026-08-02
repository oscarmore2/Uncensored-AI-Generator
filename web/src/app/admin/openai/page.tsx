"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface Account {
  id: number;
  label: string;
  api_key_mask: string;
  base_url: string | null;
  moderation_model: string | null;
  is_active: boolean;
  created_at: string;
}

interface ListResp {
  accounts: Account[];
  defaults: { base_url: string; moderation_model: string };
  env_fallback: { configured: boolean; api_key_mask: string | null; in_use: boolean };
  note: string;
}

export default function AdminOpenAiPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    label: "",
    api_key: "",
    base_url: "",
    moderation_model: "",
    activate: true,
    verify: true,
  });

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/openai-accounts"));
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
      const resp = (await fn()) as { warning?: string } | undefined;
      setMsg(resp?.warning ? `${okMsg}（校验警告：${resp.warning}）` : okMsg);
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
        <h1 className="text-3xl font-bold tracking-tighter mb-1">内容审查 · OpenAI</h1>
        <p className="text-ink-muted text-sm">
          提示词与图像审查的主力分类器；Key 加密保存，同一时间只有一个账户生效
        </p>
      </div>

      {data?.note && (
        <div className="glass rounded-3xl p-4 mb-5 text-xs text-ink-muted leading-relaxed">
          <i className="fas fa-circle-info mr-1.5 text-sky-700" />
          {data.note}
        </div>
      )}

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      {data?.env_fallback.configured && (
        <div className="glass rounded-2xl p-4 mb-5 text-sm flex flex-wrap items-center gap-2">
          <span className="text-ink-muted">环境变量 OPENAI_API_KEY：</span>
          <code className="font-mono text-ink-muted">{data.env_fallback.api_key_mask}</code>
          {data.env_fallback.in_use ? (
            <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-700 rounded-full">
              当前生效（无激活账户时的兜底）
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 bg-black/[0.06] text-ink-muted rounded-full">
              已被下方激活账户覆盖
            </span>
          )}
        </div>
      )}

      <form
        className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void action(
            () =>
              api("/api/admin/openai-accounts", {
                method: "POST",
                body: JSON.stringify({
                  label: form.label,
                  api_key: form.api_key,
                  base_url: form.base_url.trim() || null,
                  moderation_model: form.moderation_model.trim() || null,
                  activate: form.activate,
                  verify: form.verify,
                }),
              }).then((r) => {
                setForm({
                  label: "",
                  api_key: "",
                  base_url: "",
                  moderation_model: "",
                  activate: true,
                  verify: true,
                });
                return r;
              }),
            "账户已添加"
          );
        }}
      >
        <input
          required
          placeholder="备注名（如 主账户）"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-500/60"
        />
        <input
          required
          type="password"
          placeholder="API Key（sk-…）"
          value={form.api_key}
          onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-sky-500/60"
        />
        <input
          placeholder={`Base URL（留空用 ${data?.defaults.base_url ?? "官方"}）`}
          value={form.base_url}
          onChange={(e) => setForm({ ...form, base_url: e.target.value })}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-sky-500/60"
        />
        <input
          placeholder={`审查模型（留空用 ${data?.defaults.moderation_model ?? "omni-moderation-latest"}）`}
          value={form.moderation_model}
          onChange={(e) => setForm({ ...form, moderation_model: e.target.value })}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-sky-500/60"
        />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={form.activate}
            onChange={(e) => setForm({ ...form, activate: e.target.checked })}
          />
          保存后立即激活
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={form.verify}
            onChange={(e) => setForm({ ...form, verify: e.target.checked })}
          />
          保存前先测试连通性
        </label>
        <button
          type="submit"
          disabled={busy}
          className="md:col-span-2 px-4 py-2.5 text-sm font-semibold bg-sky-600 hover:bg-sky-500 rounded-2xl disabled:opacity-50"
        >
          添加账户
        </button>
      </form>

      <div className="space-y-2">
        {(data?.accounts ?? []).map((a) => (
          <div
            key={a.id}
            className={`glass rounded-2xl p-4 flex flex-wrap items-center gap-3 ${
              a.is_active ? "ring-1 ring-sky-500/40" : ""
            }`}
          >
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium flex items-center gap-2">
                {a.label}
                {a.is_active && (
                  <span className="text-[10px] px-2 py-0.5 bg-sky-500/20 text-sky-700 rounded-full">
                    生效中
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-ink-subtle mt-0.5">{a.api_key_mask}</div>
              <div className="text-[11px] text-ink-subtle mt-0.5">
                {a.base_url || data?.defaults.base_url} ·{" "}
                {a.moderation_model || data?.defaults.moderation_model}
              </div>
            </div>

            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-line rounded-xl"
              onClick={() =>
                action(
                  () => api(`/api/admin/openai-accounts/${a.id}/test`, { method: "POST" }),
                  "连接正常"
                )
              }
            >
              测试
            </button>
            {!a.is_active && (
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-sky-500/30 text-sky-700 rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/openai-accounts/${a.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ activate: true }),
                      }),
                    "已激活"
                  )
                }
              >
                激活
              </button>
            )}
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-line rounded-xl"
              onClick={() => {
                const key = prompt("输入新的 API Key（留空取消）");
                if (!key?.trim()) return;
                void action(
                  () =>
                    api(`/api/admin/openai-accounts/${a.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ api_key: key.trim() }),
                    }),
                  "Key 已更新"
                );
              }}
            >
              换 Key
            </button>
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
              onClick={() => {
                if (!confirm(`删除「${a.label}」？`)) return;
                void action(
                  () => api(`/api/admin/openai-accounts/${a.id}`, { method: "DELETE" }),
                  "已删除"
                );
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {data && data.accounts.length === 0 && (
        <p className="text-ink-subtle text-sm mt-6">
          尚未添加账户。未配置时内容审查会降级到 HF LLM；两者都不可用则仅依赖本地正则。
        </p>
      )}
    </div>
  );
}
