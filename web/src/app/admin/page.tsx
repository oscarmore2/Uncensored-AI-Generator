"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface Stats {
  totals: {
    users: number;
    users_today: number;
    users_disabled: number;
    revenue_cents: number;
    credits_consumed: number;
    generations: number;
    generations_failed: number;
    failure_rate: number;
    public_works: number;
    uncredited_crypto_count: number;
  };
  revenue_by_method: Record<string, { cents: number; count: number }>;
  generations_by_status: Record<string, number>;
  mod_queue: { pending_review: number };
  revenue_by_cryptomus_merchant: { merchant_id: number | null; label: string; cents: number; count: number }[];
  revenue_by_stripe_account: { account_id: number | null; label: string; cents: number; count: number }[];
  series: {
    date: string;
    registrations: number;
    revenue_cents: number;
    generations: number;
    revenue_stripe: number;
    revenue_cryptomus: number;
    revenue_demo: number;
  }[];
  zen: {
    month_credits: number;
    estimated_zen_credits: number;
    ratio: number;
    monthly_budget: number;
    usage_ratio: number | null;
  };
  telegram_configured: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  stripe: "Stripe",
  cryptomus: "Cryptomus",
  demo: "Demo",
  unknown: "未知",
};

function BarChart({
  title,
  data,
  format,
}: {
  title: string;
  data: { date: string; value: number }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="glass rounded-3xl p-5">
      <div className="text-sm font-semibold mb-4">{title}</div>
      <div className="flex items-end gap-[3px] h-32">
        {data.map((d) => (
          <div
            key={d.date}
            className="flex-1 bg-rose-600/70 hover:bg-rose-500 rounded-t transition-colors min-h-[2px]"
            style={{ height: `${(d.value / max) * 100}%` }}
            title={`${d.date}: ${format ? format(d.value) : d.value}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-2">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Stats>("/api/admin/stats")
      .then(setStats)
      .catch((e) => setError(e instanceof ApiError ? e.message : "加载失败"));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!stats) return <p className="text-gray-500">加载中...</p>;

  const t = stats.totals;
  const pipeline = stats.generations_by_status;
  const inFlight = (pipeline.pending ?? 0) + (pipeline.queued ?? 0) + (pipeline.processing ?? 0);
  const revenueTotal = t.revenue_cents || 1;

  const cards = [
    { label: "注册用户", value: t.users, sub: `今日 +${t.users_today} · 封禁 ${t.users_disabled}` },
    { label: "总收入", value: `$${(t.revenue_cents / 100).toFixed(2)}`, sub: "recharge 流水合计" },
    { label: "点数消耗", value: t.credits_consumed, sub: "非失败生成任务成本" },
    {
      label: "生成任务",
      value: t.generations,
      sub: (
        <>
          失败 {t.generations_failed}（{(t.failure_rate * 100).toFixed(1)}%）·{" "}
          <Link href="/mod?status=failed" className="text-rose-400 hover:underline">
            查看
          </Link>
        </>
      ),
    },
    { label: "公共库已上架", value: t.public_works, sub: "游客可见" },
  ];

  const zen = stats.zen;
  const usagePct = zen.usage_ratio !== null ? Math.round(zen.usage_ratio * 100) : null;

  const methodEntries = Object.entries(stats.revenue_by_method).sort((a, b) => b[1].cents - a[1].cents);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">数据看板</h1>
      <p className="text-gray-400 text-sm mb-8">全站运营数据 · 近 30 天趋势</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-3xl p-5">
            <div className="text-2xl font-bold font-mono stat-number">{c.value}</div>
            <div className="text-xs text-gray-400 mt-1">{c.label}</div>
            <div className="text-[10px] text-gray-500 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="glass rounded-3xl p-5 md:col-span-1">
          <div className="text-sm font-semibold mb-3">收入分渠道</div>
          <div className="space-y-3">
            {methodEntries.map(([key, v]) => {
              const pct = Math.round((v.cents / revenueTotal) * 100);
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{METHOD_LABELS[key] ?? key}</span>
                    <span className="font-mono text-gray-400">
                      ${(v.cents / 100).toFixed(2)} · {v.count} 笔 · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {methodEntries.length === 0 && <p className="text-xs text-gray-500">暂无充值流水</p>}
          </div>
        </div>

        <div className="glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">生成管道</div>
            {inFlight > 0 && (
              <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full">进行中 {inFlight}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {(["pending", "queued", "processing", "succeeded", "partial", "failed"] as const).map((s) => (
              <div key={s} className="flex justify-between px-2 py-1 bg-white/5 rounded-lg">
                <span className="text-gray-400 text-xs">{s}</span>
                <span className="font-mono">{pipeline[s] ?? 0}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3 text-xs">
            <Link href="/mod" className="text-rose-400 hover:underline">
              前往审核台
            </Link>
            {t.uncredited_crypto_count > 0 && (
              <Link href="/admin/crypto?credited=0" className="text-amber-400 hover:underline">
                未入账加密订单 {t.uncredited_crypto_count}
              </Link>
            )}
          </div>
        </div>

        <div className="glass rounded-3xl p-5">
          <div className="text-sm font-semibold mb-3">审核队列摘要</div>
          <div className="text-3xl font-bold font-mono">{stats.mod_queue.pending_review}</div>
          <p className="text-xs text-gray-400 mt-1">成功生成、未删除、尚未精选入公共库</p>
          <Link href="/mod" className="inline-block mt-3 text-xs text-rose-400 hover:underline">
            打开审核台 →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <BarChart title="每日注册" data={stats.series.map((s) => ({ date: s.date, value: s.registrations }))} />
        <BarChart
          title="每日收入"
          data={stats.series.map((s) => ({ date: s.date, value: s.revenue_cents }))}
          format={(v) => `$${(v / 100).toFixed(2)}`}
        />
        <BarChart title="每日生成" data={stats.series.map((s) => ({ date: s.date, value: s.generations }))} />
      </div>

      {(stats.revenue_by_stripe_account.length > 0 || stats.revenue_by_cryptomus_merchant.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {stats.revenue_by_stripe_account.length > 0 && (
            <div className="glass rounded-3xl p-5">
              <div className="text-sm font-semibold mb-3">Stripe 账户收入</div>
              <div className="space-y-2">
                {stats.revenue_by_stripe_account.map((row) => (
                  <div key={String(row.account_id)} className="flex justify-between text-xs">
                    <span className="text-gray-300">{row.label}</span>
                    <span className="font-mono text-gray-400">
                      ${(row.cents / 100).toFixed(2)} · {row.count} 笔
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.revenue_by_cryptomus_merchant.length > 0 && (
            <div className="glass rounded-3xl p-5">
              <div className="text-sm font-semibold mb-3">Cryptomus 商户收入</div>
              <div className="space-y-2">
                {stats.revenue_by_cryptomus_merchant.map((row) => (
                  <div key={String(row.merchant_id)} className="flex justify-between text-xs">
                    <span className="text-gray-300">{row.label}</span>
                    <span className="font-mono text-gray-400">
                      ${(row.cents / 100).toFixed(2)} · {row.count} 笔
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Zen 消耗估算（本月）</div>
            {usagePct !== null && usagePct >= 80 && (
              <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-300 rounded-full">预算告警</span>
            )}
          </div>
          <div className="text-3xl font-bold font-mono">{zen.estimated_zen_credits}</div>
          <div className="text-xs text-gray-400 mt-1">
            估算 Zen credits（站内消耗 {zen.month_credits} 点 × 系数 {zen.ratio}）
          </div>
          {zen.monthly_budget > 0 ? (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>月度预算 {zen.monthly_budget}</span>
                <span>{usagePct}%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${usagePct !== null && usagePct >= 80 ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, usagePct ?? 0)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 mt-3">未设置 ZEN_MONTHLY_BUDGET，不做预算对照</p>
          )}
        </div>

        <div className="glass rounded-3xl p-5">
          <div className="text-sm font-semibold mb-3">Telegram 通知</div>
          {stats.telegram_configured ? (
            <p className="text-sm text-emerald-300">
              <i className="fas fa-check-circle mr-2" />
              已配置：充值成功、新用户注册、生成失败退款、Zen 预算告警会推送到指定会话
            </p>
          ) : (
            <div className="text-sm text-gray-400">
              <p>
                <i className="fas fa-circle-exclamation mr-2 text-amber-400" />
                未配置。在 .env 中设置后即自动启用：
              </p>
              <pre className="mt-2 bg-black/40 rounded-xl p-3 text-xs font-mono">
                {`TELEGRAM_BOT_TOKEN="123456:ABC..."
TELEGRAM_CHAT_ID="-100xxxx"`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
