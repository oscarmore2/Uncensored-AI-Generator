"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useApp } from "./AppContext";

const PACKAGES = [
  { credits: 100, price: 29, name: "基础包", perPoint: "¥0.29/点", popular: false },
  { credits: 500, price: 129, name: "进阶包", perPoint: "¥0.26/点", popular: true },
  { credits: 1200, price: 299, name: "豪华包", perPoint: "¥0.25/点", popular: false },
  { credits: 3000, price: 699, name: "至尊包", perPoint: "¥0.23/点", popular: false },
];

export function RechargeModal() {
  const { rechargeOpen, setRechargeOpen, refreshUser, toast } = useApp();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cryptoWaiting, setCryptoWaiting] = useState(false);

  if (!rechargeOpen) return null;

  const pkg = PACKAGES.find((p) => p.credits === selected);

  async function recharge() {
    if (!pkg || busy) return;
    setBusy(true);
    try {
      const data = await api<{ demo?: boolean; message?: string; checkout_url?: string }>(
        "/api/payments/create-checkout",
        { method: "POST", body: JSON.stringify({ package: String(pkg.credits) }) }
      );
      if (data.demo) {
        toast(data.message ?? "充值成功");
        await refreshUser();
        setRechargeOpen(false);
      } else if (data.checkout_url) {
        window.open(data.checkout_url, "_blank", "noopener");
        setRechargeOpen(false);
      }
    } catch (e) {
      toast(`充值失败: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function rechargeCrypto() {
    if (!pkg || busy) return;
    setBusy(true);
    try {
      const data = await api<{ order_id: string; checkout_url: string }>(
        "/api/payments/crypto/create",
        { method: "POST", body: JSON.stringify({ package: String(pkg.credits) }) }
      );
      window.open(data.checkout_url, "_blank", "noopener");
      setCryptoWaiting(true);
      toast("已打开加密支付页面，支付确认后点数自动到账");
      void pollCryptoStatus(data.order_id);
    } catch (e) {
      toast(`创建加密支付失败: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function pollCryptoStatus(orderId: string) {
    // 链上确认通常需要几分钟，轮询最长 ~30 分钟
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const data = await api<{ status: string; credited: boolean; credits: number }>(
          `/api/payments/crypto/status?order_id=${encodeURIComponent(orderId)}`
        );
        if (data.credited) {
          toast(`加密支付成功，+${data.credits} 点已到账`);
          await refreshUser();
          setCryptoWaiting(false);
          setRechargeOpen(false);
          return;
        }
        if (["cancel", "fail", "system_fail", "create_failed"].includes(data.status)) {
          toast("加密支付未完成（已取消或失败）", true);
          setCryptoWaiting(false);
          return;
        }
      } catch {
        // 会话过期或网络抖动时静默继续
      }
    }
    setCryptoWaiting(false);
  }

  async function buyVip() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("/api/payments/subscribe-vip", { method: "POST" });
      toast(data.message ?? "VIP 订阅成功");
      await refreshUser();
      setRechargeOpen(false);
    } catch {
      toast("VIP 订阅失败", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[90] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setRechargeOpen(false);
      }}
    >
      <div className="max-w-lg w-full glass rounded-3xl p-7 modal-pop">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold">充值点数</h3>
          <button onClick={() => setRechargeOpen(false)} className="text-2xl text-gray-400 hover:text-white">
            &times;
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {PACKAGES.map((p) => (
            <div
              key={p.credits}
              onClick={() => setSelected(p.credits)}
              className={`package-card cursor-pointer rounded-2xl p-4 bg-black/30 relative border ${
                selected === p.credits
                  ? "selected border-rose-500"
                  : p.popular
                    ? "border-2 border-rose-500"
                    : "border-white/20"
              }`}
            >
              {p.popular && (
                <div className="absolute -top-2 -right-2 bg-rose-600 text-[10px] px-3 py-0.5 rounded-full font-bold">
                  最受欢迎
                </div>
              )}
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-3xl font-mono font-bold mt-1">
                    {p.credits} <span className="text-xs align-super text-gray-400">点</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">¥{p.price}</div>
                  <div className="text-[10px] text-emerald-400">{p.perPoint}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6 p-4 rounded-2xl border border-amber-500/30 bg-amber-950/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-x-2">
                <i className="fas fa-crown text-amber-400" /> VIP 月卡
              </div>
              <div className="text-xs text-gray-400">每月自动赠送 800 点 + 优先队列</div>
            </div>
            <div className="text-right">
              <div className="font-bold">
                ¥99<span className="text-xs font-normal">/月</span>
              </div>
              <button
                onClick={buyVip}
                disabled={busy}
                className="mt-1 text-xs px-4 py-1 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-full disabled:opacity-50"
              >
                订阅
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={recharge}
          disabled={!pkg || busy}
          className="w-full py-4 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 font-bold rounded-3xl flex items-center justify-center gap-x-2 disabled:opacity-50"
        >
          {busy ? (
            <span>
              <i className="fas fa-spinner fa-spin mr-2" /> 处理中...
            </span>
          ) : pkg ? (
            <span>
              支付 ¥{pkg.price} 并获得 {pkg.credits} 点数
            </span>
          ) : (
            <span>请选择充值包</span>
          )}
        </button>

        <button
          onClick={rechargeCrypto}
          disabled={!pkg || busy || cryptoWaiting}
          className="mt-3 w-full py-4 bg-white/5 hover:bg-white/10 border border-emerald-500/40 text-emerald-300 font-bold rounded-3xl flex items-center justify-center gap-x-2 disabled:opacity-50"
        >
          {cryptoWaiting ? (
            <span>
              <i className="fas fa-spinner fa-spin mr-2" /> 等待链上确认，到账后自动关闭...
            </span>
          ) : (
            <span>
              <i className="fab fa-bitcoin mr-2" />
              加密货币支付（USDT / USDC）
            </span>
          )}
        </button>
        <p className="text-center text-[10px] mt-3 text-gray-500">
          加密支付经 Cryptomus 结算 • 支付确认后点数自动到账
        </p>
      </div>
    </div>
  );
}
