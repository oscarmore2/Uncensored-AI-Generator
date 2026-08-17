"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  ApiError,
  MODES,
  estimateCost,
  type ApiGeneration,
  type CatalogProduct,
  type CatalogResponse,
} from "@/lib/client";
import {
  GROUP_META,
  MODE_GROUPS,
  MODE_META,
  isGenerationMode,
  modesInGroup,
  type GenerationMode,
  type ModeGroup,
} from "@/lib/generation-modes";
import { UNDRESS_GENDERS, UNDRESS_LOCKED_UI_KEYS, type UndressGender } from "@/lib/undress-prompts";
import {
  DEFAULT_UNDRESS_ADVANCED,
  hasUndressAdvancedAccess,
  normalizeUndressAdvanced,
  type UndressAdvancedOptions,
} from "@/lib/undress-options";
import { UndressAdvancedPanel } from "@/components/UndressAdvancedPanel";
import { ParamControlGrid } from "@/components/ParamControls";
import type { ParamControl } from "@/lib/param-controls";
import { useApp } from "@/components/AppContext";
import { useDraft } from "@/lib/use-draft";
import { RetryConfirmDialog } from "@/components/InputMediaGoneDialog";
import { AdaptiveMedia } from "@/components/WorkMedia";
import {
  MediaInputFields,
  missingRequiredMedia,
  pruneMediaToSpecs,
  toMediaPayload,
  newMediaId,
  withMediaIds,
  type UploadedMedia,
} from "@/components/MediaInputFields";
import { PromptMentionBox, buildMentionTargets } from "@/components/PromptMentionBox";
import { detectMediaKindFromUrl } from "@/lib/plaything-categories";
import { MediaExpiryBadge } from "@/components/MediaExpiryBadge";
import { useTranslations } from "next-intl";

type Phase = "idle" | "submitting" | "polling";

