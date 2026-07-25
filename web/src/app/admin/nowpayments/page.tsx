"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface PaymentSettings {
  nowpayments: {
    configured: boolean;
    api_key_configured: boolean;
    ipn_secret_configured: boolean;
    base_url: string;
  };
  webhooks: { nowpayments: string };
}

export default function AdminNowPaymentsPage() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PaymentSettings>("/api/admin/settings")
      .then(setSettings)
      .catch((reason) =>
        setError(reason instanceof ApiError ? reason.message : "加载失败")
      );
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">NOWPayments</h1>
      <p className="text-gray-400 text-sm mb-6">
        托管加密货币收银台 · IPN HMAC-SHA512 验签 · finished 状态自动入账
      </p>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {!settings ? (
        !error && <p className="text-gray-500">加载中...</p>
      ) : (
        <div className="space-y-5">
          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">集成状态</div>
                <p className="mt-1 text-xs text-gray-500">
                  API Key 与 IPN Secret 均配置后才会开放创建付款。
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  settings.nowpayments.configured
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {settings.nowpayments.configured ? "已配置" : "未完成"}
              </span>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-2xl bg-black/25 p-4">
                <dt className="text-gray-500">NOWPAYMENTS_API_KEY</dt>
                <dd className="mt-1">
                  {settings.nowpayments.api_key_configured ? "已设置" : "未设置"}
                </dd>
              </div>
              <div className="rounded-2xl bg-black/25 p-4">
                <dt className="text-gray-500">NOWPAYMENTS_IPN_SECRET</dt>
                <dd className="mt-1">
                  {settings.nowpayments.ipn_secret_configured ? "已设置" : "未设置"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="glass rounded-3xl p-6">
            <h2 className="font-semibold">NOWPayments 后台设置</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-300">
              <li>在 Store Settings 创建 API Key 和 IPN Secret，并保存到部署环境变量。</li>
              <li>配置收款钱包与可接受币种；用户会在 NOWPayments 收银台选择支付币种。</li>
              <li>
                IPN 地址：
                <code className="ml-2 break-all rounded bg-black/40 px-2 py-1 text-xs text-violet-200">
                  {settings.webhooks.nowpayments}
                </code>
              </li>
              <li>完成一笔小额测试，确认订单最终进入 finished 且点数只增加一次。</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
