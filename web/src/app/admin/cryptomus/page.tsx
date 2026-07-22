"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface Merchant {
  id: number;
  label: string;
  merchant_id: string;
  api_key_mask: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResp {
  merchants: Merchant[];
  env_fallback: {
    configured: boolean;
    merchant_id_mask: string | null;
    in_use: boolean;
  };
}

const EMPTY = { label: "", merchant_id: "", payment_api_key: "", activate: true };

export default function AdminCryptomusMerchantsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/cryptomus-merchants"));
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
      await api("/api/admin/cryptomus-merchants", {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          merchant_id: form.merchant_id.trim(),
          payment_api_key: form.payment_api_key.trim(),
          activate: form.activate,
        }),
      });
      setForm(EMPTY);
      setFormOpen(false);
    }, "商户已添加");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">Cryptomus 商户</h1>
          <p className="text-gray-400 text-sm">
            Merchant ID 与 Payment API Key 一一对应；同一时间仅一个商户处于激活状态用于收款
          </p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
        >
          <i className="fas fa-plus mr-2" />
          添加商户
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
              已配置 Merchant {data.env_fallback.merchant_id_mask}
              {data.env_fallback.in_use
                ? " · 当前无激活 DB 商户，支付正在使用 .env 凭证"
                : " · 有激活 DB 商户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-gray-500 text-xs">未配置。添加并激活一个 DB 商户后即可收款。</p>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8 modal-pop">
          <h2 className="font-bold mb-4">添加 Cryptomus 商户</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主商户"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Merchant ID *</label>
              <input
                required
                value={form.merchant_id}
                onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Payment API Key *</label>
              <input
                required
                type="password"
                value={form.payment_api_key}
                onChange={(e) => setForm({ ...form, payment_api_key: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
              <p className="text-[10px] text-gray-500 mt-1">密钥会用 AUTH_SECRET 加密后存库，列表仅显示掩码</p>
            </div>
            <label className="flex items-center gap-x-2 text-sm text-gray-300 cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              <span>添加后立即激活（会停用其他已激活商户）</span>
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
        {data?.merchants.map((m) => (
          <div
            key={m.id}
            className={`glass rounded-3xl p-5 flex flex-wrap items-center gap-4 ${
              m.is_active ? "ring-1 ring-emerald-500/40" : ""
            }`}
          >
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">{m.label}</span>
                {m.is_active ? (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">激活中</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 bg-white/10 text-gray-400 rounded-full">未激活</span>
                )}
              </div>
              <div className="text-xs font-mono text-gray-400">Merchant: {m.merchant_id}</div>
              <div className="text-xs font-mono text-gray-500">API Key: {m.api_key_mask}</div>
            </div>
            <div className="flex gap-2">
              {!m.is_active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/cryptomus-merchants/${m.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: true }),
                        }),
                      `已激活「${m.label}」`
                    )
                  }
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-xl disabled:opacity-50"
                >
                  激活
                </button>
              )}
              {m.is_active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/cryptomus-merchants/${m.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: false }),
                        }),
                      `已停用「${m.label}」（将回退 .env）`
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
                  const key = window.prompt("输入新的 Payment API Key（留空取消）:");
                  if (!key?.trim()) return;
                  void action(
                    () =>
                      api(`/api/admin/cryptomus-merchants/${m.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ payment_api_key: key.trim() }),
                      }),
                    "API Key 已更新"
                  );
                }}
                className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
              >
                换 Key
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`确定删除商户「${m.label}」？关联订单保留，商户引用会被清空。`)) return;
                  void action(
                    () => api(`/api/admin/cryptomus-merchants/${m.id}`, { method: "DELETE" }),
                    `已删除「${m.label}」`
                  );
                }}
                className="px-4 py-2 text-xs bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 rounded-xl disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {data && data.merchants.length === 0 && (
          <div className="glass rounded-3xl p-12 text-center text-gray-500">
            尚未添加 DB 商户。可添加一组后激活，或继续使用 .env 中的凭证。
          </div>
        )}
      </div>
    </div>
  );
}
