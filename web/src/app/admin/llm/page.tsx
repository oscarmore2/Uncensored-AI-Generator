"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

/**
 * AI 文本模型：上游账户、档位定价、成本报表。
 *
 * 三块放一页，因为运营看它们的时机是同一个：「这功能是不是在亏钱」。
 * 拆成三页的话，改完价得跳到另一页才能看见效果。
 */

interface Account {
  id: number;
  provider: string;
  label: string;
  api_key_mask: string;
  base_url: string | null;
  is_active: boolean;
}

interface AccountsResp {
  accounts: Account[];
  defaults: { base_url: string };
  env_fallback: { configured: boolean; api_key_mask: string | null; in_use: boolean };
  hf_fallback: { configured: boolean; in_use: boolean };
}

interface Model {
  id: number;
  key: string;
  label: string;
  provider_model_id: string;
  tier_code: string;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  price_multiplier_bps: number;
  supports_vision: boolean;
  uncensored: boolean;
  requires_vip_rank: number;
  requires_adult: boolean;
  is_active: boolean;
  sample: { cost_usd: number; charged_credits: string; calls_per_credit: number | null };
}

interface ModelsResp {
  models: Model[];
  pricing: {
    usd_per_credit: number;
    min_charge_micro: number;
    sample_prompt_tokens: number;
    sample_completion_tokens: number;
  };
}

interface UsageResp {
  days: number;
  summary: {
    calls: number;
    cost_usd: number;
    charged_usd: number;
    charged_credits: string;
    settled_credits: number;
    margin_bps: number | null;
    estimated_ratio_bps: number;
  };
  by_model: Array<{
    model_key: string;
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    charged_usd: number;
    charged_credits: string;
    margin_bps: number | null;
  }>;
  by_status: Array<{ status: string; calls: number; charged_credits: string; cost_usd: number }>;
  recent: Array<{
    id: number;
    user_id: number;
    skill_key: string;
    model_key: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    cost_estimated: boolean;
    charged_credits: string;
    settled_credits: number;
    status: string;
    created_at: string;
  }>;
}

const TIER_LABEL: Record<string, string> = {
  basic: "基础",
  advanced: "进阶",
  unrestricted: "无限制",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "成功",
  blocked: "审查拦截",
  canceled: "用户取消",
  failed: "失败",
  timeout: "超时",
};

