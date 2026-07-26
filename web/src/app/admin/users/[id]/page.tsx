"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";

interface UserDetail {
  user: {
    id: number;
    username: string;
    email: string | null;
    email_verified_at: string | null;
    registration_geo: {
      country_code: string | null;
      country: string | null;
      region: string | null;
      city: string | null;
      source: string | null;
      captured_at: string | null;
    };
    role: string;
    balance: number;
    is_vip: boolean;
    vip_expires_at: string | null;
    plaything_access: boolean;
    vip_tier: {
      id: number;
      code: string;
      name: string;
      discount_bps: number;
      plaything_access?: boolean;
    } | null;
    disabled_at: string | null;
    created_at: string;
    generation_count: number;
    wavespeed_generation_count: number;
    upload_count: number;
    total_recharge_cents: number;
    total_recharge_credits: number;
  };
  recent_transactions: {
    id: number;
    type: string;
    amount: number;
    price_cents: number | null;
    method: string | null;
    created_at: string;
  }[];
  recent_recharges: {
    id: number;
    amount: number;
    price_cents: number | null;
    method: string | null;
    payment_id: string | null;
    created_at: string;
  }[];
  recent_generations: {
    id: number;
    mode: string;
    status: string;
    cost: number;
    created_at: string;
  }[];
  recent_crypto_payments: {
    id: number;
    order_id: string;
    credits: number;
    amount_usd_cents: number;
    status: string;
    credited: boolean;
    created_at: string;
  }[];
}

