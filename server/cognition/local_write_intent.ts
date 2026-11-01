// i18n-allow: recognized input vocabulary; this literal does not render user-facing text.
const NEGATED_LOCAL_OUTPUT_RE = /(?:不要|别|不用|无需|先别|暂时别|禁止|do\s+not|don't|without).{0,20}(?:生成|创建|写入|保存|导出|输出|制作|绘制|generate|create|write|save|export|draw)/iu;
// i18n-allow: recognized input vocabulary; this literal does not render user-facing text.
const LOCAL_OUTPUT_ACTION_RE = /(?:生成|创建|新建|制作|编写|写成|做成|整理成|汇总成|形成|转成|保存|导出|输出|画|绘制|出一份).{0,72}(?:文件|文档|材料|报告|笔记|纪要|记录|文本|文字|文稿|演示文稿|清单|方案|表格|图片|效果图|渲染图|图纸|平面图|预览|压缩包|交付包|归档包|CAD|DXF|DWG|PPT|PDF|Word|Excel|TXT|MD|ZIP)/iu;
const ENGLISH_LOCAL_OUTPUT_RE = /\b(?:create|generate|write|save|export|turn|make|draw|draft|build)\b.{0,96}\b(?:file|document|docx|word|pdf|txt|markdown|transcript|notes|minutes|report|pptx?|xlsx?|cad|dxf|dwg|drawing|floor\s*plan|blueprint|preview)\b/i;

export function shouldAllowExplicitLocalFileWrite(text: unknown): boolean {
  const value = String(text || '').trim();
  if (!value || NEGATED_LOCAL_OUTPUT_RE.test(value)) return false;
  return LOCAL_OUTPUT_ACTION_RE.test(value) || ENGLISH_LOCAL_OUTPUT_RE.test(value);
}
