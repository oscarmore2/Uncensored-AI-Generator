/**
 * 技能模板里能用的变量清单。给管理端显示，也是这份契约的唯一出处。
 *
 * 变量之外的一切由技能作者自由书写；写错的变量名会**原样留在提示词里**，
 * 那是故意的——静默清空的话，作者要到看见模型答非所问时才会发现。
 */
export const TEMPLATE_VARIABLES: Array<{ name: string; desc: string }> = [
  {
    name: "selection",
    desc: "要改的那一段（素材引用已换成占位符）。章节时机下装的是整节，带着井号标题",
  },
  { name: "context_before", desc: "选区之前的 300 字" },
  { name: "context_after", desc: "选区之后的 300 字" },
  { name: "full_text", desc: "整段提示词的 canonical 文本" },
  { name: "mode_rules", desc: "当前模式的写作规则，逐条展开" },
  { name: "mode", desc: "当前模式（txt2img / txt2vid …）" },
  { name: "tier", desc: "当前档位" },
  { name: "format_id", desc: "写作格式（image_t2i / video_t2v …）" },
  { name: "target_language", desc: "中英互转的目标语言，按选区内容判定" },
  { name: "shorten_limit", desc: "精简的目标字数" },
  { name: "style", desc: "当前风格选择（仅 manual 时机）" },
  { name: "ratio", desc: "当前画幅（仅 manual 时机）" },
  { name: "existing_negative", desc: "用户已填的反向提示词（仅 manual 时机）" },
  { name: "task_metadata", desc: "任务元数据 JSON，便于网关与日志识别用途（仅 manual 时机）" },
  { name: "prompt_field", desc: "上游接收提示词的字段名（仅 manual 时机）" },
];

/** `{{#name}}…{{/name}}`：值非空才输出这一段。前后文经常是空的，需要它 */
export const TEMPLATE_SECTION_HINT = "{{#context_before}}…{{/context_before}}";