export default function AdminLlmPage() {
  const [accounts, setAccounts] = useState<AccountsResp | null>(null);
  const [models, setModels] = useState<ModelsResp | null>(null);
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ label: "", api_key: "", base_url: "", activate: true, verify: true });

  const load = useCallback(async () => {
    try {
      const [a, m, u] = await Promise.all([
        api<AccountsResp>("/api/admin/llm/accounts"),
        api<ModelsResp>("/api/admin/llm/models"),
        api<UsageResp>(`/api/admin/llm/usage?days=${days}`),
      ]);
      setAccounts(a);
      setModels(m);
      setUsage(u);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [days]);

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

  const patchModel = (id: number, body: Record<string, unknown>, okMsg: string) =>
    action(() => api(`/api/admin/llm/models/${id}`, { method: "PATCH", body: JSON.stringify(body) }), okMsg);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-1">AI 文本模型</h1>
        <p className="text-ink-muted text-sm">
          选区级 AI 与技能系统的上游。按 token 计费，内部以千分之一点累计，满 1 点才动余额
        </p>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      {/* ---------------------------------------------------- 成本报表 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">用量与成本</h2>
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs rounded-full ${
                  days === d ? "bg-orange-700 text-white" : "bg-black/[0.06] text-ink-muted"
                }`}
              >
                {d} 天
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Stat label="调用次数" value={String(usage?.summary.calls ?? "—")} />
          <Stat label="上游成本" value={usage ? `$${usage.summary.cost_usd}` : "—"} />
          <Stat label="向用户收取" value={usage ? `$${usage.summary.charged_usd}` : "—"} />
          <Stat
            label="毛利率"
            value={usage?.summary.margin_bps != null ? `${(usage.summary.margin_bps / 100).toFixed(1)}%` : "—"}
            hint="上游涨价时它先掉"
          />
          <Stat
            label="成本靠估算"
            value={usage ? `${(usage.summary.estimated_ratio_bps / 100).toFixed(0)}%` : "—"}
            hint="居高不下说明上游没回成本"
          />
        </div>

        {usage && usage.by_model.length > 0 && (
          <div className="glass rounded-3xl p-4 mb-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-subtle">
                <tr className="text-left">
                  <th className="py-1.5 pr-3">模型</th>
                  <th className="py-1.5 pr-3">次数</th>
                  <th className="py-1.5 pr-3">token（入 / 出）</th>
                  <th className="py-1.5 pr-3">成本</th>
                  <th className="py-1.5 pr-3">收取</th>
                  <th className="py-1.5">毛利率</th>
                </tr>
              </thead>
              <tbody>
                {usage.by_model.map((m) => (
                  <tr key={m.model_key} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono">{m.model_key}</td>
                    <td className="py-1.5 pr-3">{m.calls}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">
                      {m.prompt_tokens} / {m.completion_tokens}
                    </td>
                    <td className="py-1.5 pr-3">${m.cost_usd}</td>
                    <td className="py-1.5 pr-3">
                      ${m.charged_usd}
                      <span className="ml-1 text-ink-subtle">（{m.charged_credits} 点）</span>
                    </td>
                    <td className="py-1.5">
                      {m.margin_bps != null ? `${(m.margin_bps / 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {usage && usage.by_status.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {usage.by_status.map((s) => (
              <span
                key={s.status}
                className="text-[11px] px-2.5 py-1 rounded-full bg-black/[0.06] text-ink-muted"
              >
                {STATUS_LABEL[s.status] ?? s.status}：{s.calls} 次 · {s.charged_credits} 点
              </span>
            ))}
          </div>
        )}

        {usage && usage.recent.length > 0 && (
          <details className="glass rounded-3xl p-4">
            <summary className="text-sm text-ink-muted cursor-pointer">最近 30 条明细</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-ink-subtle">
                  <tr className="text-left">
                    <th className="py-1.5 pr-3">时间</th>
                    <th className="py-1.5 pr-3">用户</th>
                    <th className="py-1.5 pr-3">动作</th>
                    <th className="py-1.5 pr-3">token</th>
                    <th className="py-1.5 pr-3">成本</th>
                    <th className="py-1.5 pr-3">扣点</th>
                    <th className="py-1.5">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.recent.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-1.5 pr-3 text-ink-subtle">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3">#{r.user_id}</td>
                      <td className="py-1.5 pr-3">{r.skill_key}</td>
                      <td className="py-1.5 pr-3 text-ink-muted">
                        {r.prompt_tokens}/{r.completion_tokens}
                      </td>
                      <td className="py-1.5 pr-3">
                        ${r.cost_usd}
                        {r.cost_estimated && <span className="ml-1 text-amber-700">估</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.charged_credits}
                        {r.settled_credits > 0 && (
                          <span className="ml-1 text-ink-subtle">（结算 {r.settled_credits}）</span>
                        )}
                      </td>
                      <td className="py-1.5">{STATUS_LABEL[r.status] ?? r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {/* ---------------------------------------------------- 档位定价 */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">档位与定价</h2>
        <p className="text-ink-muted text-xs mb-3">
          单点美元价 ${models?.pricing.usd_per_credit ?? "—"}（与生成端同一个锚点）。
          「一次约」按输入 {models?.pricing.sample_prompt_tokens ?? 800} / 输出{" "}
          {models?.pricing.sample_completion_tokens ?? 300} token 估算，最低收费{" "}
          {(models?.pricing.min_charge_micro ?? 5) / 1000} 点。
        </p>

        <div className="space-y-2">
          {models?.models.map((m) => (
            <ModelRow key={m.id} model={m} busy={busy} onPatch={patchModel} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- 上游账户 */}
      <section>
        <h2 className="text-lg font-bold mb-1">上游账户</h2>
        <p className="text-ink-muted text-xs mb-3">
          优先级：激活的账户 → 环境变量 OPENROUTER_API_KEY → Hugging Face 凭据。
          Key 加密保存，同一时间只有一个账户生效。
        </p>

        <div className="glass rounded-2xl p-4 mb-4 text-sm space-y-1.5">
          <FallbackLine
            name="环境变量 OPENROUTER_API_KEY"
            configured={Boolean(accounts?.env_fallback.configured)}
            inUse={Boolean(accounts?.env_fallback.in_use)}
            extra={accounts?.env_fallback.api_key_mask ?? undefined}
          />
          <FallbackLine
            name="Hugging Face 凭据（最后兜底）"
            configured={Boolean(accounts?.hf_fallback.configured)}
            inUse={Boolean(accounts?.hf_fallback.in_use)}
          />
        </div>

        <form
          className="glass rounded-3xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/api/admin/llm/accounts", {
                  method: "POST",
                  body: JSON.stringify({
                    label: form.label,
                    api_key: form.api_key,
                    base_url: form.base_url.trim() || null,
                    activate: form.activate,
                    verify: form.verify,
                  }),
                }).then((r) => {
                  setForm({ label: "", api_key: "", base_url: "", activate: true, verify: true });
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
            className="bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-500/60"
          />
          <input
            required
            type="password"
            placeholder="API Key（sk-or-…）"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-orange-500/60"
          />
          <input
            placeholder={`Base URL（留空用 ${accounts?.defaults.base_url ?? "官方"}）`}
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-orange-500/60"
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              立即激活
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={form.verify}
                onChange={(e) => setForm({ ...form, verify: e.target.checked })}
              />
              保存前校验
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="md:col-span-2 px-4 py-2.5 text-sm font-semibold bg-orange-700 hover:bg-orange-600 rounded-2xl disabled:opacity-50 text-white"
          >
            添加账户
          </button>
        </form>

        <div className="space-y-2">
          {accounts?.accounts.map((a) => (
            <div
              key={a.id}
              className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3 text-sm"
            >
              <span className="font-semibold">{a.label}</span>
              <code className="font-mono text-xs text-ink-muted">{a.api_key_mask}</code>
              {a.base_url && <code className="font-mono text-xs text-ink-subtle">{a.base_url}</code>}
              {a.is_active && (
                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-700 rounded-full">
                  生效中
                </span>
              )}
              <div className="ml-auto flex gap-2">
                {!a.is_active && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api(`/api/admin/llm/accounts/${a.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ activate: true }),
                          }),
                        "已激活"
                      )
                    }
                    className="px-3 py-1.5 text-xs rounded-xl border border-line"
                  >
                    激活
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api(`/api/admin/llm/accounts/${a.id}`, { method: "DELETE" }),
                      "已删除"
                    )
                  }
                  className="px-3 py-1.5 text-xs rounded-xl border border-line text-red-700"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {accounts?.accounts.length === 0 && (
            <p className="text-sm text-ink-subtle">还没有账户，正在用上面的兜底凭据。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-2xl p-3">
      <div className="text-[11px] text-ink-subtle">{label}</div>
      <div className="text-xl font-bold tracking-tight">{value}</div>
      {hint && <div className="text-[10px] text-ink-subtle mt-0.5">{hint}</div>}
    </div>
  );
}

function FallbackLine({
  name,
  configured,
  inUse,
  extra,
}: {
  name: string;
  configured: boolean;
  inUse: boolean;
  extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-ink-muted">{name}：</span>
      {extra && <code className="font-mono text-xs text-ink-muted">{extra}</code>}
      <span
        className={`text-[10px] px-2 py-0.5 rounded-full ${
          inUse
            ? "bg-emerald-500/20 text-emerald-700"
            : configured
              ? "bg-black/[0.06] text-ink-muted"
              : "bg-black/[0.06] text-ink-subtle"
        }`}
      >
        {inUse ? "当前生效" : configured ? "已配置，被覆盖" : "未配置"}
      </span>
    </div>
  );
}

function ModelRow({
  model,
  busy,
  onPatch,
}: {
  model: Model;
  busy: boolean;
  onPatch(id: number, body: Record<string, unknown>, okMsg: string): void;
}) {
  const [draft, setDraft] = useState({
    input: String(model.input_usd_per_mtok),
    output: String(model.output_usd_per_mtok),
    multiplier: String(model.price_multiplier_bps),
    providerModelId: model.provider_model_id,
  });

  return (
    <div className="glass rounded-3xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.06] text-ink-muted">
          {TIER_LABEL[model.tier_code] ?? model.tier_code}
        </span>
        <span className="font-semibold text-sm">{model.label}</span>
        {model.uncensored && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-700">
            uncensored · 需成人验证
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onPatch(model.id, { supports_vision: !model.supports_vision }, "已保存")}
          title="提示词里 @ 引用了参考图时，是否把图一起发给它。读不了图的模型必须关着——发上去只会报错或被无声忽略"
          className={`text-[10px] px-2 py-0.5 rounded-full ${
            model.supports_vision
              ? "bg-sky-500/20 text-sky-700"
              : "bg-black/[0.06] text-ink-subtle"
          }`}
        >
          {model.supports_vision ? "可读图" : "不读图"}
        </button>
        {model.requires_vip_rank > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800">
            VIP{model.requires_vip_rank}+
          </span>
        )}
        <span className="text-xs text-ink-subtle">
          一次约 {model.sample.charged_credits} 点
          {model.sample.calls_per_credit != null && ` · 约 ${model.sample.calls_per_credit} 次扣 1 点`}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onPatch(model.id, { is_active: !model.is_active }, "已保存")}
          className={`ml-auto px-3 py-1.5 text-xs rounded-xl border border-line ${
            model.is_active ? "text-emerald-700" : "text-ink-subtle"
          }`}
        >
          {model.is_active ? "启用中" : "已停用"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <Field label="上游模型 id" wide>
          <input
            value={draft.providerModelId}
            onChange={(e) => setDraft({ ...draft, providerModelId: e.target.value })}
            className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs font-mono outline-none focus:border-orange-500/60"
          />
        </Field>
        <Field label="输入 $/Mtok">
          <input
            value={draft.input}
            onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs font-mono outline-none focus:border-orange-500/60"
          />
        </Field>
        <Field label="输出 $/Mtok">
          <input
            value={draft.output}
            onChange={(e) => setDraft({ ...draft, output: e.target.value })}
            className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs font-mono outline-none focus:border-orange-500/60"
          />
        </Field>
        <Field label="倍率 bps">
          <input
            value={draft.multiplier}
            onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })}
            className="w-full bg-surface border border-line rounded-xl px-2.5 py-1.5 text-xs font-mono outline-none focus:border-orange-500/60"
          />
        </Field>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onPatch(
              model.id,
              {
                provider_model_id: draft.providerModelId.trim(),
                input_usd_per_mtok: Number(draft.input),
                output_usd_per_mtok: Number(draft.output),
                price_multiplier_bps: Number(draft.multiplier),
              },
              "已保存"
            )
          }
          className="px-3 py-1.5 text-xs rounded-xl bg-orange-700 text-white disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[10px] text-ink-subtle mb-1">{label}</div>
      {children}
    </div>
  );
}
