/**
 * 模型能力档案：把上游各说各话的 schema 归一成站内固定的语义。
 *
 * 现状是四层互不相识的猜测——输入按字段名猜、必填按 schema 推、输出按结果 URL
 * 的扩展名猜、模式与模型靠一张硬编码候选表对。四层都是**事后猜**，加一个模型
 * 要在四处同时对上，猜错了只在用户点生成时才暴露。
 *
 * 这里把「猜」收敛成一次性的**派生**：同步时算一遍落库，运行期只读结果，
 * 派生错了在管理端改一次就永久生效（source=manual，之后的派生不再覆盖）。
 *
 * 这个模块是**纯函数**，不碰数据库、不引 server-only——好让它能被脚本、
 * 管理端、以及单元测试直接调用。
 */

export type CapabilityKind = "image" | "video" | "audio" | "model3d" | "text";

/**
 * 输入位的语义角色。这是整套体系的支点：
 * 上游把首帧叫 image / start_image / input_image，站内一律是 subject。
 * 前端从此不看字段名——「要一张主体图 + 若干参考图」是稳定的产品语义。
 */
export type InputRole =
  | "subject"       // 主体图 / 首帧
  | "end_frame"     // 尾帧
  | "reference"     // 参考素材，通常可多份
  | "mask"          // 蒙版
  | "face"          // 人脸（换脸类）
  | "source_video"  // 待处理视频
  | "audio"         // 音轨 / 语音
  | "model3d"       // 3D 模型入参
  | "other";

export type CapabilityInput = {
  /** 上游真实字段名，提交时原样使用 */
  field: string;
  kind: CapabilityKind;
  role: InputRole;
  /** 数量下限；> 0 才是必填。**只看 required[]，不看 minItems** */
  min: number;
  /** 数量上限；null 表示上游没声明 */
  max: number | null;
};

export type CapabilityOutput = {
  kind: CapabilityKind;
  min: number;
  max: number | null;
};

export type ModelCapability = {
  inputs: CapabilityInput[];
  outputs: CapabilityOutput[];
  /** 派生依据，人工复核时用来理解「为什么这么判」 */
  notes: string[];
};

/* ------------------------------------------------------------- schema 读取 */

type PropSpec = {
  type?: string;
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
  maximum?: number;
  default?: unknown;
};

type SchemaNode = { properties?: Record<string, PropSpec>; required?: unknown };

/** 两家上游的 schema 外形不同，差异只在这里吃掉 */
function pickNode(root: Record<string, unknown>): SchemaNode | null {
  const r = root as {
    api_schemas?: Array<{ request_schema?: SchemaNode }>;
    request_schema?: SchemaNode;
    components?: { schemas?: { Input?: SchemaNode } };
    properties?: Record<string, PropSpec>;
    required?: unknown;
  };
  return (
    r.api_schemas?.[0]?.request_schema ??
    r.request_schema ??
    r.components?.schemas?.Input ??
    (r.properties ? { properties: r.properties, required: r.required } : null)
  );
}

/* --------------------------------------------------------------- 字段判定 */

/**
 * 名字里带媒体词但其实不是文件的字段。
 * num_images 是张数、image_size 是尺寸、voice_ids 是音色编号——
 * 不先排掉，下面的 kind 判定会把它们全当成媒体位。
 */
const NOT_A_FILE =
  /^(num|n|count|batch|enable|output|input)_|_(count|size|num|format|quality|strength|scale|mode|type|weight|ratio|id|ids|index|name|names|prompt|level|steps?|seed)$|^(num_images|image_size|image_format|output_format|enable_base64_output)$/i;

function kindOf(name: string): CapabilityKind | null {
  const n = name.toLowerCase();
  if (/(audios?|voices?|speech|music|sound)(_url)?s?$|^(audio|voice)_/.test(n)) return "audio";
  if (/(videos?|footage|clips?)(_url)?s?$|^video_/.test(n)) return "video";
  if (/\b(mesh|glb|gltf|model_file|3d)\b|^mesh|_mesh$/.test(n)) return "model3d";
  if (/image|photo|picture|frame|face|mask|reference|^sref$|^refers$/.test(n)) return "image";
  return null;
}

/**
 * 角色判定。顺序即优先级，**从最具体到最泛**——
 * last_image 同时命中 image 与 end_frame，先判 end_frame 才不会被吞成 subject。
 */
function roleOf(
  name: string,
  kind: CapabilityKind,
  ctx: { isArray: boolean; modelId: string; type: string }
): InputRole {
  const n = name.toLowerCase();
  if (kind === "audio") return "audio";
  if (kind === "model3d") return "model3d";
  if (/mask/.test(n)) return "mask";
  if (/face|swap/.test(n)) return "face";
  if (/(last|end|tail)_?(image|frame)/.test(n)) return "end_frame";

  /*
   * 视频位按**结构**判而不是按名字：
   * 「要处理的那一个视频」本质是单数，一列视频只可能是参考素材。
   * 早先按 /^videos?$/ 判，把 wan-2.7 参考生视频的 videos 数组错判成了源视频。
   */
  if (kind === "video") return ctx.isArray ? "reference" : "source_video";

  // 换脸类模型里那张图就是人脸，哪怕字段名只叫 image
  if (/face.?swap|swap.?face/i.test(`${ctx.modelId} ${ctx.type}`)) return "face";

  if (/reference|^images$|^sref$|^refers$|^ref_/.test(n)) return "reference";
  if (/^image$|^img$|^input_image$|(start|first)_?(image|frame)/.test(n)) return "subject";
  return "reference";
}

/* ----------------------------------------------------------------- 派生器 */

