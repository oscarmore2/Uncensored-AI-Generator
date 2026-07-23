"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface WsAcc {
  id: number;
  label: string;
  api_key_mask: string;
  is_active: boolean;
  created_at: string;
}

interface ListResp {
  accounts: WsAcc[];
  defaults: { base_url: string };
  env_fallback: { configured: boolean; api_key_mask: string | null; in_use: boolean };
  note: string;
}

const EMPTY = { label: "", api_key: "", activate: true };

export default function AdminWaveSpeedAccountsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/wavespeed-accounts"));
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
      if (e instanceof Error && e.message === "__warning_already_set__") {
        await load();
      } else {
        setMsg(e instanceof ApiError ? e.message : "操作失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      const resp = await api<{ ok: boolean; warning?: string }>("/api/admin/wavespeed-accounts", {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          api_key: form.api_key.trim(),
          activate: form.activate,
          verify: true,
        }),
      });
      setForm(EMPTY);
      setFormOpen(false);
      if (resp.warning) {
        setMsg(`账户已保存，但连通性校验未通过。详情：${resp.warning}`);
        throw new Error("__warning_already_set__");
      }
    }, "WaveSpeed 账户已添加");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">WaveSpeed</h1>
          <p className="text-gray-400 text-sm">玩物专区 API Key · 同一时间仅一个激活</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/wavespeed/models"
            className="px-5 py-2.5 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl"
          >
            玩物模型库
          </Link>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
          >
            <i className="fas fa-plus mr-2" />
            添加 Key
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      {data?.note && (
        <div className="glass rounded-3xl p-4 mb-6 text-xs text-gray-400">
          <i className="fas fa-circle-info mr-2 text-rose-400" />
          {data.note}
        </div>
      )}

      {data?.env_fallback && (
        <div
          className={`glass rounded-3xl p-4 mb-6 text-sm ${
            data.env_fallback.in_use ? "border border-amber-500/30" : ""
          }`}
        >
          <div className="font-semibold mb-1">.env 兜底</div>
          {data.env_fallback.configured ? (
            <p className="text-gray-400 text-xs">
              Key {data.env_fallback.api_key_mask}
              {data.env_fallback.in_use
                ? " · 当前无激活 DB 账户，走 .env"
                : " · 有激活 DB 账户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-gray-500 text-xs">未配置 WAVESPEED_API_KEY。请添加并激活一个账户。</p>
          )}
          {data.defaults && (
            <p className="text-gray-500 text-[11px] mt-2 font-mono break-all">
              Base: {data.defaults.base_url}
            </p>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8">
          <h2 className="font-bold mb-4">添加 WaveSpeed API Key</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主账户"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">API Key *</label>
              <input
                required
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder="https://wavespeed.ai/accesskey"
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
          <button
            type="submit"
            disabled={busy}
            className="mt-4 px-5 py-2.5 text-sm font-semibold bg-rose-600 rounded-2xl disabled:opacity-50"
          >
            保存
          </button>
        </form>
      )}

      <div className="space-y-3">
        {(data?.accounts ?? []).map((a) => (
          <div key={a.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">
                {a.label}
                {a.is_active && (
                  <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    激活
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 font-mono mt-1">{a.api_key_mask}</div>
            </div>
            {!a.is_active && (
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/wavespeed-accounts/${a.id}`, {
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
            {a.is_active && (
              <button
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
                onClick={() =>
                  action(
                    () =>
                      api(`/api/admin/wavespeed-accounts/${a.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ activate: false }),
                      }),
                    "已停用"
                  )
                }
              >
                停用
              </button>
            )}
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-white/10 rounded-xl"
              onClick={() =>
                action(
                  () => api(`/api/admin/wavespeed-accounts/${a.id}/test`, { method: "POST" }),
                  "连通性正常"
                )
              }
            >
              测试
            </button>
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-red-500/30 text-red-300 rounded-xl"
              onClick={() => {
                if (!window.confirm("确定删除该账户？")) return;
                void action(
                  () => api(`/api/admin/wavespeed-accounts/${a.id}`, { method: "DELETE" }),
                  "已删除"
                );
              }}
            >
              删除
            </button>
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <p className="text-gray-500 text-sm">暂无账户，请添加 Key 或配置 .env</p>
        )}
      </div>
    </div>
  );
}