const ROLES = ["user", "moderator", "admin"] as const;

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(userId)) return;
    try {
      setData(await api<UserDetail>(`/api/admin/users/${userId}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-gray-500">加载中...</p>;

  const u = data.user;

  return (
    <div>
      <Link href="/admin/users" className="text-xs text-gray-400 hover:text-white mb-4 inline-block">
        ← 返回用户列表
      </Link>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">{u.username}</h1>
      <p className="text-gray-400 text-sm mb-6">
        用户 #{u.id} · 注册于 {new Date(u.created_at).toLocaleString("zh-CN")}
      </p>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="glass rounded-3xl p-5 mb-6 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs text-gray-500">注册邮箱</div>
          <div className="mt-1 text-sm">
            {u.email ?? "旧账户未记录"}
            {u.email && (
              <span className={`ml-2 text-[10px] ${u.email_verified_at ? "text-emerald-300" : "text-amber-300"}`}>
                {u.email_verified_at ? "已验证" : "未验证"}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">注册所在地（IP 粗略推测）</div>
          <div className="mt-1 text-sm">
            {[
              u.registration_geo.country ?? u.registration_geo.country_code,
              u.registration_geo.region,
              u.registration_geo.city,
            ]
              .filter(Boolean)
              .join(" · ") || "未获取"}
          </div>
          {u.registration_geo.source && (
            <div className="mt-1 text-[10px] text-gray-600">
              来源 {u.registration_geo.source}
              {u.registration_geo.captured_at
                ? ` · ${new Date(u.registration_geo.captured_at).toLocaleString("zh-CN")}`
                : ""}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">{u.balance}</div>
          <div className="text-xs text-gray-400">余额（点）</div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">${(u.total_recharge_cents / 100).toFixed(2)}</div>
          <div className="text-xs text-gray-400">累计充值</div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-2xl font-bold font-mono">
            {u.generation_count + u.wavespeed_generation_count}
          </div>
          <div className="text-xs text-gray-400">
            生成任务 · 上传 {u.upload_count}
          </div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-lg font-bold">
            {u.is_vip ? (
              <span className="text-purple-300">
                {u.vip_tier ? `${u.vip_tier.name}` : "VIP"}
              </span>
            ) : (
              <span className="text-gray-500">普通</span>
            )}
          </div>
          <div className="text-xs text-gray-400">
            {u.vip_expires_at ? `到期 ${new Date(u.vip_expires_at).toLocaleDateString("zh-CN")}` : "无 VIP"}
          </div>
        </div>
      </div>

      <div className="glass rounded-3xl p-5 mb-8">
        <div className="text-sm font-semibold mb-4">管理操作</div>
        <div className="flex flex-wrap gap-3">
          <select
            value={u.role}
            disabled={busy}
            onChange={(e) => void patch({ role: e.target.value }, `角色已改为 ${e.target.value}`)}
            className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => {
              const input = window.prompt("余额调整差额（整数，可为负）：", "0");
              if (input === null) return;
              const delta = Number(input);
              if (!Number.isInteger(delta) || delta === 0) return;
              void patch({ balance_delta: delta }, `余额已调整 ${delta > 0 ? "+" : ""}${delta}`);
            }}
            className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
          >
            调余额
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (u.is_vip) {
                if (!window.confirm("撤销该用户 VIP？")) return;
                void patch({ is_vip: false }, "已撤销 VIP");
              } else {
                const days = window.prompt("授予 VIP 天数（默认 30）：", "30");
                if (days === null) return;
                const d = Number(days) || 30;
                const expires = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
                void (async () => {
                  try {
                    const { tiers } = await api<{
                      tiers: { id: number; name: string; code: string }[];
                    }>("/api/admin/pricing/vip-tiers");
                    const active = tiers.filter((t) => true);
                    const pick =
                      active.length <= 1
                        ? active[0]?.id
                        : Number(
                            window.prompt(
                              `选择 VIP 等级 ID：\n${active.map((t) => `${t.id}=${t.name}(${t.code})`).join("\n")}`,
                              String(active[0]?.id ?? "")
                            )
                          );
                    void patch(
                      {
                        is_vip: true,
                        vip_expires_at: expires,
                        ...(Number.isInteger(pick) && pick > 0 ? { vip_tier_id: pick } : {}),
                      },
                      `已授予 VIP ${d} 天`
                    );
                  } catch {
                    void patch({ is_vip: true, vip_expires_at: expires }, `已授予 VIP ${d} 天`);
                  }
                })();
              }
            }}
            className="text-sm px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded-xl disabled:opacity-50"
          >
            {u.is_vip ? "撤销 VIP" : "授予 VIP"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const action = u.disabled_at ? "解封" : "封禁";
              if (!window.confirm(`确定${action}该用户？`)) return;
              void patch({ disabled: !u.disabled_at }, `已${action}`);
            }}
            className={`text-sm px-4 py-2 border rounded-xl disabled:opacity-50 ${
              u.disabled_at
                ? "bg-emerald-600/20 border-emerald-500/30 text-emerald-300"
                : "bg-red-600/20 border-red-500/30 text-red-300"
            }`}
          >
            {u.disabled_at ? "解封" : "封禁"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void patch(
                { plaything_access: !u.plaything_access },
                u.plaything_access ? "已关闭玩物专区" : "已开通玩物专区"
              )
            }
            className={`text-sm px-4 py-2 border rounded-xl disabled:opacity-50 ${
              u.plaything_access
                ? "bg-amber-600/20 border-amber-500/30 text-amber-300"
                : "bg-white/5 border-white/10 text-gray-300"
            }`}
          >
            {u.plaything_access ? "关闭玩物" : "开通玩物"}
          </button>
          <Link
            href={`/admin/transactions?user_id=${u.id}`}
            className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl"
          >
            查看流水
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="glass rounded-3xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">充值记录</div>
            <Link href={`/admin/transactions?user_id=${u.id}&type=recharge`} className="text-xs text-violet-300">
              查看全部
            </Link>
          </div>
          <div className="space-y-2 text-xs">
            {data.recent_recharges.map((t) => (
              <div key={t.id} className="flex justify-between border-b border-white/5 pb-2">
                <span>
                  {new Date(t.created_at).toLocaleString("zh-CN")} · {t.method ?? "—"}
                </span>
                <span className="font-mono">
                  +{t.amount}
                  {t.price_cents ? ` · $${(t.price_cents / 100).toFixed(2)}` : ""}
                </span>
              </div>
            ))}
            {data.recent_recharges.length === 0 && <p className="text-gray-500">暂无充值</p>}
          </div>
        </div>
        <div className="glass rounded-3xl p-5">
          <div className="text-sm font-semibold mb-3">最近流水</div>
          <div className="space-y-2 text-xs">
            {data.recent_transactions.map((t) => (
              <div key={t.id} className="flex justify-between border-b border-white/5 pb-2">
                <span>
                  {t.type} · {t.method ?? "—"}
                </span>
                <span className="font-mono text-gray-400">
                  {t.amount > 0 ? "+" : ""}
                  {t.amount}
                </span>
              </div>
            ))}
            {data.recent_transactions.length === 0 && <p className="text-gray-500">暂无流水</p>}
          </div>
        </div>
      </div>

      <AdminUserMediaSection userId={u.id} />

      <div className="glass rounded-3xl p-5 mt-8">
        <div className="text-sm font-semibold mb-3">加密订单</div>
        <div className="space-y-2 text-xs">
          {data.recent_crypto_payments.map((p) => (
            <div key={p.id} className="flex justify-between border-b border-white/5 pb-2">
              <span>
                {p.order_id.slice(0, 20)}… · {p.status} · {p.credited ? "已入账" : "未入账"}
              </span>
              <span className="font-mono">${(p.amount_usd_cents / 100).toFixed(2)}</span>
            </div>
          ))}
          {data.recent_crypto_payments.length === 0 && <p className="text-gray-500">暂无加密订单</p>}
        </div>
      </div>
    </div>
  );
}

type AdminMediaKind = "main" | "plaything" | "upload";

interface AdminMediaItem {
  id: number;
  channel: string;
  label: string;
  prompt: string;
  status: string;
  urls: string[];
  content_type: string | null;
  bytes?: number | null;
  is_adult: boolean;
  is_featured: boolean;
  expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface AdminMediaResponse {
  kind: AdminMediaKind;
  total: number;
  page: number;
  limit: number;
  media: AdminMediaItem[];
}

const MEDIA_TABS: Array<{ kind: AdminMediaKind; label: string }> = [
  { kind: "main", label: "创作中心" },
  { kind: "plaything", label: "玩物专区" },
  { kind: "upload", label: "上传素材" },
];

function AdminUserMediaSection({ userId }: { userId: number }) {
  const [kind, setKind] = useState<AdminMediaKind>("main");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminMediaResponse | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<AdminMediaResponse>(
        `/api/admin/users/${userId}/media?kind=${kind}&page=${page}&limit=24`
      );
      setData(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "媒体加载失败");
    }
  }, [kind, page, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <section className="glass rounded-3xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">用户媒体</h2>
          <p className="mt-1 text-xs text-gray-500">包含生成结果、成人标签、清理状态和上传素材。</p>
        </div>
        <div className="flex rounded-xl bg-black/30 p-1">
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => {
                setKind(tab.kind);
                setPage(1);
                setData(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                kind === tab.kind ? "bg-white text-black" : "text-gray-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {!data && !error && <p className="py-8 text-center text-sm text-gray-500">加载媒体中…</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.media.map((item) => {
          const mediaUrl = item.urls[0];
          const isVideo =
            item.content_type?.startsWith("video/") ||
            (mediaUrl ? /\.(mp4|webm|mov)(?:$|[?#])/i.test(mediaUrl) : false);
          return (
            <article key={`${kind}-${item.id}`} className={`overflow-hidden rounded-2xl border border-white/10 bg-black/20 ${item.deleted_at ? "opacity-60" : ""}`}>
              <div className="relative aspect-video bg-[#111]">
                {mediaUrl && !item.deleted_at ? (
                  isVideo ? (
                    <video src={mediaUrl} controls preload="metadata" className="h-full w-full object-contain" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl} alt={`媒体 ${item.id}`} loading="lazy" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-600">
                    {item.deleted_at ? "媒体已清理或删除" : "暂无媒体结果"}
                  </div>
                )}
                <div className="absolute left-2 top-2 flex gap-1">
                  {item.is_adult && <span className="rounded-full bg-red-600/90 px-2 py-0.5 text-[10px]">18+</span>}
                  {item.is_featured && <span className="rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px]">精选</span>}
                </div>
              </div>
              <div className="p-3 text-xs">
                <div className="font-mono text-gray-400">#{item.id} · {item.label} · {item.status}</div>
                {item.prompt && <p className="mt-2 line-clamp-2 text-gray-300">{item.prompt}</p>}
                <div className="mt-2 text-[10px] text-gray-600">
                  {new Date(item.created_at).toLocaleString("zh-CN")}
                  {item.expires_at
                    ? ` · 清理于 ${new Date(item.expires_at).toLocaleString("zh-CN")}`
                    : " · 永不过期/未设置"}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {data?.media.length === 0 && <p className="py-10 text-center text-sm text-gray-500">该分类暂无媒体</p>}
      {data && totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-gray-500">{page} / {totalPages} · 共 {data.total}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}
