"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { AdaptiveMedia } from "@/components/WorkMedia";

interface PlaythingProduct {
  id: number;
  model_id: string;
  label: string;
  credit_cost: number;
  is_recommended: boolean;
  sort_order: number;
  type: string;
  description: string;
  thumbnail_url: string | null;
  param_schema: {
    properties: Record<
      string,
      {
        type?: string;
        description?: string;
        default?: unknown;
        enum?: unknown[];
        minimum?: number;
        maximum?: number;
      }
    >;
    required: string[];
  } | null;
}

interface PlaythingGen {
  id: number;
  product_id: number;
  product_label: string | null;
  model_id: string | null;
  prompt: string;
  status: string;
  progress: number;
  result_urls: string[] | null;
  cost: number;
  error: string | null;
  created_at: string;
}

type Phase = "idle" | "submitting" | "polling";

const SKIP_KEYS = new Set([
  "prompt",
  "negative_prompt",
  "image",
  "image_url",
  "images",
  "video",
  "mask",
]);

export default function PlaythingPage() {
  const { user, refreshUser, toast, setRechargeOpen } = useApp();
  const [products, setProducts] = useState<PlaythingProduct[]>([]);
  const [note, setNote] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PlaythingGen | null>(null);
  const [history, setHistory] = useState<PlaythingGen[]>([]);
  const pollingRef = useRef(false);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await api<{ products: PlaythingProduct[]; note?: string }>(
        "/api/plaything/catalog"
      );
      setProducts(data.products);
      setNote(data.note ?? "");
      setForbidden(false);
      setSelectedId((prev) => prev ?? data.products[0]?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
        return;
      }
      toast(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [toast]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<PlaythingGen[]>("/api/plaything/generations"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadHistory();
  }, [loadCatalog, loadHistory]);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId]
  );

  const schemaFields = useMemo(() => {
    if (!selected?.param_schema?.properties) return [];
    return Object.entries(selected.param_schema.properties).filter(([k]) => !SKIP_KEYS.has(k));
  }, [selected]);

  const needsImage = useMemo(() => {
    if (!selected) return false;
    const req = selected.param_schema?.required ?? [];
    if (req.some((k) => /image|video|mask/i.test(k))) return true;
    return /i2v|i2i|image|face|breast|infinite/i.test(selected.model_id + selected.type);
  }, [selected]);

  useEffect(() => {
    if (!selected?.param_schema?.properties) {
      setExtra({});
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(selected.param_schema.properties)) {
      if (SKIP_KEYS.has(k)) continue;
      if (v.default !== undefined && v.default !== null) {
        next[k] = String(v.default);
      }
    }
    setExtra(next);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(file: File | null) {
    if (!file) {
      setImageBase64(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageBase64(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function pollUntilDone(id: number) {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setPhase("polling");
    try {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const g = await api<PlaythingGen>(`/api/plaything/generations/${id}`);
        setProgress(g.progress);
        if (g.status === "succeeded") {
          setResult(g);
          setPhase("idle");
          await refreshUser();
          await loadHistory();
          toast("生成完成");
          return;
        }
        if (g.status === "failed") {
          setResult(g);
          setPhase("idle");
          await refreshUser();
          await loadHistory();
          toast(g.error || "生成失败，点数已退回");
          return;
        }
      }
      toast("仍在处理中，可稍后在下方历史查看");
      setPhase("idle");
    } finally {
      pollingRef.current = false;
    }
  }

  async function submit() {
    if (!selected || phase !== "idle") return;
    if (needsImage && !imageBase64) {
      toast("该模型需要上传参考图");
      return;
    }
    if (!prompt.trim() && !needsImage) {
      toast("请填写提示词");
      return;
    }
    if ((user?.balance ?? 0) < selected.credit_cost) {
      toast("点数不足");
      setRechargeOpen(true);
      return;
    }

    setPhase("submitting");
    setProgress(0);
    setResult(null);
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extra)) {
        if (v === "") continue;
        const meta = selected.param_schema?.properties?.[k];
        if (meta?.type === "integer" || meta?.type === "number") {
          const n = Number(v);
          if (!Number.isNaN(n)) params[k] = n;
        } else if (meta?.type === "boolean") {
          params[k] = v === "true" || v === "1";
        } else {
          params[k] = v;
        }
      }

      const gen = await api<PlaythingGen>("/api/plaything/generations", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          prompt,
          params,
          image_base64: imageBase64,
        }),
      });
      await refreshUser();
      setProgress(gen.progress);
      void pollUntilDone(gen.id);
    } catch (e) {
      setPhase("idle");
      toast(e instanceof ApiError ? e.message : "提交失败");
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center px-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-3">玩物专区</h1>
        <p className="text-gray-400 text-sm">
          暂无访问权限。请联系管理员开通，或开通带玩物权限的 VIP 等级。
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tighter mb-2">玩物专区</h1>
        <p className="text-gray-400 text-sm">
          WaveSpeed 精选模型 · 独立定价
          {note ? ` · ${note}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        <aside className="space-y-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left rounded-2xl overflow-hidden border transition-colors ${
                selectedId === p.id
                  ? "border-rose-500/50 bg-rose-500/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <div className="aspect-[16/9] bg-[#151515]">
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-2xl font-black">
                    {p.label.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.label}</span>
                  {p.is_recommended && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      推荐
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {p.type || "model"} · <span className="text-rose-300 font-mono">{p.credit_cost} 点</span>
                </div>
              </div>
            </button>
          ))}
          {products.length === 0 && (
            <p className="text-gray-500 text-sm">暂无上架模型，请稍后再来。</p>
          )}
        </aside>

        <section className="space-y-6">
          {selected && (
            <>
              <div className="glass rounded-3xl p-6 space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">{selected.label}</h2>
                  <p className="text-xs text-gray-500 font-mono mt-1">{selected.model_id}</p>
                  {selected.description && (
                    <p className="text-sm text-gray-400 mt-2 line-clamp-3">{selected.description}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder="描述你想生成的内容…"
                    className="w-full bg-[#111] border border-white/10 rounded-2xl px-4 py-3 text-sm outline-none resize-y"
                  />
                </div>

                {needsImage && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">参考图 *</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                      className="text-sm text-gray-400"
                    />
                    {imageBase64 && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageBase64}
                        alt=""
                        className="mt-2 max-h-40 rounded-xl border border-white/10"
                      />
                    )}
                  </div>
                )}

                {schemaFields.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {schemaFields.slice(0, 8).map(([key, meta]) => (
                      <div key={key}>
                        <label className="text-xs text-gray-400 block mb-1">
                          {key}
                          {meta.description ? (
                            <span className="text-gray-600"> · {meta.description.slice(0, 40)}</span>
                          ) : null}
                        </label>
                        {meta.enum ? (
                          <select
                            value={extra[key] ?? ""}
                            onChange={(e) => setExtra({ ...extra, [key]: e.target.value })}
                            className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                          >
                            {meta.enum.map((opt) => (
                              <option key={String(opt)} value={String(opt)}>
                                {String(opt)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={extra[key] ?? ""}
                            onChange={(e) => setExtra({ ...extra, [key]: e.target.value })}
                            className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm text-gray-400">
                    消耗{" "}
                    <span className="text-rose-300 font-mono font-semibold">
                      {selected.credit_cost}
                    </span>{" "}
                    点（无 VIP 折扣）
                  </div>
                  <button
                    type="button"
                    disabled={phase !== "idle"}
                    onClick={() => void submit()}
                    className="px-6 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
                  >
                    {phase === "idle" ? "开始生成" : phase === "submitting" ? "提交中…" : `生成中 ${progress}%`}
                  </button>
                </div>

                {phase === "polling" && (
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all"
                      style={{ width: `${Math.max(5, progress)}%` }}
                    />
                  </div>
                )}
              </div>

              {result?.result_urls && result.result_urls.length > 0 && (
                <div className="glass rounded-3xl p-6">
                  <h3 className="font-semibold mb-4">本次结果</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {result.result_urls && (
                      <AdaptiveMedia urls={result.result_urls} className="rounded-2xl overflow-hidden" />
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="glass rounded-3xl p-6">
            <h3 className="font-semibold mb-4">最近玩物任务</h3>
            <div className="space-y-2 text-sm">
              {history.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2"
                >
                  <span>
                    #{g.id} · {g.product_label || g.model_id} · {g.status}
                  </span>
                  <span className="font-mono text-gray-400">{g.cost} 点</span>
                </div>
              ))}
              {history.length === 0 && <p className="text-gray-500 text-xs">暂无记录</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
