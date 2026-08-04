"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { ProviderTabs } from "@/components/admin/ProviderTabs";
import { DEFAULT_PROVIDER, PROVIDER_META, type ProviderId } from "@/lib/providers/meta";

interface Account {
  id: number;
  provider: ProviderId;
  label: string;
  api_key_mask: string;
  is_active: boolean;
  created_at: string;
}

interface ProviderInfo {
  id: ProviderId;
  label: string;
  short_label: string;
  key_url: string;
  supports_dynamic_pricing: boolean;
  base_url: string;
  configured: boolean;
  env_fallback: { configured: boolean; api_key_mask: string | null; in_use: boolean };
}

interface ListResp {
  accounts: Account[];
  providers: ProviderInfo[];
  note: string;
}

const EMPTY = { label: "", api_key: "", activate: true };

export default function AdminProvidersPage() {
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/provider-accounts"));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const info = useMemo(
    () => data?.providers.find((p) => p.id === provider) ?? null,
    [data, provider]
  );
  const accounts = useMemo(
    () => (data?.accounts ?? []).filter((a) => a.provider === provider),
    [data, provider]
  );
  const meta = PROVIDER_META[provider];

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
      const resp = await api<{ ok: boolean; warning?: string }>("/api/admin/provider-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider,
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
    }, `${meta.label} 账户已添加`);
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">生成渠道</h1>
          <p className="text-ink-muted text-sm">
            各渠道独立的 API Key · 每个渠道同一时间仅一个激活
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/models"
            className="px-5 py-2.5 text-sm font-semibold bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-2xl"
          >
            模型库
          </Link>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="px-5 py-2.5 text-sm font-semibold bg-orange-700 hover:bg-orange-600 rounded-2xl text-white"
          >
            <i className="fas fa-plus mr-2" />
            添加 {meta.shortLabel} Key
          </button>
        </div>
      </div>

      <div className="mb-5">
        <ProviderTabs
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setFormOpen(false);
            setForm(EMPTY);
            setMsg("");
          }}
          info={(data?.providers ?? []).map((p) => ({
            id: p.id,
            label: p.label,
            count: (data?.accounts ?? []).filter((a) => a.provider === p.id).length,
            configured: p.configured,
          }))}
        />
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      {data?.note && (
        <div className="glass rounded-3xl p-4 mb-6 text-xs text-ink-muted">
          <i className="fas fa-circle-info mr-2 text-orange-700" />
          {data.note}
        </div>
      )}

      {info && (
        <div
          className={`glass rounded-3xl p-4 mb-6 text-sm ${
            info.env_fallback.in_use ? "border border-amber-500/30" : ""
          }`}
        >
          <div className="font-semibold mb-1">{meta.label} · .env 兜底</div>
          {info.env_fallback.configured ? (
            <p className="text-ink-muted text-xs">
              Key {info.env_fallback.api_key_mask}
              {info.env_fallback.in_use
                ? " · 当前无激活 DB 账户，走 .env"
                : " · 有激活 DB 账户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-ink-subtle text-xs">
              未配置 {provider === "wavespeed" ? "WAVESPEED_API_KEY" : "ATLAS_API_KEY"}
              。请添加并激活一个账户。
            </p>
          )}
          <p className="text-ink-subtle text-[11px] mt-2 font-mono break-all">
            Base: {info.base_url}
          </p>
          <p className="text-ink-subtle text-[11px] mt-1">
            成本口径：
            {info.supports_dynamic_pricing
              ? "支持按入参实时估价"
              : "无实时估价接口，报价与成本一律用目录基准价"}
          </p>
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8">
          <h2 className="font-bold mb-4">添加 {meta.label} API Key</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-ink-muted block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主账户"
                className="w-full bg-surface border border-line rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">API Key *</label>
              <input
                required
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={meta.keyUrl}
                className="w-full bg-surface border border-line rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <label className="flex items-center gap-x-2 text-sm text-ink-muted cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              <span>添加后立即激活（只会停用 {meta.label} 的其它账户，不影响另一个渠道）</span>
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-4 px-5 py-2.5 text-sm font-semibold bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
          >
            保存
          </button>
        </form>
      )}

      <div className="space-y-3">
        {accounts.map((a) => (
          <div key={a.id} className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">
                {a.label}
                {a.is_active && (
                  <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700">
                    激活
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-subtle font-mono mt-1">{a.api_key_mask}</div>
            </div>
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-line rounded-xl"
              onClick={() =>
                action(
                  () =>
                    api(`/api/admin/provider-accounts/${a.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ activate: !a.is_active }),
                    }),
                  a.is_active ? "已停用" : "已激活"
                )
              }
            >
              {a.is_active ? "停用" : "激活"}
            </button>
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-line rounded-xl"
              onClick={() =>
                action(
                  () => api(`/api/admin/provider-accounts/${a.id}/test`, { method: "POST" }),
                  "连通性正常"
                )
              }
            >
              测试
            </button>
            <button
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-red-500/30 text-red-700 rounded-xl"
              onClick={() => {
                if (!window.confirm("确定删除该账户？")) return;
                void action(
                  () => api(`/api/admin/provider-accounts/${a.id}`, { method: "DELETE" }),
                  "已删除"
                );
              }}
            >
              删除
            </button>
          </div>
        ))}
        {data && accounts.length === 0 && (
          <p className="text-ink-subtle text-sm">
            {meta.label} 暂无账户，请添加 Key 或配置 .env
          </p>
        )}
      </div>
    </div>
  );
}
