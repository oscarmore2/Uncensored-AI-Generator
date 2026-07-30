"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import type { PlaythingCategoryId, PlaythingMediaKind } from "@/lib/plaything-categories";
import { categoryMeta } from "@/lib/plaything-categories";
import { CategoryRail } from "@/components/plaything/CategoryRail";
import { ModelPicker } from "@/components/plaything/ModelPicker";
import {
  DynamicParamForm,
  defaultsFromProduct,
  buildFieldParams,
  mediaFieldKinds,
  mergeMediaUrlsIntoParams,
  releaseFormMedia,
  type DynamicFormState,
  type PromptOptimizeStyle,
} from "@/components/plaything/DynamicParamForm";
import { GenerateBar } from "@/components/plaything/GenerateBar";
import { MediaBrowser } from "@/components/plaything/MediaBrowser";
import { uploadAllPending, uploadPendingMediaCached } from "@/lib/plaything-upload-client";
import type {
  Phase,
  PlaythingCategorySummary,
  PlaythingGen,
  PlaythingProduct,
} from "@/components/plaything/types";
import { useTranslations } from "next-intl";

export default function PlaythingPage() {
  const t = useTranslations("Plaything");
  const { user, refreshUser, toast } = useApp();
  const router = useRouter();
  const [products, setProducts] = useState<PlaythingProduct[]>([]);
  const [categories, setCategories] = useState<PlaythingCategorySummary[]>([]);
  const [note, setNote] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [category, setCategory] = useState<PlaythingCategoryId | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<DynamicFormState>(defaultsFromProduct(null));
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<PlaythingGen[]>([]);
  const [browserSelectedId, setBrowserSelectedId] = useState<number | null>(null);
  const [quoteCost, setQuoteCost] = useState<number | null>(null);
  const [quoteSource, setQuoteSource] = useState<"wavespeed" | "fallback" | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [promptOptimizerEnabled, setPromptOptimizerEnabled] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const pollingRef = useRef(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PendingMedia.id → 已上传 URL；优化提示词时抢先传的参考图，真正提交生成时复用，不重复上传
  const uploadedUrlCache = useRef(new Map<string, string>());

  const loadCatalog = useCallback(async () => {
    try {
      const data = await api<{
        products: PlaythingProduct[];
        categories: PlaythingCategorySummary[];
        note?: string;
      }>("/api/plaything/catalog");
      setProducts(data.products);
      setCategories(data.categories);
      setNote(data.note ?? "");
      setForbidden(false);
      setCategory((prev) => prev ?? data.categories[0]?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
        return;
      }
      toast(e instanceof ApiError ? e.message : t("loadFailed"));
    }
  }, [t, toast]);

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
    api<{ plaything_prompt_optimizer?: boolean }>("/api/features")
      .then((f) => setPromptOptimizerEnabled(Boolean(f.plaything_prompt_optimizer)))
      .catch(() => setPromptOptimizerEnabled(false));
  }, [loadCatalog, loadHistory]);

  const categoryProducts = useMemo(() => {
    if (!category) return [] as PlaythingProduct[];
    return products.filter((p) => p.category === category);
  }, [products, category]);

  useEffect(() => {
    if (!category) return;
    const list = products.filter((p) => p.category === category);
    if (!list.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0].id;
    });
  }, [category, products]);

  const selected = useMemo(
    () => categoryProducts.find((p) => p.id === selectedId) ?? null,
    [categoryProducts, selectedId]
  );

  useEffect(() => {
    setForm((prev) => {
      releaseFormMedia(prev);
      return defaultsFromProduct(selected);
    });
    setQuoteCost(selected?.credit_cost ?? null);
    setQuoteSource(null);
    uploadedUrlCache.current.clear();
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mediaKind: PlaythingMediaKind =
    selected?.media_kind ?? (category ? categoryMeta(category).mediaKind : "image");

  const filteredHistory = useMemo(() => {
    if (!category) return history;
    return history.filter((g) => g.category === category);
  }, [history, category]);

  useEffect(() => {
    const firstOk = filteredHistory.find(
      (g) => g.status === "succeeded" && g.result_urls?.length
    );
    setBrowserSelectedId(firstOk?.id ?? null);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参数变化 → debounce 询价（媒体用占位，不先上传）
  useEffect(() => {
    if (!selected) return;
    const payload = buildFieldParams(selected, form, (key, values) => t(key, values));
    if (!payload.ok) {
      setQuoteCost(selected.credit_cost);
      setQuoteSource(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => {
      setQuoting(true);
      void api<{
        cost: number;
        source: "wavespeed" | "fallback";
      }>("/api/plaything/quote", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          inputs: {
            ...payload.params,
            ...(payload.prompt ? { prompt: payload.prompt } : {}),
          },
        }),
      })
        .then((q) => {
          setQuoteCost(q.cost);
          setQuoteSource(q.source);
        })
        .catch(() => {
          setQuoteCost(selected.credit_cost);
          setQuoteSource("fallback");
        })
        .finally(() => setQuoting(false));
    }, 400);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [form.prompt, form.negativePrompt, form.fields, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * WaveSpeed 提示词优化（仅玩物专区）。若已选了参考图，抢先上传一次拿公开 URL 一并送审优化，
   * 上传结果写进 uploadedUrlCache，真正提交生成时 uploadAllPending 会命中缓存不再重复上传。
   */
  async function optimizePromptText(style: PromptOptimizeStyle) {
    if (!selected || optimizing) return;
    const text = form.prompt.trim();
    if (!text) return;

    setOptimizing(true);
    try {
      const fieldKinds = mediaFieldKinds(selected);
      let imageUrl: string | undefined;
      for (const [field, items] of Object.entries(form.mediaFiles)) {
        const item = items[0];
        if (item?.kind === "image") {
          imageUrl = await uploadPendingMediaCached({
            item,
            productId: selected.id,
            field,
            fieldKinds,
            cache: uploadedUrlCache.current,
          });
          break;
        }
      }

      const mode = selected.media_kind === "video" ? "video" : "image";
      const res = await api<{ prompt: string }>("/api/plaything/prompt-optimize", {
        method: "POST",
        body: JSON.stringify({ text, image_url: imageUrl, mode, style }),
      });
      setForm((prev) => ({ ...prev, prompt: res.prompt }));
      toast(t("optimizeDone"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("optimizeFailed"), true);
    } finally {
      setOptimizing(false);
    }
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
        setHistory((prev) => {
          const rest = prev.filter((x) => x.id !== g.id);
          return [g, ...rest];
        });
        if (g.status === "succeeded") {
          setPhase("idle");
          setBrowserSelectedId(g.id);
          await refreshUser();
          await loadHistory();
          toast(t("completed"));
          return;
        }
        if (g.status === "failed") {
          setPhase("idle");
          await refreshUser();
          await loadHistory();
          toast(g.error || t("failedRefunded"));
          return;
        }
      }
      toast(t("stillProcessing"));
      setPhase("idle");
    } finally {
      pollingRef.current = false;
    }
  }

  async function submit() {
    if (!selected || phase !== "idle") return;
    const payload = buildFieldParams(selected, form, (key, values) => t(key, values));
    if (!payload.ok) {
      toast(payload.error);
      return;
    }
    // 余额不足在上传媒体之前就拦住：否则文件已进 OSS、服务端才拒绝，留下孤儿文件
    const cost = quoteCost ?? selected.credit_cost;
    const balance = user?.balance ?? 0;
    if (balance < cost) {
      toast(t("insufficientCredits", { cost, balance }), true);
      router.push("/pricing");
      return;
    }

    setPhase("submitting");
    setProgress(0);
    try {
      // 点击生成后再上传媒体
      const mediaUrls = await uploadAllPending({
        productId: selected.id,
        mediaByField: payload.mediaFiles,
        fieldKinds: mediaFieldKinds(selected),
        cache: uploadedUrlCache.current,
      });
      const params = mergeMediaUrlsIntoParams(selected, payload.params, mediaUrls);

      const gen = await api<PlaythingGen>("/api/plaything/generations", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          prompt: payload.prompt,
          params,
        }),
      });
      await refreshUser();
      setProgress(gen.progress);
      setHistory((prev) => [gen, ...prev.filter((x) => x.id !== gen.id)]);
      void pollUntilDone(gen.id);
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiError && e.code === "INSUFFICIENT_CREDITS") {
        toast(t("insufficient"));
        router.push("/pricing");
      } else {
        toast(e instanceof Error ? e.message : e instanceof ApiError ? e.message : t("submitFailed"));
      }
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center px-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-3">{t("title")}</h1>
        <p className="text-gray-400 text-sm">
          {t("noAccess")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter mb-1">{t("title")}</h1>
          <p className="text-gray-400 text-sm">
            {t("subtitle")}
            {note ? ` · ${note}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 min-h-[calc(100vh-10rem)]">
        <CategoryRail categories={categories} active={category} onChange={setCategory} />

        <aside className="lg:w-[340px] shrink-0 flex flex-col gap-4 glass rounded-3xl p-4 sm:p-5">
          {categoryProducts.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">{t("emptyCategory")}</p>
          ) : (
            <>
              <ModelPicker
                products={categoryProducts}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selected && (
                <>
                  <div className="flex-1 overflow-y-auto max-h-[50vh] lg:max-h-none pr-1">
                    <DynamicParamForm
                      product={selected}
                      value={form}
                      onChange={setForm}
                      onError={(msg) => toast(msg)}
                      promptOptimizerEnabled={promptOptimizerEnabled}
                      optimizing={optimizing}
                      onOptimizePrompt={(style) => void optimizePromptText(style)}
                    />
                  </div>
                  <GenerateBar
                    creditCost={quoteCost ?? selected.credit_cost}
                    balance={user?.balance ?? 0}
                    phase={phase}
                    progress={progress}
                    quoteSource={quoteSource}
                    quoting={quoting}
                    onGenerate={() => void submit()}
                    onTopUp={() => router.push("/pricing")}
                  />
                </>
              )}
            </>
          )}
        </aside>

        <section className="flex-1 min-w-0 glass rounded-3xl p-4 sm:p-6">
          <MediaBrowser
            mediaKind={mediaKind}
            items={filteredHistory}
            selectedId={browserSelectedId}
            onSelect={setBrowserSelectedId}
          />
        </section>
      </div>
    </div>
  );
}
