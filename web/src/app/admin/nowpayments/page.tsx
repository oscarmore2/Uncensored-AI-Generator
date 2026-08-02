"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface NowPaymentsAccount {
  id: number;
  label: string;
  api_key_mask: string;
  ipn_secret_mask: string;
  base_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  accounts: NowPaymentsAccount[];
  env_fallback: {
    configured: boolean;
    api_key_mask: string | null;
    ipn_secret_configured: boolean;
    base_url: string;
    in_use: boolean;
  };
  webhook_url: string;
}

type FormState = {
  label: string;
  api_key: string;
  ipn_secret: string;
  base_url: string;
  activate: boolean;
};

const EMPTY_FORM: FormState = {
  label: "",
  api_key: "",
  ipn_secret: "",
  base_url: "https://api.nowpayments.io/v1",
  activate: true,
};

export default function AdminNowPaymentsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<ListResponse>("/api/admin/nowpayments-accounts"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(task: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setMessage("");
  }

  function openEdit(account: NowPaymentsAccount) {
    setEditingId(account.id);
    setForm({
      label: account.label,
      api_key: "",
      ipn_secret: "",
      base_url: account.base_url,
      activate: account.is_active,
    });
    setFormOpen(true);
    setMessage("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await action(async () => {
      if (editingId) {
        await api(`/api/admin/nowpayments-accounts/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            label: form.label.trim(),
            base_url: form.base_url.trim(),
            activate: form.activate,
            ...(form.api_key.trim() ? { api_key: form.api_key.trim() } : {}),
            ...(form.ipn_secret.trim()
              ? { ipn_secret: form.ipn_secret.trim() }
              : {}),
          }),
        });
      } else {
        await api("/api/admin/nowpayments-accounts", {
          method: "POST",
          body: JSON.stringify({
            label: form.label.trim(),
            api_key: form.api_key.trim(),
            ipn_secret: form.ipn_secret.trim(),
            base_url: form.base_url.trim(),
            activate: form.activate,
          }),
        });
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    }, editingId ? "NOWPayments 配置已更新" : "NOWPayments 配置已添加");
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-3xl font-bold tracking-tighter">NOWPayments</h1>
          <p className="text-sm text-ink-muted">
            数据库激活配置优先；无激活配置时才使用环境变量兜底
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-semibold hover:bg-orange-500 text-white"
        >
          <i className="fas fa-plus mr-2" />
          添加配置
        </button>
      </div>

      {message && <p className="mb-4 text-sm text-amber-800">{message}</p>}

      {data?.env_fallback && (
        <div className={`glass mb-6 rounded-3xl p-5 ${data.env_fallback.in_use ? "border border-amber-500/30" : ""}`}>
          <div className="font-semibold">ENV 兜底配置</div>
          <p className="mt-1 text-xs text-ink-subtle">
            {data.env_fallback.configured
              ? `API Key ${data.env_fallback.api_key_mask} · IPN Secret 已设置 · ${data.env_fallback.base_url}`
              : "API Key 或 IPN Secret 未完整配置"}
            {data.env_fallback.in_use
              ? " · 当前正在使用 ENV"
              : " · 有激活数据库配置时不会用于创建订单"}
          </p>
        </div>
      )}

      <div className="glass mb-6 rounded-3xl p-5 text-xs text-ink-muted">
        <p>
          IPN 回调：
          <code className="ml-2 break-all text-teal-700">{data?.webhook_url ?? "加载中…"}</code>
        </p>
        <p className="mt-2">
          API Key 与 IPN Secret 会使用 AUTH_SECRET 派生的 AES-256-GCM 密钥加密后保存。切换配置后，
          Webhook 仍会尝试所有已保存配置和 ENV 兜底 Secret，避免旧订单无法验签。
        </p>
        <p className="mt-2">
          若旧配置仍有未完成订单，请新增并激活另一配置；系统会阻止直接覆盖旧 IPN Secret 或删除关联配置。
        </p>
      </div>

      {formOpen && (
        <form onSubmit={submit} className="glass modal-pop mb-8 rounded-3xl p-6">
          <h2 className="mb-4 font-bold">{editingId ? "编辑配置" : "添加配置"}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-ink-muted">备注名</span>
              <input
                required
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="例如：主商户账户"
                className="w-full rounded-2xl border border-line bg-surface px-3 py-2.5 text-sm"
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-ink-muted">
                API Key {editingId ? "（留空表示不修改）" : ""}
              </span>
              <input
                required={!editingId}
                type="password"
                value={form.api_key}
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                className="w-full rounded-2xl border border-line bg-surface px-3 py-2.5 font-mono text-sm"
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-ink-muted">
                IPN Secret {editingId ? "（留空表示不修改）" : ""}
              </span>
              <input
                required={!editingId}
                type="password"
                value={form.ipn_secret}
                onChange={(event) => setForm({ ...form, ipn_secret: event.target.value })}
                className="w-full rounded-2xl border border-line bg-surface px-3 py-2.5 font-mono text-sm"
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-ink-muted">API Base URL</span>
              <input
                required
                type="url"
                value={form.base_url}
                onChange={(event) => setForm({ ...form, base_url: event.target.value })}
                className="w-full rounded-2xl border border-line bg-surface px-3 py-2.5 font-mono text-sm"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted md:col-span-2">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(event) => setForm({ ...form, activate: event.target.checked })}
              />
              激活此配置用于新订单
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-orange-600 px-6 py-2.5 text-sm font-semibold disabled:opacity-50 text-white"
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-2xl border border-line px-6 py-2.5 text-sm"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {data?.accounts.map((account) => (
          <div
            key={account.id}
            className={`glass flex flex-wrap items-center gap-4 rounded-3xl p-5 ${
              account.is_active ? "ring-1 ring-emerald-500/40" : ""
            }`}
          >
            <div className="min-w-[260px] flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{account.label}</span>
                {account.is_active && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700">
                    激活中
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-ink-subtle">
                API {account.api_key_mask} · IPN {account.ipn_secret_mask}
              </div>
              <div className="mt-1 break-all font-mono text-[10px] text-ink-subtle">
                {account.base_url}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(
                    () =>
                      api(`/api/admin/nowpayments-accounts/${account.id}/test`, {
                        method: "POST",
                      }),
                    "API Key 测试通过"
                  )
                }
                className="rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-50"
              >
                测试
              </button>
              {!account.is_active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        api(`/api/admin/nowpayments-accounts/${account.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: true }),
                        }),
                      "配置已激活"
                    )
                  }
                  className="rounded-xl bg-emerald-600/20 px-3 py-2 text-xs text-emerald-700 disabled:opacity-50"
                >
                  激活
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => openEdit(account)}
                className="rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-50"
              >
                编辑
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`删除 NOWPayments 配置「${account.label}」？`)) return;
                  void action(
                    () =>
                      api(`/api/admin/nowpayments-accounts/${account.id}`, {
                        method: "DELETE",
                      }),
                    "配置已删除"
                  );
                }}
                className="rounded-xl bg-red-600/15 px-3 py-2 text-xs text-red-700 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <div className="glass rounded-3xl p-12 text-center text-sm text-ink-subtle">
            暂无数据库配置；添加并激活后即可覆盖 ENV。
          </div>
        )}
      </div>
    </div>
  );
}
