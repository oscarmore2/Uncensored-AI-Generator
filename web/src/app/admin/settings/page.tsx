"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface Settings {
  app_url: string;
  demo_mode: boolean;
  vip_price_cents: number;
  credit_packages: Record<string, number>;
  zen: {
    base_url: string;
    env_key_configured: boolean;
    credit_ratio: number;
    monthly_budget: number;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
  };
  stripe: {
    env_configured: boolean;
    db_accounts: number;
    active_account: { id: number; label: string } | null;
    env_webhook_configured: boolean;
  };
  cryptomus: {
    env_configured: boolean;
    db_merchants: number;
    active_merchant: { id: number; label: string } | null;
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
  webhooks: { stripe: string; cryptomus: string; zen: string };
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Settings>("/api/admin/settings")
      .then(setSettings)
      .catch((e) => setError(e instanceof ApiError ? e.message : "加载失败"));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!settings) return <p className="text-gray-500">加载中...</p>;

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
    {
      label: "Zen 激活账户",
      value: settings.zen.active_account
        ? `${settings.zen.active_account.label} (#${settings.zen.active_account.id})`
        : settings.zen.env_key_configured
          ? "env 兜底"
          : "未配置",
    },
    { label: "Zen 账户数", value: String(settings.zen.db_accounts) },
    { label: "Zen 换算系数", value: String(settings.zen.credit_ratio) },
    { label: "Zen 月度预算", value: settings.zen.monthly_budget > 0 ? String(settings.zen.monthly_budget) : "未设置" },
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
      label: "Cryptomus 激活商户",
      value: settings.cryptomus.active_merchant
        ? `${settings.cryptomus.active_merchant.label} (#${settings.cryptomus.active_merchant.id})`
        : settings.cryptomus.env_configured
          ? "env 兜底"
          : "未配置",
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
    { label: "HF 模型", value: settings.hf.magic_model },
    {
      label: "价格体系",
      value: `产品 ${settings.pricing.active_products} · 充值包 ${settings.pricing.active_credit_packages} · VIP等级 ${settings.pricing.active_vip_tiers} · VIP套餐 ${settings.pricing.active_vip_plans}`,
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">系统配置</h1>
      <p className="text-gray-400 text-sm mb-6">只读快照 · 密钥等敏感信息已脱敏</p>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-4">运行参数</div>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between text-sm border-b border-white/5 pb-2">
              <span className="text-gray-400">{r.label}</span>
              <span className={r.warn ? "text-amber-300" : "text-gray-200 font-mono text-xs"}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-3xl p-5">
        <div className="text-sm font-semibold mb-4">Webhook 端点</div>
        <div className="space-y-2 text-xs font-mono">
          <div>
            <span className="text-gray-500">Stripe: </span>
            <span className="text-gray-300">{settings.webhooks.stripe}</span>
          </div>
          <div>
            <span className="text-gray-500">Cryptomus: </span>
            <span className="text-gray-300">{settings.webhooks.cryptomus}</span>
          </div>
          <div>
            <span className="text-gray-500">Zen (预留): </span>
            <span className="text-gray-300">{settings.webhooks.zen}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
