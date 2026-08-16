/**
 * model-viewer 的统一加载入口。**不要**再直接 import("@google/model-viewer")。
 *
 * 它默认从 www.gstatic.com 取两样东西，大陆访问不到：
 * - DRACO 解码器（几何压缩，`KHR_draco_mesh_compression`）
 * - KTX2/Basis 转码器（贴图压缩，`KHR_texture_basisu`）
 *
 * 两者都是**按需**拉取——模型没用对应扩展就不会请求，所以问题一直是间歇性的：
 * 普通 GLB 好好的，一碰上压缩过的就转圈或白模。改成从本站 /vendor/ 取。
 *
 * 时机很讲究：配置是在每个 <model-viewer> 元素的 constructor 里从
 * self.ModelViewerElement 读的（见 lib/features/loading.js），读不到才落到
 * 写死的 gstatic 默认值。所以必须在**第一个元素被构造之前**设好，
 * 也就是必须早于 import() 求值——元素升级发生在 customElements.define 那一刻。
 * 库自己不会覆写 self.ModelViewerElement，设一次就一直有效。
 */

/*
 * 与 public/vendor/ 下的目录对应，末尾斜杠不能少：加载器是直接拼字符串的。
 *
 * 文件抓自 model-viewer 4.3.1 写死的那两个版本（都是 Apache-2.0）：
 *   www.gstatic.com/draco/versioned/decoders/1.5.6/  → draco_wasm_wrapper.js + draco_decoder.wasm
 *   www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/ → basis_transcoder.js + .wasm
 * 没带 draco_decoder.js（asm.js 兜底，719KB）——它只在浏览器不支持
 * WebAssembly 时才用，而那种浏览器根本跑不了 WebGL。
 *
 * 升级 @google/model-viewer 时，去 lib/features/loading.js 看
 * DEFAULT_DRACO_DECODER_LOCATION / DEFAULT_KTX2_TRANSCODER_LOCATION 的版本号
 * 有没有变，变了就重新抓一遍——KTX2 转码器和 three 的版本是配套的。
 */
const DRACO_DECODER_PATH = "/vendor/draco/";
const KTX2_TRANSCODER_PATH = "/vendor/basis/";

type ModelViewerGlobal = {
  ModelViewerElement?: {
    dracoDecoderLocation?: string;
    ktx2TranscoderLocation?: string;
  };
};

let pending: Promise<unknown> | null = null;

export function loadModelViewer(): Promise<unknown> {
  if (pending) return pending;

  const g = self as unknown as ModelViewerGlobal;
  g.ModelViewerElement = {
    ...g.ModelViewerElement,
    dracoDecoderLocation: DRACO_DECODER_PATH,
    ktx2TranscoderLocation: KTX2_TRANSCODER_PATH,
  };

  pending = import("@google/model-viewer");
  return pending;
}