/** 从 TEXT-TO-VIDEO / IMAGE-TO-3D 这类归一化 type 里取产出类型 */
function outputKindFromType(type: string): CapabilityKind | null {
  const m = /[-_]TO[-_]([A-Z0-9]+)/i.exec(type || "");
  const tail = (m?.[1] ?? type ?? "").toUpperCase();
  if (/^3D$|MESH|MODEL/.test(tail)) return "model3d";
  if (/VIDEO/.test(tail)) return "video";
  if (/AUDIO|SPEECH|MUSIC|VOICE/.test(tail)) return "audio";
  if (/IMAGE/.test(tail)) return "image";
  return null;
}

/**
 * 一次产出几件。
 * 看 schema 里的张数字段（num_images / num_outputs / batch_size）：
 * 有 maximum 就用它，没有就按「可能多件」处理（max = null）。
 */
function outputCount(props: Record<string, PropSpec>): { min: number; max: number | null } {
  for (const key of ["num_images", "num_outputs", "n", "batch_size", "num_frames_per_batch"]) {
    const spec = props[key];
    if (!spec) continue;
    const max = typeof spec.maximum === "number" ? spec.maximum : null;
    return { min: 1, max };
  }
  return { min: 1, max: 1 };
}

export function deriveCapability(opts: {
  /** 仅用于少数依赖模型语义的判定（如换脸），不参与字段解析 */
  modelId?: string;
  type: string;
  apiSchema: string | null | undefined;
}): ModelCapability {
  const notes: string[] = [];

  let root: Record<string, unknown> | null = null;
  if (opts.apiSchema) {
    try {
      root = JSON.parse(opts.apiSchema) as Record<string, unknown>;
    } catch {
      notes.push("schema 不是合法 JSON，输入位无法派生");
    }
  } else {
    notes.push("未同步 schema，输入位无法派生");
  }

  const node = root ? pickNode(root) : null;
  const props = node?.properties ?? {};
  if (root && !node?.properties) notes.push("schema 里找不到 properties 节点");

  const required = new Set(
    (Array.isArray(node?.required) ? node.required : [])
      .filter((r): r is string => typeof r === "string")
      .filter((r) => r !== "model")
  );

  const inputs: CapabilityInput[] = [];
  for (const [field, spec] of Object.entries(props)) {
    if (field === "model" || !spec || typeof spec !== "object") continue;
    if (NOT_A_FILE.test(field)) continue;

    const kind = kindOf(field);
    if (!kind) continue;

    const isArray = spec.type === "array";
    // 非数组且非字符串（number 的 mask_strength 之类）不是文件字段
    if (!isArray && spec.type && spec.type !== "string") continue;
    // 带 enum 的字符串是选项而不是上传位
    if (Array.isArray(spec.enum) && spec.enum.length > 0) continue;

    const isRequired = required.has(field);
    /*
     * min 只由 required 决定。minItems 在 JSON Schema 里的含义是
     * 「这个数组**如果出现**至少几个元素」，跟「必须出现」无关；
     * 把两者混为一谈会让一堆选填位被标成必填。
     */
    const declaredMin = typeof spec.minItems === "number" ? spec.minItems : null;
    if (!isRequired && (declaredMin ?? 0) > 0) {
      notes.push(`${field}: 声明了 minItems=${declaredMin} 但不在 required 里，按选填处理`);
    }

    inputs.push({
      field,
      kind,
      role: roleOf(field, kind, { isArray, modelId: opts.modelId ?? "", type: opts.type }),
      min: isRequired ? (declaredMin ?? 1) : 0,
      max: typeof spec.maxItems === "number" ? spec.maxItems : isArray ? null : 1,
    });
  }

  // 必填在前，其余保持 schema 顺序：用户先看到不填就交不了的那些
  inputs.sort((a, b) => Number(b.min > 0) - Number(a.min > 0));

  const outKind = outputKindFromType(opts.type);
  const outputs: CapabilityOutput[] = [];
  if (outKind) {
    outputs.push({ kind: outKind, ...(outKind === "image" ? outputCount(props) : { min: 1, max: 1 }) });
  } else {
    notes.push(`无法从 type「${opts.type}」判断产出类型`);
  }

  return { inputs, outputs, notes };
}

/** schema 变没变。变了就重新派生（人工覆盖过的只标待复核，不动内容） */
export function schemaFingerprint(apiSchema: string | null | undefined): string | null {
  if (!apiSchema) return null;
  // 轻量哈希即可：这里只用来判等，不做安全用途
  let h = 2166136261;
  for (let i = 0; i < apiSchema.length; i++) {
    h ^= apiSchema.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** 给列表页看的一行摘要，如「1图* + 30参考图 → 1视频」 */
export function summarize(cap: ModelCapability): string {
  const ROLE_CN: Record<InputRole, string> = {
    subject: "主体", end_frame: "尾帧", reference: "参考", mask: "蒙版",
    face: "人脸", source_video: "源视频", audio: "音频", model3d: "3D", other: "其他",
  };
  const KIND_CN: Record<CapabilityKind, string> = {
    image: "图", video: "视频", audio: "音频", model3d: "3D", text: "文本",
  };
  const ins = cap.inputs.map(
    (i) => `${i.max ?? "n"}${KIND_CN[i.kind]}·${ROLE_CN[i.role]}${i.min > 0 ? "*" : ""}`
  );
  const outs = cap.outputs.map((o) => `${o.max ?? "n"}${KIND_CN[o.kind]}`);
  return `${ins.join(" + ") || "无输入位"} → ${outs.join(" + ") || "未知"}`;
}
