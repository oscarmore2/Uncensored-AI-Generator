"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface StripeAcc {
  id: number;
  label: string;
  publishable_key: string | null;
  secret_key_mask: string;
  webhook_secret_mask: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResp {
  accounts: StripeAcc[];
  env_fallback: {
    configured: boolean;
    webhook_configured: boolean;
    secret_key_mask: string | null;
    in_use: boolean;
  };
}

const EMPTY = {
  label: "",
  secret_key: "",
  webhook_secret: "",
  publishable_key: "",
  activate: true,
};

export default function AdminStripeAccountsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/stripe-accounts"));
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

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      await api("/api/admin/stripe-accounts", {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          secret_key: form.secret_key.trim(),
          webhook_secret: form.webhook_secret.trim(),
          publishable_key: form.publishable_key.trim() || null,
          activate: form.activate,
        }),
      });
      setForm(EMPTY);
      setFormOpen(false);
    }, "Stripe 账户已添加");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">Stripe 账户</h1>
          <p className="text-gray-400 text-sm">
            Secret Key + Webhook Secret 成对管理；同一时间仅一个账户激活用于收款
          </p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
        >
          <i className="fas fa-plus mr-2" />
          添加账户
        </button>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      {data?.env_fallback && (
        <div
          className={`glass rounded-3xl p-4 mb-6 text-sm ${
            data.env_fallback.in_use ? "border border-amber-500/30" : ""
          }`}
        >
          <div className="font-semibold mb-1">.env 兜底配置</div>
          {data.env_fallback.configured ? (
            <p className="text-gray-400 text-xs">
              Secret {data.env_fallback.secret_key_mask}
              {data.env_fallback.webhook_configured ? " · Webhook Secret 已配置" : " · Webhook Secret 未配置"}
              {data.env_fallback.in_use
                ? " · 当前无激活 DB 账户，支付正在使用 .env 凭证"
                : " · 有激活 DB 账户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-gray-500 text-xs">未配置。添加并激活一个 DB 账户后即可用 Stripe 收款（需 DEMO_MODE=false）。</p>
          )}
        </div>
      )}

      <div className="glass rounded-3xl p-4 mb-6 text-xs text-gray-400 space-y-1">
        <p>
          <i className="fas fa-circle-info mr-2 text-rose-400" />
          在 Stripe Dashboard → Developers → API keys 获取 Secret Key；在 Webhooks 添加端点{" "}
          <code className="text-gray-300">/api/payments/webhook</code>，事件选{" "}
          <code className="text-gray-300">checkout.session.completed</code>，复制 Signing secret（whsec_…）。
        </p>
        <p>生产环境请将 <code className="text-gray-300">DEMO_MODE=false</code>，否则充值会走本地模拟入账。</p>
      </div>

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8 modal-pop">
          <h2 className="font-bold mb-4">添加 Stripe 账户</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主账户 / 美国站"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Secret Key *（sk_…）</label>
              <input
                required
                type="password"
                value={form.secret_key}
                onChange={(e) => setForm({ ...form, secret_key: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Webhook Signing Secret *（whsec_…）</label>
              <input
                required
                type="password"
                value={form.webhook_secret}
                onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Publishable Key（选填，pk_…）</label>
              <input
                value={form.publishable_key}
                onChange={(e) => setForm({ ...form, publishable_key: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <label className="flex items-center gap-x-2 text-sm text-gray-300 cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              <span>添加后立即激活（会停用其他已激活账户）</span>
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
            >
              {busy ? "保存中..." : "确认添加"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-6 py-2.5 text-sm border border-white/10 rounded-2xl hover:bg-white/5"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {data?.accounts.map((a) => (
          <div
            key={a.id}
            className={`glass rounded-3xl p-5 flex flex-wrap items-center gap-4 ${
              a.is_active ? "ring-1 ring-emerald-500/40" : ""
            }`}
          >
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">{a.label}</span>
                {a.is_active ? (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">激活中</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 bg-white/10 text-gray-400 rounded-full">未激活</span>
                )}
              </div>
              <div className="text-xs font-mono text-gray-400">Secret: {a.secret_key_mask}</div>
              <div className="text-xs font-mono text-gray-500">Webhook: {a.webhook_secret_mask}</div>
              {a.publishable_key && (
                <div className="text-xs font-mono text-gray-500 truncate max-w-md">pk: {a.publishable_key}</div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {!a.is_active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/stripe-accounts/${a.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: true }),
                        }),
                      `已激活「${a.label}」`
                    )
                  }
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-xl disabled:opacity-50"
                >
                  激活
                </button>
              )}
              {a.is_active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/stripe-accounts/${a.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: false }),
                        }),
                      `已停用「${a.label}」（将回退 .env）`
                    )
                  }
                  className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                >
                  停用
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  const key = window.prompt("输入新的 Secret Key（sk_…，留空取消）:");
                  if (!key?.trim()) return;
                  void action(
                    () =>
                      api(`/api/admin/stripe-accounts/${a.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ secret_key: key.trim() }),
                      }),
                    "Secret Key 已更新"
                  );
                }}
                className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
              >
                换 Secret
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const key = window.prompt("输入新的 Webhook Secret（whsec_…，留空取消）:");
                  if (!key?.trim()) return;
                  void action(
                    () =>
                      api(`/api/admin/stripe-accounts/${a.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ webhook_secret: key.trim() }),
                      }),
                    "Webhook Secret 已更新"
                  );
                }}
                className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
              >
                换 Webhook
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`确定删除账户「${a.label}」？关联流水保留，账户引用会被清空。`)) return;
                  void action(
                    () => api(`/api/admin/stripe-accounts/${a.id}`, { method: "DELETE" }),
                    `已删除「${a.label}」`
                  );
                }}
                className="px-4 py-2 text-xs bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 rounded-xl disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <div className="glass rounded-3xl p-12 text-center text-gray-500">
            尚未添加 DB 账户。可添加一组后激活，或继续使用 .env 中的凭证。
          </div>
        )}
      </div>
    </div>
  );
}
