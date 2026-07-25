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
  // 引流页「同款参数创作」通过 query 带入 prompt/negative/mode
  const searchParams = useSearchParams();
  const [modeIdx, setModeIdx] = useState(() => {
    const idx = MODES.findIndex((m) => m.key === searchParams.get("mode"));
    return idx >= 0 ? idx : 0;
  });
  const [prompt, setPrompt] = useState(() => searchParams.get("prompt") ?? "");
  const [negative, setNegative] = useState(
    () => searchParams.get("negative") ?? t("defaultNegative")
  );
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("quality");
  const [style, setStyle] = useState("realistic");
  const [batch, setBatch] = useState(1);
  const [undressVariant, setUndressVariant] = useState<"female" | "male" | "couple">("female");
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
  const [zenModel, setZenModel] = useState<string>("");
  const [duration, setDuration] = useState("5");
  const [resolution, setResolution] = useState("1280x720");
  const [extraParams, setExtraParams] = useState<Record<string, string>>({});
  const pollingRef = useRef(false);
  const remixLoadedRef = useRef(false);

  useEffect(() => {
    if (user && user.balance <= 0) {
      router.replace("/pricing");
    }
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
        const index = MODES.findIndex((item) => item.key === work.mode);
        if (index >= 0) setModeIdx(index);
        setPrompt(work.prompt);
        if (work.negative_prompt) setNegative(work.negative_prompt);
        const p = work.params ?? {};
        if (typeof p.ratio === "string") setRatio(p.ratio);
        if (typeof p.style === "string") setStyle(p.style);
        if (typeof p.quality === "string") setQuality(p.quality);
        if (typeof p.duration === "string" || typeof p.duration === "number") setDuration(String(p.duration));
        if (typeof p.resolution === "string") setResolution(p.resolution);
        if (typeof p.zen_model === "string") setZenModel(p.zen_model);
        if (p.batch === 1 || p.batch === 2 || p.batch === 4) setBatch(p.batch);
        if (typeof p.image_base64 === "string") setImageBase64(p.image_base64);
        const known = new Set(["ratio", "style", "quality", "duration", "resolution", "zen_model", "batch", "image_base64", "product_id"]);
        setExtraParams(
          Object.fromEntries(
            Object.entries(p)
              .filter(([key, value]) => !known.has(key) && (typeof value === "string" || typeof value === "number"))
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
      .then((f) => {
        if (!cancelled) setMagicEnabled(Boolean(f.magic_prompt));
      })
      .catch(() => {
        if (!cancelled) setMagicEnabled(false);
      });
    api<CatalogResponse>("/api/catalog")
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modeKey = MODES[modeIdx].key;
  const isUndress = modeKey === "undress";

  const modeProducts = useMemo(() => {
    if (!catalog) return [] as CatalogProduct[];
    if (isUndress) {
      return catalog.products.filter(
        (p) => p.mode === "undress" && p.variant_key === undressVariant
      );
    }
    return catalog.products.filter((p) => p.mode === modeKey && !p.variant_key);
  }, [catalog, modeKey, isUndress, undressVariant]);

  const selectedProduct = useMemo(() => {
    if (modeProducts.length === 0) return undefined;
    if (zenModel) {
      const hit = modeProducts.find((p) => p.zen_model === zenModel);
      if (hit) return hit;
    }
    return modeProducts.find((p) => p.is_default) ?? modeProducts[0];
  }, [modeProducts, zenModel]);

  useEffect(() => {
    if (!selectedProduct) return;
    if (zenModel !== selectedProduct.zen_model) {
      setZenModel(selectedProduct.zen_model);
    }
  }, [selectedProduct, zenModel]);

  const modeMappings = useMemo(() => {
    if (!catalog) return [] as CatalogMapping[];
    return catalog.param_mappings.filter((m) => m.mode === modeKey && m.enabled);
  }, [catalog, modeKey]);

  const cost = estimateCost({
    product: selectedProduct,
    batch: isUndress ? 1 : batch,
    mode: modeKey,
    discountBps: catalog?.user_vip.is_active ? catalog.user_vip.tier?.discount_bps ?? 0 : 0,
  });
  const needsImage = modeKey === "img2img" || modeKey === "img2vid" || isUndress;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast(t("imageTooLarge"), true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setImageBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function runMagicPrompt() {
    if (magicBusy) return;
    if (!prompt.trim()) return toast(t("promptFirst"), true);
    setMagicBusy(true);
    try {
      const data = await api<{
        prompt: string;
        negative_prompt: string | null;
        source: string;
        target: { mode: string; tool: string; model: string } | null;
      }>("/api/prompts/magic", {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim(),
          mode: MODES[modeIdx].key,
          style,
          ratio,
          quality,
          undress_variant: undressVariant,
          negative_prompt: negative.trim() || undefined,
          zen_model: selectedProduct?.zen_model,
        }),
      });
      setPrompt(data.prompt);
      if (data.negative_prompt) setNegative(data.negative_prompt);
      const modelHint = data.target?.model ? ` · ${data.target.model}` : "";
      toast(
        data.source === "dolphin"
          ? t("magicDoneDolphin", { model: modelHint })
          : t("magicDone", { model: modelHint })
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : t("magicFailed"), true);
    } finally {
      setMagicBusy(false);
    }
  }

  async function startGeneration() {
    if (!isUndress && !prompt.trim()) return toast(t("promptRequired"), true);
    if (needsImage && !imageBase64) return toast(t("imageRequired"), true);
    if (phase !== "idle") return;

    setPhase("submitting");
    setResult(null);
    setProgress(0);
    try {
      const gen = await api<ApiGeneration>("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          mode: modeKey,
          prompt: prompt.trim(),
          negative_prompt: negative,
          ratio,
          style,
          quality,
          duration: modeKey.includes("vid") ? duration : undefined,
          resolution: modeKey === "txt2vid" ? resolution : undefined,
          zen_model: selectedProduct?.zen_model,
          batch: isUndress ? 1 : batch,
          undress_variant: undressVariant,
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
        (e instanceof ApiError && e.code === "INSUFFICIENT_CREDITS") ||
        (e instanceof Error && e.message.includes("点数不足"))
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
      for (let i = 0; i < 40; i++) {
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
              mode: modeKey,
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
        {MODES.map((m, i) => {
          const defaultCost =
            catalog?.products.find((p) => p.mode === m.key && p.is_default)?.credit_cost ??
            catalog?.products.find((p) => p.mode === m.key)?.credit_cost;
          return (
            <button
              key={m.key}
              onClick={() => setModeIdx(i)}
              className={`mode-tab flex-1 md:flex-none px-6 py-3 text-sm font-semibold rounded-3xl flex items-center justify-center gap-x-2 border ${
                i === modeIdx ? "active border-rose-600" : "bg-white/5 border-white/10"
              }`}
            >
              <i className={`fas ${m.icon}`} />
              <span>{t.has(`modes.${m.key}`) ? t(`modes.${m.key}` as "modes.txt2img") : m.label}</span>
              {defaultCost !== undefined && (
                <span className="text-[10px] px-1.5 py-px bg-white/10 rounded">{defaultCost}{t("creditsUnit")}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass rounded-3xl p-6">
          {isUndress ? (
            <>
              <div className="mb-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-100/90">
                {t("legacyDisabled")}
              </div>
              <div className="mb-5">
                <label className="text-sm font-semibold text-gray-300 mb-2 block">{t("objectType")}</label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { key: "female", label: t("female") },
                      { key: "male", label: t("male") },
                      { key: "couple", label: t("couple") },
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setUndressVariant(v.key)}
                      className={`px-4 py-2 text-sm rounded-2xl border ${
                        undressVariant === v.key
                          ? "bg-rose-600 border-rose-500 text-white"
                          : "bg-white/5 border-white/10 text-gray-300"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
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
                      onClick={() =>
                        setPrompt(examplePrompts[Math.floor(Math.random() * examplePrompts.length)])
                      }
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
                  placeholder={t("promptPlaceholder")}
                />
              </div>

              <div className="mb-5">
                <label className="text-sm font-semibold text-gray-300 mb-2 block">{t("negative")}</label>
                <input
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl px-4 py-3 text-sm outline-none"
                />
              </div>
            </>
          )}

          {needsImage && (
            <div className="mb-5">
              <label className="text-sm font-semibold text-gray-300 mb-2 block">
                {isUndress ? t("personPhoto") : t("referenceImage")}
              </label>
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
                    <p className="text-sm">{isUndress ? t("uploadPerson") : t("uploadReference")}</p>
                    <p className="text-xs text-gray-500 mt-1">{t("uploadHint")}</p>
                  </div>
                )}
              </label>
            </div>
          )}

          {!isUndress && (
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {modeProducts.length > 1 && (
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">{t("model")}</label>
                    <select
                      value={selectedProduct?.zen_model ?? ""}
                      onChange={(e) => setZenModel(e.target.value)}
                      className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                    >
                      {modeProducts.map((p) => (
                        <option key={p.id} value={p.zen_model}>
                          {p.label} ({p.credit_cost} {t("credits")})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {modeMappings
                  .filter((m) => !["_style"].includes(m.zen_path) || m.ui_key === "style")
                  .map((m) => {
                    const value =
                      m.ui_key === "ratio"
                        ? ratio
                        : m.ui_key === "quality"
                          ? quality
                          : m.ui_key === "style"
                            ? style
                            : m.ui_key === "duration"
                              ? duration
                              : m.ui_key === "resolution"
                                ? resolution
                                : extraParams[m.ui_key] ?? m.options[0]?.value ?? "";
                    const setValue = (v: string) => {
                      if (m.ui_key === "ratio") setRatio(v);
                      else if (m.ui_key === "quality") setQuality(v);
                      else if (m.ui_key === "style") setStyle(v);
                      else if (m.ui_key === "duration") setDuration(v);
                      else if (m.ui_key === "resolution") setResolution(v);
                      else setExtraParams((prev) => ({ ...prev, [m.ui_key]: v }));
                    };
                    if (m.options.length === 0) return null;
                    return (
                      <div key={`${m.mode}-${m.ui_key}`}>
                        <label className="text-xs text-gray-400 block mb-1">{m.ui_key}</label>
                        <select
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                        >
                          {m.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                {!isUndress && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">{t("quantity")}</label>
                    <select
                      value={batch}
                      onChange={(e) => setBatch(Number(e.target.value))}
                      className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                    >
                      <option value={1}>{t("oneItem")}</option>
                      <option value={2}>{t("twoItems")}</option>
                      <option value={4}>{t("fourItems")}</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
          )}
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
                  <span className="text-gray-400">{t("modelLabel")}</span>
                  <span className="font-mono text-emerald-400 text-right max-w-[60%] truncate">
                    {selectedProduct?.zen_model ?? "—"}
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
                <span className="text-gray-400">{t("estimatedTime")}</span> <span>{isUndress ? "10–40s" : "8–90s"}</span>
              </div>
              {!isUndress && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t("ratio")}</span> <span>{ratio}</span>
                </div>
              )}
              {isUndress && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t("object")}</span>
                  <span>{undressVariant === "male" ? t("male") : undressVariant === "couple" ? t("couple") : t("female")}</span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={startGeneration}
            disabled={phase !== "idle"}
            className="generate-btn w-full py-4 text-white font-bold text-lg rounded-3xl flex items-center justify-center gap-x-3 shadow-xl active:scale-[0.985] disabled:opacity-60"
          >
            {phase === "idle" ? (
              <>
                <i className={`fas ${isUndress ? "fa-shirt" : "fa-magic"}`} />{" "}
                <span>{isUndress ? t("legacyStopped") : t("generate")}</span>
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
            <button
              onClick={() => setResult(null)}
              className="text-xs px-3 py-1 bg-white/5 rounded-full"
            >
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
