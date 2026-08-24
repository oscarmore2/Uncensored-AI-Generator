"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { creditsForTokens } from "@/lib/ai-token-cost";

interface Settings {
  app_url: string;
  demo_mode: boolean;
  signup_initial_credits: number;
  ai_credits_per_1k_tokens: number;
  vip_price_cents: number;
  credit_packages: Record<string, number>;
  providers: Array<{
    id: string;
    label: string;
    base_url: string;
    supports_dynamic_pricing: boolean;
    env_key_configured: boolean;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
    configured: boolean;
  }>;
  stripe: {
    env_configured: boolean;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
    env_webhook_configured: boolean;
  };
  nowpayments: {
    configured: boolean;
    api_key_configured: boolean;
    ipn_secret_configured: boolean;
    base_url: string;
  };
  content_safety: {
    configured: boolean;
    env_key_configured: boolean;
    moderation_model: string;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
  };
  hf: {
    configured: boolean;
    env_token_configured: boolean;
    inference_base_url: string;
    magic_model: string;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
  };
  pricing: {
    db_enabled: boolean;
    active_products: number;
    active_credit_packages: number;
    active_vip_tiers: number;
    active_vip_plans: number;
  };
  telegram_configured: boolean;
  webhooks: { stripe: string; nowpayments: string };
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [signupCredits, setSignupCredits] = useState(20);
  const [aiRate, setAiRate] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState("");

  useEffect(() => {
    api<Settings>("/api/admin/settings")
      .then((value) => {
        setSettings(value);
        setSignupCredits(value.signup_initial_credits);
        setAiRate(value.ai_credits_per_1k_tokens);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "加载失败"));
  }, []);

