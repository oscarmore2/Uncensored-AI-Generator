"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  ApiError,
  MODES,
  estimateCost,
  type ApiGeneration,
  type CatalogProduct,
  type CatalogMapping,
  type CatalogResponse,
} from "@/lib/client";
import { MODE_META, isGenerationMode, type GenerationMode } from "@/lib/generation-modes";
import { ParamControlGrid } from "@/components/ParamControls";
import type { ParamControl } from "@/lib/param-controls";
import { useApp } from "@/components/AppContext";
import { AdaptiveMedia } from "@/components/WorkMedia";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { useTranslations } from "next-intl";

type Phase = "idle" | "submitting" | "polling";

function MakePageInner() {
  const t = useTranslations("Make");
  const examplePrompts = t.raw("examples") as string[];
  const { user, refreshUser, toast } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<GenerationMode>(() => {
    const q = searchParams.get("mode");
    return isGenerationMode(q) ? q : "txt2img";
  });
  const [tier, setTier] = useState<string>("low");
  const [spicy, setSpicy] = useState(false);
  const [prompt, setPrompt] = useState(() => searchParams.get("prompt") ?? "");
  const [negative, setNegative] = useState(
    () => searchParams.get("negative") ?? t("defaultNegative")
  );
  const [ratio, setRatio] = useState("1:1");
  const [batch, setBatch] = useState(1);
  const [duration, setDuration] = useState("5");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    id: number;
    urls: string[];
    mode: string;
    isAdult: boolean;
    mediaExpiresAt: string | null;
  } | null>(null);
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicEnabled, setMagicEnabled] = useState(false);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [extraParams, setExtraParams] = useState<Record<string, string>>({});
  const pollingRef = useRef(false);
  const remixLoadedRef = useRef(false);

  const meta = MODE_META[mode];
  const isVip = Boolean(catalog?.user_vip.is_active);

  useEffect(() => {
    if (user && user.balance <= 0) router.replace("/pricing");
  }, [router, user]);

  useEffect(() => {
    const workId = searchParams.get("remix_work");
    if (!workId || remixLoadedRef.current) return;
    remixLoadedRef.current = true;
    api<{
      mode: string;
      prompt: string;
      negative_prompt: string | null;
      params: Record<string, unknown>;
    }>(`/api/public/works/${encodeURIComponent(workId)}`)
      .then((work) => {
        if (isGenerationMode(work.mode)) setMode(work.mode);
        setPrompt(work.prompt);
        if (work.negative_prompt) setNegative(work.negative_prompt);
        const p = work.params ?? {};
        if (typeof p.ratio === "string") setRatio(p.ratio);
        if (typeof p.duration === "string" || typeof p.duration === "number") {
          setDuration(String(p.duration));
        }
        if (typeof p.tier === "string") setTier(p.tier);
        if (typeof p.spicy === "boolean") setSpicy(p.spicy);
        if (p.batch === 1 || p.batch === 2 || p.batch === 4) setBatch(p.batch);
        const known = new Set(["ratio", "duration", "tier", "spicy", "batch", "product_id"]);
        setExtraParams(
          Object.fromEntries(
            Object.entries(p)
              .filter(
                ([key, value]) =>
                  !known.has(key) && (typeof value === "string" || typeof value === "number")
              )
              .map(([key, value]) => [key, String(value)])
          )
        );
        toast(t("copied"));
      })
      .catch((error) => toast(error instanceof Error ? error.message : t("copyFailed"), true));
  }, [searchParams, t, toast]);

  useEffect(() => {
    let cancelled = false;
    api<{ magic_prompt: boolean }>("/api/features")
      .then((f) => !cancelled && setMagicEnabled(Boolean(f.magic_prompt)))
      .catch(() => !cancelled && setMagicEnabled(false));
    api<CatalogResponse>("/api/catalog")
      .then((c) => !cancelled && setCatalog(c))
      .catch(() => !cancelled && setCatalog(null));
    return () => {
      cancelled = true;
    };
  }, []);

  /** 当前模式下的全部档位（含 Spicy），按档位顺序排列 */
  const modeProducts = useMemo(() => {
    if (!catalog) return [] as CatalogProduct[];
    return catalog.products.filter((p) => p.mode === mode);
  }, [catalog, mode]);

  const normalTiers = useMemo(
    () => modeProducts.filter((p) => !p.spicy).sort((a, b) => a.sort_order - b.sort_order),
    [modeProducts]
  );
  const spicyTiers = useMemo(
    () => modeProducts.filter((p) => p.spicy).sort((a, b) => a.sort_order - b.sort_order),
    [modeProducts]
  );

  const selectedProduct = useMemo(
    () =>
      modeProducts.find((p) => p.tier === tier && p.spicy === spicy) ??
      normalTiers.find((p) => p.is_default) ??
      normalTiers[0],
    [modeProducts, normalTiers, tier, spicy]
  );

  // 切换模式后若当前档位不存在（视频没有中档），回落到该模式的第一个可用档
  useEffect(() => {
    if (modeProducts.length === 0) return;
    const hit = modeProducts.find((p) => p.tier === tier && p.spicy === spicy);
    if (hit) return;
    const fallback = normalTiers.find((p) => p.is_default) ?? normalTiers[0];
    if (fallback) {
      setTier(fallback.tier);
      setSpicy(false);
    }
  }, [modeProducts, normalTiers, tier, spicy]);

  /**
   * 参数控件由「所选档位绑定的模型」的 schema 归一而来：
   * 模型不支持的字段不显示，枚举/数值上下限都以模型为准，
   * 换档位时控件形态自动切换。
   */
  const controls = useMemo<ParamControl[]>(
    () => selectedProduct?.params ?? [],
    [selectedProduct]
  );

  // 档位切换后，把不合法的当前值回落到模型允许的第一个值，避免按不存在的规格计费
  useEffect(() => {
    for (const c of controls) {
      if (c.kind !== "enum" || !c.options.length) continue;
      const current =
        c.key === "ratio" ? ratio : c.key === "duration" ? duration : extraParams[c.key];
      if (current && c.options.some((o) => o.value === current)) continue;
      const next = c.defaultValue && c.options.some((o) => o.value === c.defaultValue)
        ? c.defaultValue
        : c.options[0].value;
      if (c.key === "ratio") setRatio(next);
      else if (c.key === "duration") setDuration(next);
      else setExtraParams((prev) => (prev[c.key] === next ? prev : { ...prev, [c.key]: next }));
    }
  }, [controls, ratio, duration, extraParams]);

  const controlValues = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = { ...extraParams };
    out.ratio = ratio;
    out.duration = duration;
    return out;
  }, [extraParams, ratio, duration]);

  function setControlValue(key: string, next: string) {
    if (key === "ratio") setRatio(next);
    else if (key === "duration") setDuration(next);
    else setExtraParams((prev) => ({ ...prev, [key]: next }));
  }

  /** Spicy 档换成洋红主体色，与档位卡片保持一致 */
  const accent = selectedProduct?.spicy ? ("fuchsia" as const) : ("rose" as const);

  const cost = estimateCost({
    product: selectedProduct,
    batch: meta.supportsBatch ? batch : 1,
    durationSeconds: meta.category === "video" ? Number(duration) : undefined,
    discountBps: catalog?.user_vip.is_active ? (catalog.user_vip.tier?.discount_bps ?? 0) : 0,
  });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast(t("imageTooLarge"), true);
    const reader = new FileReader();
    reader.onload = (ev) => setImageBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function selectTier(product: CatalogProduct) {
    if (product.requires_vip && !isVip) {
      toast(t("spicyNeedsVip"), true);
      router.push("/pricing");
      return;
    }
    setTier(product.tier);
    setSpicy(product.spicy);
  }

  async function runMagicPrompt() {
    if (magicBusy) return;
    if (!prompt.trim()) return toast(t("promptFirst"), true);
    setMagicBusy(true);
    try {
      const data = await api<{ prompt: string; negative_prompt: string | null; source: string }>(
        "/api/prompts/magic",
        {
          method: "POST",
          body: JSON.stringify({
            prompt: prompt.trim(),
            mode,
            tier,
            spicy,
            ratio,
            negative_prompt: negative.trim() || undefined,
          }),
        }
      );
      setPrompt(data.prompt);
      if (data.negative_prompt) setNegative(data.negative_prompt);
      toast(data.source === "dolphin" ? t("magicDoneDolphin", { model: "" }) : t("magicDone", { model: "" }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("magicFailed"), true);
    } finally {
      setMagicBusy(false);
    }
  }

  async function startGeneration() {
    if (meta.needsPrompt && !prompt.trim()) return toast(t("promptRequired"), true);
    if (meta.needsImage && !imageBase64) return toast(t("imageRequired"), true);
    if (phase !== "idle") return;
    if (!selectedProduct) return toast(t("tierUnavailable"), true);

    setPhase("submitting");
    setResult(null);
    setProgress(0);
    try {
      const gen = await api<ApiGeneration>("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          mode,
          tier: selectedProduct.tier,
          spicy: selectedProduct.spicy,
          prompt: prompt.trim(),
          negative_prompt: meta.supportsNegative ? negative : "",
          ratio,
          duration: meta.category === "video" ? duration : undefined,
          batch: meta.supportsBatch ? batch : 1,
          image_base64: imageBase64,
          ...extraParams,
        }),
      });
      toast(t("submitted", { id: gen.id }));
      await refreshUser();
      setPhase("polling");
      void poll(gen.id);
    } catch (e) {
      const errorMessage =
        e instanceof ApiError && e.code === "INSUFFICIENT_CREDITS"
          ? t("recharge")
          : e instanceof Error
            ? e.message
            : String(e);
      toast(t("generationFailed", { error: errorMessage }), true);
      if (
        e instanceof ApiError &&
        (e.code === "INSUFFICIENT_CREDITS" || e.code === "SPICY_REQUIRES_VIP")
      ) {
        router.push("/pricing");
      }
      setPhase("idle");
    }
  }

  async function poll(genId: number) {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 4500));
        try {
          const data = await api<{
            status: string;
            progress?: number;
            result_urls: string[] | null;
            error?: string | null;
            is_adult?: boolean;
            media_expires_at?: string | null;
          }>(`/api/generations/${genId}/status`);
          if (typeof data.progress === "number") setProgress(data.progress);
          if ((data.status === "succeeded" || data.status === "partial") && data.result_urls?.length) {
            setResult({
              id: genId,
              urls: data.result_urls,
              mode,
              isAdult: Boolean(data.is_adult),
              mediaExpiresAt: data.media_expires_at ?? null,
            });
            setProgress(100);
            await refreshUser();
            return;
          }
          if (data.status === "failed") {
            toast(data.error ? t("generationFailed", { error: data.error }) : t("failedRefunded"), true);
            await refreshUser();
            return;
          }
        } catch {
          // 网络抖动，继续轮询
        }
      }
      toast(t("timeout"), true);
    } finally {
      pollingRef.current = false;
      setPhase("idle");
    }
  }

  function TierCard({ product }: { product: CatalogProduct }) {
    const active = selectedProduct?.id === product.id;
    const locked = product.requires_vip && !isVip;
    return (
      <button
        type="button"
        onClick={() => selectTier(product)}
        className={`relative text-left px-4 py-3 rounded-2xl border transition-colors ${
          active
            ? product.spicy
              ? "bg-fuchsia-600/20 border-fuchsia-500"
              : "bg-rose-600/20 border-rose-500"
            : "bg-white/5 border-white/10 hover:border-white/25"
        } ${locked ? "opacity-60" : ""}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">{product.label}</span>
          {product.spicy && (
            <span className="px-1.5 py-px rounded text-[10px] font-bold bg-fuchsia-600 text-white">
              SPICY
            </span>
          )}
          {locked && <i className="fas fa-lock text-[10px] text-amber-400" />}
        </div>
        <div className="text-[11px] text-gray-400 leading-snug">{product.description}</div>
        <div className="mt-1.5 text-[11px] font-mono text-rose-300">
          {product.credit_cost}
          {t("creditsUnit")}
          {product.unit_seconds > 0 ? ` / ${product.unit_seconds}s` : ""}
        </div>
      </button>
    );
  }

  const noTiers = catalog !== null && modeProducts.length === 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter">{t("title")}</h1>
          <p className="text-gray-400 mt-1">
            {t("subtitle")}
            {!user?.is_vip ? ` • ${t("safetyNotice")}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {MODES.map((m) => {
          const cheapest = catalog?.products
            .filter((p) => p.mode === m.mode && !p.spicy)
            .sort((a, b) => a.credit_cost - b.credit_cost)[0];
          return (
            <button
              key={m.mode}
              onClick={() => setMode(m.mode)}
              className={`mode-tab flex-1 md:flex-none px-5 py-3 text-sm font-semibold rounded-3xl flex items-center justify-center gap-x-2 border ${
                m.mode === mode ? "active border-rose-600" : "bg-white/5 border-white/10"
              }`}
            >
              <i className={`fas ${m.icon}`} />
              <span>
                {t.has(`modes.${m.mode}`) ? t(`modes.${m.mode}` as "modes.txt2img") : m.fallbackLabel}
              </span>
              {cheapest && (
                <span className="text-[10px] px-1.5 py-px bg-white/10 rounded">
                  {cheapest.credit_cost}
                  {t("creditsUnit")}起
                </span>
              )}
            </button>
          );
        })}
      </div>

      {noTiers && (
        <div className="mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-100/90">
          {t("tierUnavailable")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass rounded-3xl p-6">
          <div className="mb-5">
            <label className="text-sm font-semibold text-gray-300 mb-2 block">{t("tierLabel")}</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {normalTiers.map((p) => (
                <TierCard key={p.id} product={p} />
              ))}
            </div>

            {spicyTiers.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-fuchsia-300">{t("spicyLabel")}</span>
                  {!isVip && (
                    <button
                      type="button"
                      onClick={() => router.push("/pricing")}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                    >
                      {t("spicyUnlock")}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {spicyTiers.map((p) => (
                    <TierCard key={p.id} product={p} />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  {t("spicyNotice")}
                </p>
              </div>
            )}
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <label className="text-sm font-semibold text-gray-300">{t("prompt")}</label>
              <div className="flex items-center gap-2">
                {magicEnabled && (
                  <button
                    type="button"
                    onClick={() => void runMagicPrompt()}
                    disabled={magicBusy || phase !== "idle"}
                    className="magic-prompt-btn inline-flex items-center gap-x-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium text-black disabled:opacity-50 disabled:cursor-not-allowed transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    title={t("magicTitle")}
                  >
                    {magicBusy ? (
                      <i className="fas fa-spinner fa-spin text-[13px] text-[#5c4a7a]" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-[#5c4a7a]">
                        <path
                          d="M12 2.5l1.6 5.2L19 9.3l-5.2 1.6L12 16.1l-1.6-5.2L5 9.3l5.4-1.6L12 2.5z"
                          fill="currentColor"
                          opacity="0.95"
                        />
                        <path d="M18.5 14.2l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7.7-2.2z" fill="currentColor" opacity="0.75" />
                        <path d="M6.2 15.5l.45 1.4 1.4.45-1.4.45-.45 1.4-.45-1.4-1.4-.45 1.4-.45.45-1.4z" fill="currentColor" opacity="0.65" />
                      </svg>
                    )}
                    <span>{magicBusy ? t("casting") : t("magic")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPrompt(examplePrompts[Math.floor(Math.random() * examplePrompts.length)])}
                  className="text-xs flex items-center gap-x-1 text-rose-400 hover:text-rose-300"
                >
                  <i className="fas fa-dice" /> <span>{t("random")}</span>
                </button>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="prompt-box w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl p-4 text-sm placeholder:text-gray-500 outline-none min-h-[120px]"
              placeholder={mode === "imgedit" ? t("editPlaceholder") : t("promptPlaceholder")}
            />
          </div>

          {meta.supportsNegative && (
            <div className="mb-5">
              <label className="text-sm font-semibold text-gray-300 mb-2 block">{t("negative")}</label>
              <input
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                className="w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl px-4 py-3 text-sm outline-none"
              />
            </div>
          )}

          {meta.needsImage && (
            <div className="mb-5">
              <label className="text-sm font-semibold text-gray-300 mb-2 block">{t("referenceImage")}</label>
              <label className="block border-2 border-dashed border-white/20 hover:border-rose-500/40 rounded-3xl p-8 text-center cursor-pointer transition-colors">
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                {imageBase64 ? (
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageBase64} alt={t("preview")} className="mx-auto max-h-48 rounded-2xl shadow-xl mb-3" />
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setImageBase64(null);
                      }}
                      className="text-xs px-4 py-1 bg-white/10 hover:bg-white/20 rounded-full"
                    >
                      {t("removeImage")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <i className="fas fa-cloud-upload-alt text-4xl text-gray-500 mb-3" />
                    <p className="text-sm">{t("uploadReference")}</p>
                    <p className="text-xs text-gray-500 mt-1">{t("uploadHint")}</p>
                  </div>
                )}
              </label>
            </div>
          )}

          <div className="mb-2">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-300">{t("advanced")}</label>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="text-xs text-gray-400 flex items-center gap-1"
              >
                <span>{advancedOpen ? t("collapse") : t("expand")}</span>
                <i className={`fas fa-chevron-${advancedOpen ? "up" : "down"} text-xs`} />
              </button>
            </div>

            {advancedOpen && (
              <div className="space-y-3">
                <ParamControlGrid
                  controls={controls}
                  values={controlValues}
                  onChange={setControlValue}
                  accent={accent}
                  labelOf={(c) =>
                    t.has(`params.${c.key}`) ? t(`params.${c.key}` as "params.ratio") : c.key
                  }
                />
                {meta.supportsBatch && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">{t("quantity")}</label>
                      <select
                        value={batch}
                        onChange={(e) => setBatch(Number(e.target.value))}
                        className={`w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none ${
                          accent === "fuchsia" ? "focus:border-fuchsia-500/60" : "focus:border-rose-500/60"
                        }`}
                      >
                        <option value={1}>{t("oneItem")}</option>
                        <option value={2}>{t("twoItems")}</option>
                        <option value={4}>{t("fourItems")}</option>
                      </select>
                    </div>
                  </div>
                )}
                {controls.length === 0 && (
                  <p className="text-xs text-gray-500">{t("noExtraParams")}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 glass rounded-3xl p-6 flex flex-col">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-xs text-gray-400">{t("estimatedCost")}</div>
                <div className="flex items-baseline">
                  <span className="text-5xl font-bold font-mono text-rose-400">{cost}</span>
                  <span className="ml-2 text-lg text-gray-400">{t("credits")}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">{t("balance")}</div>
                <div className="flex items-center justify-end gap-x-1">
                  <i className="fas fa-coins text-amber-400" />
                  <span className="font-mono text-2xl font-semibold stat-number">{user?.balance ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="bg-black/40 rounded-2xl p-4 text-xs space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-400">{t("tierLabel")}</span>
                <span className="text-right max-w-[65%] truncate flex items-center gap-1 justify-end">
                  {selectedProduct?.spicy && (
                    <span className="px-1 rounded text-[9px] font-bold bg-fuchsia-600 text-white">SPICY</span>
                  )}
                  {selectedProduct?.label ?? "—"}
                </span>
              </div>
              {catalog?.user_vip.is_active && (catalog.user_vip.tier?.discount_bps ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t("vipDiscount")}</span>
                  <span className="text-purple-300">
                    {catalog.user_vip.tier?.name} -{catalog.user_vip.tier?.discount_percent}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">{t("estimatedTime")}</span>
                <span>{meta.category === "video" ? "60–240s" : "8–40s"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t("ratio")}</span> <span>{ratio}</span>
              </div>
              {meta.category === "video" && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t("params.duration")}</span> <span>{duration}s</span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={startGeneration}
            disabled={phase !== "idle" || !selectedProduct}
            className="generate-btn w-full py-4 text-white font-bold text-lg rounded-3xl flex items-center justify-center gap-x-3 shadow-xl active:scale-[0.985] disabled:opacity-60"
          >
            {phase === "idle" ? (
              <>
                <i className="fas fa-magic" /> <span>{t("generate")}</span>
              </>
            ) : (
              <>
                <i className="fas fa-spinner fa-spin" />
                <span>{phase === "submitting" ? t("submitting") : t("generating")}</span>
              </>
            )}
          </button>

          <div className="mt-3 text-center">
            <button
              onClick={() => router.push("/pricing")}
              className="text-xs text-gray-400 hover:text-rose-400 flex items-center justify-center gap-x-1 mx-auto"
            >
              <i className="fas fa-coins fa-sm" /> <span>{t("recharge")}</span>
            </button>
          </div>
        </div>
      </div>

      {phase === "polling" && !result && (
        <div className="mt-8 glass rounded-3xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
          <div className="text-sm mb-3">{t("progress", { progress })}</div>
          <div className="max-w-md mx-auto h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-rose-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-8">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-x-2">
              <i className="fas fa-check-circle text-emerald-400" /> {t("completed")}
              {result.isAdult && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
              )}
              <MediaExpiryBadge expiresAt={result.mediaExpiresAt} deletedAt={null} compact />
            </h3>
            <button onClick={() => setResult(null)} className="text-xs px-3 py-1 bg-white/5 rounded-full">
              {t("close")}
            </button>
          </div>
          <div className="glass rounded-3xl overflow-hidden">
            <AdaptiveMedia mode={result.mode} urls={result.urls} />
            <div className="p-5 flex gap-3">
              <a
                href={result.urls[0]}
                download={`wanwankewu_${Date.now()}${result.mode.endsWith("vid") ? ".mp4" : ".jpg"}`}
                target="_blank"
                rel="noopener"
                className="flex-1 py-2.5 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-x-2"
              >
                <i className="fas fa-download" /> <span>{t("download")}</span>
              </a>
              <a
                href="/history"
                className="flex-1 py-2.5 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-center leading-8"
              >
                {t("viewAll")}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MakePage() {
  return (
    <Suspense>
      <MakePageInner />
    </Suspense>
  );
}