/** 刷新后要原样带回来的编辑内容 */
type MakeDraft = {
  mode: string;
  tier: string;
  spicy: boolean;
  prompt: string;
  negative: string;
  gender: string;
  undressOptions: UndressAdvancedOptions;
  ratio: string;
  batch: number;
  duration: string;
  advancedOpen: boolean;
  imageBase64: string | null;
  imageFilename: string | null;
  extraParams: Record<string, string>;
  /** 按字段分组的输入媒体；已经是 OSS URL，刷新后可直接复用 */
  media: Record<string, UploadedMedia[]>;
};

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
  const [gender, setGender] = useState<UndressGender>("female");
  const [undressOptions, setUndressOptions] =
    useState<UndressAdvancedOptions>(DEFAULT_UNDRESS_ADVANCED);
  const [ratio, setRatio] = useState("1:1");
  const [batch, setBatch] = useState(1);
  const [duration, setDuration] = useState("5");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  /** 字段名 → 已上传媒体；schema 驱动的新链路 */
  const [media, setMedia] = useState<Record<string, UploadedMedia[]>>({});
  // 只为「这张参考图日后被清理时能报出文件名」而记，不参与生成
  const [imageFilename, setImageFilename] = useState<string | null>(null);
  /** 套用历史任务时复用的参考图 URL：有它就不必再传一份 base64 */
  const [reusedImageUrl, setReusedImageUrl] = useState<string | null>(null);
  const [retryPrompt, setRetryPrompt] = useState(false);
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
  const reuseLoadedRef = useRef(false);

  /**
   * URL 显式带了内容（分享链接、二次创作）时不恢复草稿：
   * 用户是冲着链接里的那份提示词来的，草稿盖上去等于把链接吃掉。
   */
  const deepLinked = Boolean(
    searchParams.get("prompt") ??
      searchParams.get("negative") ??
      searchParams.get("remix_work") ??
      searchParams.get("reuse")
  );

  const { save: saveDraft } = useDraft<MakeDraft>(
    "make",
    (d) => {
      if (isGenerationMode(d.mode)) setMode(d.mode);
      if (typeof d.tier === "string") setTier(d.tier);
      setSpicy(Boolean(d.spicy));
      setPrompt(d.prompt ?? "");
      if (typeof d.negative === "string") setNegative(d.negative);
      if ((UNDRESS_GENDERS as readonly string[]).includes(d.gender)) {
        setGender(d.gender as UndressGender);
      }
      if (d.undressOptions) setUndressOptions(normalizeUndressAdvanced(d.undressOptions));
      if (typeof d.ratio === "string") setRatio(d.ratio);
      if (d.batch === 1 || d.batch === 2 || d.batch === 4) setBatch(d.batch);
      if (typeof d.duration === "string") setDuration(d.duration);
      setAdvancedOpen(Boolean(d.advancedOpen));
      setImageBase64(d.imageBase64 ?? null);
      setImageFilename(d.imageFilename ?? null);
      setExtraParams(d.extraParams ?? {});
      // 改动之前存下的草稿没有 id，补齐再进 state，否则拖动排序认不出元素
      setMedia(withMediaIds(d.media));
    },
    {
      enabled: !deepLinked,
      // 参考图是 base64 大字符串，配额写满时先保住提示词
      stripMedia: (d) => ({ ...d, imageBase64: null }),
    }
  );

  useEffect(() => {
    saveDraft({
      mode,
      tier,
      spicy,
      prompt,
      negative,
      gender,
      undressOptions,
      ratio,
      batch,
      duration,
      advancedOpen,
      imageBase64,
      imageFilename,
      extraParams,
      media,
    });
  }, [
    saveDraft,
    media,
    mode,
    tier,
    spicy,
    prompt,
    negative,
    gender,
    undressOptions,
    ratio,
    batch,
    duration,
    advancedOpen,
    imageBase64,
    imageFilename,
    extraParams,
  ]);

  const meta = MODE_META[mode];
  const isVip = Boolean(catalog?.user_vip.is_active);
  /** 当前用户的 VIP 等级；没有有效会员时按 0 算 */
  const vipRank = isVip ? (catalog?.user_vip.tier?.rank ?? user?.vip_tier?.rank ?? 0) : 0;
  const adultEnabled = Boolean(user?.adult_mode_enabled);
  const isUndress = mode === "undress";
  const isVip2Undress = hasUndressAdvancedAccess(
    Boolean(catalog?.user_vip.is_active),
    catalog?.user_vip.tier?.code ?? user?.vip_tier?.code
  );
  const visibleModes = useMemo(
    () => MODES.filter((m) => m.mode !== "undress" || adultEnabled),
    [adultEnabled]
  );

  /**
   * 模式栏按组折叠。视频转视频那一族（重绘/超分/续写/对口型/换脸）能力差别很大，
   * 平铺会让模式栏长到十三个按钮；折叠成一组、组内出子 tab 更好找。
   * 只有一个成员的组不出子 tab。
   */
  const visibleGroups = useMemo(
    () =>
      MODE_GROUPS.map((g) => ({
        group: g,
        meta: GROUP_META[g],
        modes: modesInGroup(g).filter((m) => visibleModes.some((v) => v.mode === m.mode)),
      })).filter((g) => g.modes.length > 0),
    [visibleModes]
  );
  const activeGroup: ModeGroup = MODE_META[mode].group;
  const subModes = useMemo(
    () => visibleGroups.find((g) => g.group === activeGroup)?.modes ?? [],
    [visibleGroups, activeGroup]
  );

  /** 某个模式最低多少点起，用于模式栏上的价格角标 */
  const cheapestOf = useCallback(
    (m: string) =>
      catalog?.products
        .filter((p) => p.mode === m && !p.spicy)
        .sort((a, b) => a.credit_cost - b.credit_cost)[0],
    [catalog]
  );

  useEffect(() => {
    if (user && user.balance <= 0) router.replace("/pricing");
  }, [router, user]);

  // 关闭成人模式后若仍停在脱衣 Tab，回退到文字生图
  useEffect(() => {
    if (mode === "undress" && !adultEnabled) setMode("txt2img");
  }, [mode, adultEnabled]);

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
        if (isGenerationMode(work.mode)) {
          if (work.mode === "undress" && !user?.adult_mode_enabled) {
            setMode("txt2img");
          } else {
            setMode(work.mode);
          }
        }
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
        if (
          typeof p.gender === "string" &&
          (UNDRESS_GENDERS as readonly string[]).includes(p.gender)
        ) {
          setGender(p.gender as UndressGender);
        }
        if (p.undress_options) {
          setUndressOptions(normalizeUndressAdvanced(p.undress_options));
        }
        const known = new Set([
          "ratio",
          "duration",
          "tier",
          "spicy",
          "batch",
          "product_id",
          "gender",
          "undress_options",
        ]);
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
  }, [searchParams, t, toast, user?.adult_mode_enabled]);

  /**
   * ?reuse=<id> —— 从「我的作品」套用一条历史任务。
   * 参考图不重新上传，直接复用当初那张已在对象存储里的图；
   * 图已被清理时列表页会先弹框说明，并带上 nomedia=1 让这里只填参数。
   */
  useEffect(() => {
    const reuseId = searchParams.get("reuse");
    if (!reuseId || reuseLoadedRef.current) return;
    reuseLoadedRef.current = true;
    const skipMedia = searchParams.get("nomedia") === "1";

    api<{
      mode: string;
      tier: string;
      spicy: boolean;
      prompt: string;
      negative_prompt: string;
      params: Record<string, string>;
      gender: string | null;
      undress_options: unknown;
      media: { usable_urls: string[] };
      media_fields: Record<string, Array<{ url: string; name: string }>>;
    }>(`/api/generations/${encodeURIComponent(reuseId)}/reuse`)
      .then((d) => {
        if (isGenerationMode(d.mode)) {
          setMode(d.mode === "undress" && !user?.adult_mode_enabled ? "txt2img" : d.mode);
        }
        setTier(d.tier);
        setSpicy(Boolean(d.spicy));
        setPrompt(d.prompt);
        setNegative(d.negative_prompt ?? "");
        if (d.gender && (UNDRESS_GENDERS as readonly string[]).includes(d.gender)) {
          setGender(d.gender as UndressGender);
        }
        if (d.undress_options) setUndressOptions(normalizeUndressAdvanced(d.undress_options));

        const p = d.params ?? {};
        if (typeof p.ratio === "string") setRatio(p.ratio);
        if (typeof p.duration === "string") setDuration(p.duration);
        const batchNum = Number(p.batch);
        if (batchNum === 1 || batchNum === 2 || batchNum === 4) setBatch(batchNum);
        const known = new Set(["ratio", "duration", "batch", "gender", "undress_options"]);
        setExtraParams(
          Object.fromEntries(Object.entries(p).filter(([key]) => !known.has(key)))
        );

        if (!skipMedia) {
          /*
           * 按字段还原（新链路：对口型、换脸、参考生视频……）。
           * kind 由 URL 后缀判定；判不出来的退回 image，
           * 反正紧接着的 pruneMediaToSpecs 会按当前档位的 specs 再筛一遍。
           */
          const fields = d.media_fields ?? {};
          if (Object.keys(fields).length) {
            setMedia(
              Object.fromEntries(
                Object.entries(fields).map(([field, items]) => [
                  field,
                  items.map((it) => ({
                    id: newMediaId(),
                    url: it.url,
                    name: it.name,
                    kind: detectMediaKindFromUrl(it.url, "image") as UploadedMedia["kind"],
                  })),
                ])
              )
            );
          }
          // 旧链路的单张参考图
          if (d.media?.usable_urls?.length) {
            setReusedImageUrl(d.media.usable_urls[0]);
            setImageBase64(null);
          }
        }
        toast(t("applied"));
        // run=1 表示「重新生成」：参数就位后弹确认框，由用户确认再扣点发单
        if (searchParams.get("run") === "1") setRetryPrompt(true);
      })
      .catch((e) =>
        toast(e instanceof ApiError && e.message ? e.message : t("reuseLoadFailed"), true)
      );
  }, [searchParams, t, toast, user?.adult_mode_enabled]);

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
   * 脱衣模式锁定宽高比/尺寸（服务端按原图强制写入）。
   */
  const controls = useMemo<ParamControl[]>(() => {
    const raw = selectedProduct?.params ?? [];
    if (!isUndress) return raw;
    return raw.filter((c) => !UNDRESS_LOCKED_UI_KEYS.has(c.key));
  }, [selectedProduct, isUndress]);

  /**
   * 输入媒体位同样来自绑定模型的 schema。
   * 脱衣模式例外：它的输入固定是一张人物图，走老的单图链路
   * （服务端要读原图像素尺寸来保比例，那条路子不能绕）。
   */
  const mediaSpecs = useMemo(
    () => (isUndress ? [] : (selectedProduct?.media_inputs ?? [])),
    [selectedProduct, isUndress]
  );

  /**
   * 提示词里可以 @ 引用的素材。顺带也是「一共传了几个」的答案：
   * 每个已上传文件恰好对应一个 @ 名字。
   */
  const mentionTargets = useMemo(
    () => buildMentionTargets(mediaSpecs, media),
    [mediaSpecs, media]
  );

  // 换档位/换模式后，把新模型不认的媒体字段丢掉，别带着它去提交
  useEffect(() => {
    setMedia((prev) => {
      const next = pruneMediaToSpecs(mediaSpecs, prev);
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, v]) => prev[k]?.length === v.length);
      return same ? prev : next;
    });
  }, [mediaSpecs]);

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

  const balance = user?.balance ?? 0;
  // 本次预估扣点超过余额；档位/时长/批量任何改动都会实时重算
  const insufficientCredits = Boolean(selectedProduct) && cost > balance;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast(t("imageTooLarge"), true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageBase64(ev.target?.result as string);
      setImageFilename(file.name || null);
      setReusedImageUrl(null);
    };
    reader.readAsDataURL(file);
  }

  function selectTier(product: CatalogProduct) {
    if (product.requires_vip && !isVip) {
      toast(t("spicyNeedsVip"), true);
      router.push("/pricing");
      return;
    }
    // 等级门槛：终极档的 Spicy 变体只对 VIP2 及以上开放
    const needRank = product.min_vip_rank ?? 0;
    if (needRank > 0 && vipRank < needRank) {
      toast(t("tierNeedsVipRank", { rank: needRank }), true);
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
    if (!isUndress && meta.needsPrompt && !prompt.trim()) return toast(t("promptRequired"), true);
    if (!isUndress && mediaSpecs.length > 0) {
      const missing = missingRequiredMedia(mediaSpecs, media);
      if (missing) {
        toast(t("missingMedia"), true);
        return;
      }
      /*
       * 参考生视频这类模式，上游把每个参考位都声明成选填（minItems 0），
       * 一样不传照样能提交——结果是按更贵的档位跑了一次文生视频。
       * mentionTargets 就是全部已上传素材，长度为 0 即一样都没传。
       */
      if (meta.needsMedia && mentionTargets.length === 0) {
        toast(t("missingMedia"), true);
        return;
      }
    }
    if (isUndress && meta.needsMedia && !imageBase64 && !reusedImageUrl) {
      return toast(t("imageRequired"), true);
    }
    if (isUndress && !adultEnabled) return toast(t("undressNeedsAdult"), true);
    if (phase !== "idle") return;
    if (!selectedProduct) return toast(t("tierUnavailable"), true);
    // 档位可能是草稿恢复回来的，绕过了 selectTier 那道门槛检查
    const needRank = selectedProduct.min_vip_rank ?? 0;
    if (needRank > 0 && vipRank < needRank) {
      toast(t("tierNeedsVipRank", { rank: needRank }), true);
      router.push("/pricing");
      return;
    }
    // 余额不足直接拦在本地：服务端扣费是原子的、必然拒绝，
    // 提前拦住可以避免把最多 14MB 的 base64 参考图白传一遍。
    if (insufficientCredits) {
      toast(t("insufficientCredits", { cost, balance }), true);
      router.push("/pricing");
      return;
    }

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
          prompt: isUndress ? "" : prompt.trim(),
          negative_prompt: isUndress ? "" : meta.supportsNegative ? negative : "",
          ...(isUndress ? { gender } : {}),
          ...(isUndress && isVip2Undress && gender === "female"
            ? { undress_options: undressOptions }
            : {}),
          ratio,
          duration: meta.category === "video" ? duration : undefined,
          batch: meta.supportsBatch ? batch : 1,
          image_base64: imageBase64,
          ...(imageFilename ? { image_filename: imageFilename } : {}),
          ...(!imageBase64 && reusedImageUrl ? { image_url: reusedImageUrl } : {}),
          ...(Object.keys(media).length ? { media: toMediaPayload(media) } : {}),
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
        (e.code === "INSUFFICIENT_CREDITS" ||
          e.code === "SPICY_REQUIRES_VIP" ||
          e.code === "VIP_RANK_TOO_LOW")
      ) {
        router.push("/pricing");
      }
      if (e instanceof ApiError && e.code === "ADULT_MODE_REQUIRED") {
        router.push("/profile");
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
    const needRank = product.min_vip_rank ?? 0;
    const locked = (product.requires_vip && !isVip) || (needRank > 0 && vipRank < needRank);
    return (
      <button
        type="button"
        onClick={() => selectTier(product)}
        className={`relative text-left px-4 py-3 rounded-2xl border transition-colors ${
          active
            ? product.spicy
              ? "bg-fuchsia-600/20 border-fuchsia-500 text-white"
              : "bg-orange-600/20 border-orange-500 text-white"
            : "bg-black/[0.03] border-line hover:border-line-strong"
        } ${locked ? "opacity-60" : ""}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">{product.label}</span>
          {product.spicy && (
            <span className="px-1.5 py-px rounded text-[10px] font-bold bg-fuchsia-700 text-white">
              SPICY
            </span>
          )}
          {/* 有等级门槛的档位直接把等级标出来，别让用户点了才知道进不去 */}
          {needRank > 0 && (
            <span className="px-1.5 py-px rounded text-[10px] font-bold bg-amber-500/25 text-amber-800">
              VIP{needRank}
            </span>
          )}
          {locked && <i className="fas fa-lock text-[10px] text-amber-800" />}
        </div>
        <div className="text-[11px] text-ink-muted leading-snug">{product.description}</div>
        <div className="mt-1.5 text-[11px] font-mono text-orange-700">
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
          <p className="text-ink-muted mt-1">
            {t("subtitle")}
            {!user?.is_vip ? ` • ${t("safetyNotice")}` : ""}
          </p>
        </div>
      </div>

      {/* 一级：按大类分组。视频转视频那一族折叠成一个入口，组内再出子 tab */}
      <div className="flex flex-wrap gap-2 mb-3">
        {visibleGroups.map((g) => {
          const active = g.group === activeGroup;
          const cheapest = g.modes
            .map((m) => cheapestOf(m.mode))
            .filter(Boolean)
            .sort((a, b) => a!.credit_cost - b!.credit_cost)[0];
          return (
            <button
              key={g.group}
              onClick={() => {
                // 切组时落到该组第一个模式；已经在组内就不动，免得把用户选的子项打掉
                if (!active && g.modes[0]) setMode(g.modes[0].mode);
              }}
              className={`mode-tab flex-1 md:flex-none px-5 py-3 text-sm font-semibold rounded-3xl flex items-center justify-center gap-x-2 border ${
                active ? "active border-orange-600" : "bg-black/[0.03] border-line"
              }`}
            >
              <i className={`fas ${g.meta.icon}`} />
              <span>
                {t.has(`groups.${g.group}`)
                  ? t(`groups.${g.group}` as "groups.image")
                  : g.meta.fallbackLabel}
              </span>
              {cheapest && (
                <span className="text-[10px] px-1.5 py-px bg-black/[0.06] rounded">
                  {cheapest.credit_cost}
                  {t("creditsUnit")}起
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 二级：组内子 tab；只有一个成员时没必要出现 */}
      {subModes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {subModes.map((m) => {
            const active = m.mode === mode;
            const cheapest = cheapestOf(m.mode);
            return (
              <button
                key={m.mode}
                onClick={() => setMode(m.mode)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-2xl border transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-orange-600/20 border-orange-500 text-orange-700"
                    : "bg-surface border-line text-ink-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <i className={`fas ${m.icon}`} />
                {t.has(`modes.${m.mode}`) ? t(`modes.${m.mode}` as "modes.txt2img") : m.fallbackLabel}
                {cheapest && (
                  <span className="text-[10px] text-ink-subtle">
                    {cheapest.credit_cost}
                    {t("creditsUnit")}起
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {subModes.length <= 1 && <div className="mb-6" />}
      {noTiers && (
        <div className="mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-800/90">
          {t("tierUnavailable")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass rounded-3xl p-6">
          <div className="mb-5">
            <label className="text-sm font-semibold text-ink-muted mb-2 block">{t("tierLabel")}</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {normalTiers.map((p) => (
                <TierCard key={p.id} product={p} />
              ))}
            </div>

            {spicyTiers.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-fuchsia-700">{t("spicyLabel")}</span>
                  {!isVip && (
                    <button
                      type="button"
                      onClick={() => router.push("/pricing")}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 hover:bg-amber-500/30"
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
                <p className="mt-2 text-[11px] text-ink-subtle leading-relaxed">
                  {t("spicyNotice")}
                </p>
              </div>
            )}
          </div>

          {isUndress ? (
            <div className="mb-5">
              <label className="text-sm font-semibold text-ink-muted mb-2 block">{t("genderLabel")}</label>
              <div className="flex flex-wrap gap-2">
                {UNDRESS_GENDERS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`px-4 py-2 rounded-2xl text-sm font-medium border transition-colors ${
                      gender === g
                        ? "bg-orange-600/20 border-orange-500 text-orange-700"
                        : "bg-black/[0.03] border-line text-ink-muted hover:border-line-strong"
                    }`}
                  >
                    {t(`genders.${g}` as "genders.female")}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-subtle leading-relaxed">{t("undressHint")}</p>
              <p className="mt-1 text-[11px] text-ink-subtle leading-relaxed">{t("undressAspectHint")}</p>
            </div>
          ) : null}

          {isUndress && isVip2Undress && gender === "female" && (
            <UndressAdvancedPanel
              value={undressOptions}
              onChange={setUndressOptions}
              t={(key) => t(key as "undressAdvancedTitle")}
            />
          )}

          {/*
            提示词框只在这个模式真的用得上时才出现。
            超分 / 对口型 / 换脸 / 图片生 3D 的模型压根不收 prompt，
            摆一个写了也没用的输入框只会误导人。
          */}
          {isUndress || !meta.needsPrompt ? null : (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <label className="text-sm font-semibold text-ink-muted">{t("prompt")}</label>
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
                    className="text-xs flex items-center gap-x-1 text-orange-700 hover:text-orange-800"
                  >
                    <i className="fas fa-dice" /> <span>{t("random")}</span>
                  </button>
                </div>
              </div>
              {/*
                输入 @ 就能引用已上传的素材。参考生视频这类模型正是靠提示词里的
                @Image1 / @Video1 认出每句话说的是哪一份素材，让用户自己数第几张必然出错。
              */}
              <PromptMentionBox
                value={prompt}
                onChange={setPrompt}
                targets={mentionTargets}
                className="prompt-box w-full bg-surface border border-line focus:border-orange-500/60 rounded-2xl p-4 text-sm placeholder:text-ink-subtle outline-none min-h-[120px]"
                placeholder={mode === "imgedit" ? t("editPlaceholder") : t("promptPlaceholder")}
                labels={{
                  header: t("mentionHeader"),
                  navigate: t("mentionNavigate"),
                  select: t("mentionSelect"),
                  close: t("mentionClose"),
                  empty: t("mentionNoMatch"),
                }}
              />
              {mediaSpecs.length > 0 && (
                <p className="mt-2 text-[11px] text-ink-subtle">
                  {mentionTargets.length ? t("mentionHint") : t("mentionUploadFirst")}
                </p>
              )}
            </div>
          )}

          {!isUndress && meta.supportsNegative && (
            <div className="mb-5">
              <label className="text-sm font-semibold text-ink-muted mb-2 block">{t("negative")}</label>
              <input
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                className="w-full bg-surface border border-line focus:border-orange-500/60 rounded-2xl px-4 py-3 text-sm outline-none"
              />
            </div>
          )}

          {/*
            输入媒体：几个位、什么类型、最多几个，全部由绑定模型的 schema 决定。
            脱衣模式例外，仍走老的单图 base64 链路——服务端要读原图像素尺寸来保比例。
          */}
          {isUndress ? (
            meta.needsMedia && (
                <div className="mb-5">
                  <label className="text-sm font-semibold text-ink-muted mb-2 block">{t("referenceImage")}</label>
                  <label className="block border-2 border-dashed border-line-strong hover:border-orange-500/40 rounded-3xl p-8 text-center cursor-pointer transition-colors">
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    {imageBase64 || reusedImageUrl ? (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageBase64 ?? reusedImageUrl ?? ""}
                          alt={t("preview")}
                          className="mx-auto max-h-48 rounded-2xl shadow-xl mb-3"
                        />
                        {!imageBase64 && reusedImageUrl && (
                          <div className="mb-2 text-[11px] text-ink-subtle">{t("reusedImage")}</div>
                        )}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setImageBase64(null);
                            setImageFilename(null);
                            setReusedImageUrl(null);
                          }}
                          className="text-xs px-4 py-1 bg-black/[0.06] hover:bg-black/[0.08] rounded-full"
                        >
                          {t("removeImage")}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <i className="fas fa-cloud-upload-alt text-4xl text-ink-subtle mb-3" />
                        <p className="text-sm">{t("uploadReference")}</p>
                        <p className="text-xs text-ink-subtle mt-1">{t("uploadHint")}</p>
                      </div>
                    )}
                  </label>
                </div>
            )
          ) : mediaSpecs.length > 0 ? (
            <MediaInputFields
              specs={mediaSpecs}
              value={media}
              onChange={setMedia}
              onError={(m) => toast(m, true)}
              disabled={phase !== "idle"}
            />
          ) : meta.needsMedia && selectedProduct ? (
            // 该模式要输入媒体，但绑定的模型没声明任何媒体字段——配置有问题，别让用户白填
            <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800/90">
              {t("mediaSlotsUnavailable")}
            </div>
          ) : null}

          <div className="mb-2">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-ink-muted">{t("advanced")}</label>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="text-xs text-ink-muted flex items-center gap-1"
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
                      <label className="text-xs text-ink-muted block mb-1">{t("quantity")}</label>
                      <select
                        value={batch}
                        onChange={(e) => setBatch(Number(e.target.value))}
                        className={`w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none ${
                          accent === "fuchsia" ? "focus:border-fuchsia-500/60" : "focus:border-orange-500/60"
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
                  <p className="text-xs text-ink-subtle">{t("noExtraParams")}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 glass rounded-3xl p-6 flex flex-col">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-xs text-ink-muted">{t("estimatedCost")}</div>
                <div className="flex items-baseline">
                  <span className="text-5xl font-bold font-mono text-orange-700">{cost}</span>
                  <span className="ml-2 text-lg text-ink-muted">{t("credits")}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-ink-muted">{t("balance")}</div>
                <div className="flex items-center justify-end gap-x-1">
                  <i className="fas fa-coins text-amber-800" />
                  <span className="font-mono text-2xl font-semibold stat-number">{user?.balance ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="bg-black/[0.04] rounded-2xl p-4 text-xs space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-ink-muted">{t("tierLabel")}</span>
                <span className="text-right max-w-[65%] truncate flex items-center gap-1 justify-end">
                  {selectedProduct?.spicy && (
                    <span className="px-1 rounded text-[9px] font-bold bg-fuchsia-700 text-white">SPICY</span>
                  )}
                  {selectedProduct?.label ?? "—"}
                </span>
              </div>
              {catalog?.user_vip.is_active && (catalog.user_vip.tier?.discount_bps ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">{t("vipDiscount")}</span>
                  <span className="text-amber-800">
                    {catalog.user_vip.tier?.name} -{catalog.user_vip.tier?.discount_percent}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-muted">{t("estimatedTime")}</span>
                <span>{meta.category === "video" ? "60–240s" : "8–40s"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t("ratio")}</span>{" "}
                <span>{isUndress ? t("undressAspectFollow") : ratio}</span>
              </div>
              {meta.category === "video" && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">{t("params.duration")}</span> <span>{duration}s</span>
                </div>
              )}
            </div>
          </div>

          {insufficientCredits && phase === "idle" && (
            <div className="mb-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
              <i className="fas fa-coins mt-0.5 shrink-0" />
              <span>{t("insufficientCredits", { cost, balance })}</span>
            </div>
          )}

          <button
            onClick={startGeneration}
            disabled={phase !== "idle" || !selectedProduct || insufficientCredits}
            className="generate-btn w-full py-4 text-ink font-bold text-lg rounded-3xl flex items-center justify-center gap-x-3 shadow-xl active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {phase === "idle" ? (
              insufficientCredits ? (
                <>
                  <i className="fas fa-coins" /> <span>{t("insufficientShort")}</span>
                </>
              ) : (
                <>
                  <i className="fas fa-magic" /> <span>{t("generate")}</span>
                </>
              )
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
              className={`text-xs flex items-center justify-center gap-x-1 mx-auto ${
                insufficientCredits
                  ? "text-amber-800 hover:text-amber-900 font-semibold"
                  : "text-ink-muted hover:text-orange-800"
              }`}
            >
              <i className="fas fa-coins fa-sm" /> <span>{t("recharge")}</span>
            </button>
          </div>
        </div>
      </div>

      {phase === "polling" && !result && (
        <div className="mt-8 glass rounded-3xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
          <div className="text-sm mb-3">{t("progress", { progress })}</div>
          <div className="max-w-md mx-auto h-2 bg-black/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-8">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-x-2">
              <i className="fas fa-check-circle text-emerald-700" /> {t("completed")}
              {result.isAdult && (
                <span className="rounded-full bg-red-700 px-2 py-0.5 text-[10px] font-bold text-white">18+</span>
              )}
              <MediaExpiryBadge expiresAt={result.mediaExpiresAt} deletedAt={null} compact />
            </h3>
            <button onClick={() => setResult(null)} className="text-xs px-3 py-1 bg-black/[0.03] rounded-full">
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
                className="flex-1 py-2.5 text-sm font-semibold bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-2xl flex items-center justify-center gap-x-2"
              >
                <i className="fas fa-download" /> <span>{t("download")}</span>
              </a>
              <a
                href="/history"
                className="flex-1 py-2.5 text-sm font-semibold bg-black/[0.03] hover:bg-black/[0.06] border border-line rounded-2xl text-center leading-8"
              >
                {t("viewAll")}
              </a>
            </div>
          </div>
        </div>
      )}
      {retryPrompt && (
        <RetryConfirmDialog
          cost={cost}
          balance={balance}
          onCancel={() => setRetryPrompt(false)}
          onConfirm={() => {
            setRetryPrompt(false);
            void startGeneration();
          }}
        />
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
