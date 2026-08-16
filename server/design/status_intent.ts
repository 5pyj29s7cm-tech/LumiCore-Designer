const DESIGN_SUBJECT_ZH_RE = /(?:设计项目|室内项目|装修项目|空间项目|项目档案|项目工作流|项目进度|样板间|验收户型)/u;
const DESIGN_STATUS_ZH_RE = /(?:事实|状态|进度|阶段|完成了吗|做完了吗|创建好了吗|建好了吗|做到哪|进行到哪|哪一步|到哪了|怎么样|如何|当前|现在|目前|查询|查看)/u;
const DESIGN_STAGE_ACTION_ZH_RE = /(?:进入|开始|继续|推进|执行|着手|启动).{0,20}(?:CAD|效果图|渲染|提案|PPT|交付|设计阶段|效果图阶段|交付阶段)|(?:请|帮我|给我).{0,24}(?:生成|制作|做一张|做一份|产出).{0,20}(?:CAD|效果图|渲染图|提案|PPT|交付包)/iu;

const DESIGN_SUBJECT_EN_RE = /\b(?:design|interior|renovation|project)\b/i;
const DESIGN_STATUS_EN_RE = /\b(?:status|progress|facts?|current\s+stage|what\s+stage|where\s+(?:are|is)|how\s+far|next\s+stage)\b/i;
const DESIGN_STAGE_ACTION_EN_RE = /\b(?:start|enter|continue|advance|execute|generate|create|make|render|build)\b.{0,40}\b(?:visualization|render|cad|presentation|proposal|handoff|delivery|stage)\b/i;

export function isDesignProjectStatusRequest(text: unknown): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  if (DESIGN_STAGE_ACTION_ZH_RE.test(value) || DESIGN_STAGE_ACTION_EN_RE.test(value)) return false;
  return (
    DESIGN_SUBJECT_ZH_RE.test(value) && DESIGN_STATUS_ZH_RE.test(value)
  ) || (
    DESIGN_SUBJECT_EN_RE.test(value) && DESIGN_STATUS_EN_RE.test(value)
  );
}
