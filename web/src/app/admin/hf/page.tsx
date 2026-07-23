"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface HfAcc {
  id: number;
  label: string;
  api_token_mask: string;
  base_url: string | null;
  magic_model: string | null;
  is_active: boolean;
  created_at: string;
}

interface ListResp {
  accounts: HfAcc[];
  defaults: { base_url: string; magic_model: string };
  env_fallback: { configured: boolean; api_token_mask: string | null; in_use: boolean };
  note: string;
}

const EMPTY = {
  label: "",
  api_token: "",
  base_url: "",
  magic_model: "",
  activate: true,
};

export default function AdminHfAccountsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/hf-accounts"));
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
      const resp = await api<{ ok: boolean; warning?: string }>("/api/admin/hf-accounts", {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          api_token: form.api_token.trim(),
          base_url: form.base_url.trim() || null,
          magic_model: form.magic_model.trim() || null,
          activate: form.activate,
          verify: true,
        }),
      });
      setForm(EMPTY);
      setFormOpen(false);
      if (resp.warning) {
        setMsg(
          `账户已保存，但连通性校验未通过（仍可激活使用）。详情：${resp.warning}`
        );
        throw new Error("__warning_already_set__");
      }
    }, "Hugging Face 账户已添加");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">Hugging Face</h1>
          <p className="text-gray-400 text-sm">
            魔法指令 · Dolphin-Mistral-24B-Venice · 同一时间仅一个 Token 激活
          </p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
        >
          <i className="fas fa-plus mr-2" />
          添加 Token
        </button>
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
              Token {data.env_fallback.api_token_mask}
              {data.env_fallback.in_use
                ? " · 当前无激活 DB 账户，魔法指令走 .env"
                : " · 有激活 DB 账户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-gray-500 text-xs">
              未配置。添加并激活一个账户后，创作页才会显示「魔法指令」。
            </p>
          )}
          {data.defaults && (
            <p className="text-gray-500 text-[11px] mt-2 font-mono break-all">
              默认 Base: {data.defaults.base_url}
              <br />
              默认 Model: {data.defaults.magic_model}
            </p>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8 modal-pop">
          <h2 className="font-bold mb-4">添加 Hugging Face Token</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主 Token"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">API Token *（hf_…）</label>
              <input
                required
                type="password"
                value={form.api_token}
                onChange={(e) => setForm({ ...form, api_token: e.target.value })}
                placeholder="https://huggingface.co/settings/tokens"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Inference Base URL（选填）</label>
              <input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder={data?.defaults.base_url ?? "https://router.huggingface.co/v1"}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">模型 ID（选填）</label>
              <input
                value={form.magic_model}
                onChange={(e) => setForm({ ...form, magic_model: e.target.value })}
                placeholder={data?.defaults.magic_model}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono text-xs"
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
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">
                    激活中
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 bg-white/10 text-gray-400 rounded-full">
                    未激活
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-gray-400">Token: {a.api_token_mask}</div>
              {a.base_url && (
                <div className="text-xs font-mono text-gray-500 truncate max-w-lg">Base: {a.base_url}</div>
              )}
              {a.magic_model && (
                <div className="text-xs font-mono text-gray-500 truncate max-w-lg">
                  Model: {a.magic_model}
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {!a.is_active && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/hf-accounts/${a.id}`, {
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
                        api(`/api/admin/hf-accounts/${a.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ activate: false }),
                        }),
                      `已停用「${a.label}」`
                    )
                  }
                  className="px-4 py-2 text-xs border border-white/10 rounded-xl hover:bg-white/5 disabled:opacity-50"
                >
                  停用
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  action(
                    () => api(`/api/admin/hf-accounts/${a.id}/test`, { method: "POST" }),
                    `「${a.label}」连通正常`
                  )
                }
                className="px-4 py-2 text-xs border border-white/10 rounded-xl hover:bg-white/5 disabled:opacity-50"
              >
                测试
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (!confirm(`确定删除「${a.label}」？`)) return;
                  void action(
                    () => api(`/api/admin/hf-accounts/${a.id}`, { method: "DELETE" }),
                    "已删除"
                  );
                }}
                className="px-4 py-2 text-xs border border-red-500/30 text-red-300 rounded-xl hover:bg-red-500/10 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <div className="glass rounded-3xl p-8 text-center text-sm text-gray-500">
            暂无 DB 账户。可添加 Token，或在 Railway/.env 配置 HF_TOKEN 作为兜底。
          </div>
        )}
      </div>
    </div>
  );
}