  async function saveSignupCredits() {
    if (!Number.isInteger(signupCredits) || signupCredits < 0 || signupCredits > 100_000) {
      setMessage("注册初始点数须为 0–100000 的整数");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await api<{ signup_initial_credits: number }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ signup_initial_credits: signupCredits }),
      });
      setSettings((current) =>
        current
          ? { ...current, signup_initial_credits: result.signup_initial_credits }
          : current
      );
      setMessage("注册初始点数已保存，仅影响之后注册的新用户");
    } catch (reason) {
      setMessage(reason instanceof ApiError ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveAiRate() {
    if (!Number.isFinite(aiRate) || aiRate < 0 || aiRate > 1000) {
      setAiMessage("AI 费率须为 0–1000");
      return;
    }
    setAiSaving(true);
    setAiMessage("");
    try {
      const result = await api<{ ai_credits_per_1k_tokens: number }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ ai_credits_per_1k_tokens: aiRate }),
      });
      setSettings((current) =>
        current
          ? { ...current, ai_credits_per_1k_tokens: result.ai_credits_per_1k_tokens }
          : current
      );
      setAiMessage("已保存，立即对新的 AI 请求生效");
    } catch (reason) {
      setAiMessage(reason instanceof ApiError ? reason.message : "保存失败");
    } finally {
      setAiSaving(false);
    }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!settings) return <p className="text-ink-subtle">加载中...</p>;

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: "APP_URL", value: settings.app_url },
    {
      label: "DEMO_MODE",
      value: settings.demo_mode ? "true（模拟支付/生成）" : "false",
      warn: settings.demo_mode,
    },
    { label: "VIP 价格", value: `$${(settings.vip_price_cents / 100).toFixed(2)}/月` },
    {
      label: "充值套餐",
      value: Object.entries(settings.credit_packages)
        .map(([c, p]) => `${c}点=$${(p / 100).toFixed(2)}`)
        .join(" · "),
    },
    { label: "Telegram", value: settings.telegram_configured ? "已配置" : "未配置", warn: !settings.telegram_configured },
    // 每个生成渠道一行：某一家没配 Key，绑到它的档位会直接失败，必须一眼看得到
    ...settings.providers.map((p) => ({
      label: `${p.label} 激活账户`,
      value: p.active_account
        ? `${p.active_account.label} (#${p.active_account.id}) · ${p.db_accounts} 个账户`
        : p.env_key_configured
          ? `env 兜底 · ${p.db_accounts} 个账户`
          : "未配置",
      warn: !p.configured,
    })),
    {
      label: "Stripe 激活账户",
      value: settings.stripe.active_account
        ? `${settings.stripe.active_account.label} (#${settings.stripe.active_account.id})`
        : settings.stripe.env_configured
          ? "env 兜底"
          : "未配置",
    },
    { label: "Stripe Webhook (env)", value: settings.stripe.env_webhook_configured ? "已配置" : "未配置" },
    {
      label: "NOWPayments",
      value: settings.nowpayments.configured
        ? "API Key 与 IPN Secret 已配置"
        : "未完整配置",
      warn: !settings.nowpayments.configured,
    },
    {
      label: "Hugging Face / 魔法指令",
      value: settings.hf.active_account
        ? `${settings.hf.active_account.label} (#${settings.hf.active_account.id})`
        : settings.hf.env_token_configured
          ? "env 兜底"
          : "未配置（创作页隐藏）",
      warn: !settings.hf.configured,
    },
    { label: "HF 账户数", value: String(settings.hf.db_accounts) },
    {
      label: "内容审查 OpenAI",
      value: settings.content_safety.active_account
        ? `${settings.content_safety.active_account.label} (#${settings.content_safety.active_account.id})`
        : settings.content_safety.env_key_configured
          ? "env 兜底"
          : "未配置（降级到 HF）",
      warn: !settings.content_safety.configured,
    },
    { label: "审查模型", value: settings.content_safety.moderation_model },
    { label: "HF 模型", value: settings.hf.magic_model },
    {
      label: "价格体系",
      value: `产品 ${settings.pricing.active_products} · 充值包 ${settings.pricing.active_credit_packages} · VIP等级 ${settings.pricing.active_vip_tiers} · VIP套餐 ${settings.pricing.active_vip_plans}`,
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">系统配置</h1>
      <p className="text-ink-muted text-sm mb-6">运营配置与运行快照 · 密钥等敏感信息已脱敏</p>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-1">新用户注册初始点数</div>
        <p className="mb-4 text-xs text-ink-subtle">
          适用于邮箱、Google 与 Facebook 首次注册；修改后不追溯已有用户。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={signupCredits}
            onChange={(event) => setSignupCredits(Math.trunc(Number(event.target.value) || 0))}
            className="w-40 rounded-xl border border-line bg-surface px-3 py-2"
          />
          <span className="text-sm text-ink-muted">点</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveSignupCredits()}
            className="rounded-xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        {message && <p className="mt-3 text-xs text-amber-800">{message}</p>}
      </div>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-1">魔法指令费率</div>
        <p className="mb-4 text-xs leading-relaxed text-ink-subtle">
          魔法指令按<strong>实际消耗的 token</strong>扣点，与生成扣点分开定价——改一句提示词和出一段视频，
          成本差好几个数量级。只有真正调用了大模型才扣；本地规则兜底不收费。
          <br />
          填 0 表示本功能不收费。由于设有「至少 1 点」的下限，小于 1 的费率与 1 等效。
          <br />
          <strong>这条只管魔法指令。</strong>选区级 AI 与技能系统走的是另一套——按每个模型的单价与
          倍率算，精度到千分之一点，在「AI 文本模型」页配置。魔法指令在技能系统里归位成一个官方技能之后，
          这条设置就会一并退休。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            min={0}
            max={1000}
            step={0.5}
            value={aiRate}
            onChange={(event) => setAiRate(Number(event.target.value) || 0)}
            className="w-40 rounded-xl border border-line bg-surface px-3 py-2"
          />
          <span className="text-sm text-ink-muted">点 / 1000 token</span>
          <button
            type="button"
            disabled={aiSaving}
            onClick={() => void saveAiRate()}
            className="rounded-xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {aiSaving ? "保存中…" : "保存"}
          </button>
        </div>
        {/* 光看一个费率数字很难判断贵不贵，把它换算成用户实际感受得到的东西 */}
        <p className="mt-3 text-xs text-ink-muted">
          按此费率：一次典型改写（600~1500 token）扣{" "}
          <span className="font-mono font-semibold text-ink">
            {creditsForTokens(600, aiRate)}~{creditsForTokens(1500, aiRate)}
          </span>{" "}
          点；新用户注册送的 {settings.signup_initial_credits} 点约够{" "}
          <span className="font-mono font-semibold text-ink">
            {creditsForTokens(1000, aiRate) > 0
              ? Math.floor(settings.signup_initial_credits / creditsForTokens(1000, aiRate))
              : "∞"}
          </span>{" "}
          次。
        </p>
        {aiMessage && <p className="mt-3 text-xs text-amber-800">{aiMessage}</p>}
      </div>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-4">运行参数</div>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between text-sm border-b border-line pb-2">
              <span className="text-ink-muted">{r.label}</span>
              <span className={r.warn ? "text-amber-800" : "text-ink font-mono text-xs"}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-3xl p-5">
        <div className="text-sm font-semibold mb-4">Webhook 端点</div>
        <div className="space-y-2 text-xs font-mono">
          <div>
            <span className="text-ink-subtle">Stripe: </span>
            <span className="text-ink-muted">{settings.webhooks.stripe}</span>
          </div>
          <div>
            <span className="text-ink-subtle">NOWPayments: </span>
            <span className="text-ink-muted">{settings.webhooks.nowpayments}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
