"use client";

import { useEffect, useRef, useState } from "react";

/**
 * model-viewer 的 error 事件是原生 CustomEvent，不是 React 能通过 onError 这类
 * 合成事件接住的标准 DOM error——必须拿 ref 手动 addEventListener。
 *
 * 不接的话，贴图/材质加载失败时用户和我们都完全看不到任何线索，
 * 只会看到一个说不出原因的白模型（几何体本身通常还是能正常加载显示的，
 * 因为贴图缺失是材质层面的问题，不影响 mesh/buffer 的解析）。
 *
 * 两处 3D 预览（玩物专区 Model3DViewer、审核端 MediaPreview）共用这一个 hook。
 */
export function useModelViewerDiagnostics(src: string | null) {
  const ref = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const el = ref.current;
    if (!el || !src) return;

    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string; sourceError?: unknown }>).detail;
      const message =
        detail?.sourceError instanceof Error
          ? detail.sourceError.message
          : String(detail?.type ?? "unknown");
      console.error("[model-viewer] load error:", detail ?? e);
      setError(message);
    };
    const onLoad = () => setError(null);

    el.addEventListener("error", onError);
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("error", onError);
      el.removeEventListener("load", onLoad);
    };
  }, [src]);

  return { ref, error };
}
