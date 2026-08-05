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

    let alive = true;

    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string; sourceError?: unknown }>).detail;
      const message =
        detail?.sourceError instanceof Error
          ? detail.sourceError.message
          : String(detail?.type ?? "unknown");
      console.error("[model-viewer] load error:", detail ?? e);
      setError(message);

      /*
       * model-viewer 报的往往是二次错误。跨域被拦时它先吃到 TypeError: Failed to fetch，
       * 然后在自己的收尾逻辑里读了个 undefined，最终抛出来的是
       * 「Cannot read properties of undefined (reading 'scene')」——
       * 完全看不出真正原因是对象存储没给本站放行。
       *
       * 图片和视频不受 CORS 限制，所以同一个桶上图片视频一切正常、
       * 只有 3D 打不开，这个组合极易被误判成模型文件坏了。
       * 这里补一次简单请求（HEAD 不触发预检）探一下：探测也失败就是跨域问题。
       */
      void fetch(src, { method: "HEAD", mode: "cors" })
        .then(
          (resp) => (resp.ok ? null : `资源返回 HTTP ${resp.status}`),
          () => "跨域被拒绝（CORS）：对象存储未对本站放行，浏览器无法读取模型文件"
        )
        .then((hint) => {
          if (alive && hint) setError(hint);
        });
    };
    const onLoad = () => setError(null);

    el.addEventListener("error", onError);
    el.addEventListener("load", onLoad);
    return () => {
      alive = false;
      el.removeEventListener("error", onError);
      el.removeEventListener("load", onLoad);
    };
  }, [src]);

  return { ref, error };
}
