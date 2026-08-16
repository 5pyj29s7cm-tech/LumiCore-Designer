const INTERNAL_CAPABILITY_LABELS: Array<[RegExp, string]> = [
  [/`?mcp_design-studio-pack_interior_visual_direction`?/gi, '专业视觉方向评估'],
  [/`?mcp_design-studio-pack_drawing_ingest_qa`?/gi, '专业图纸资料质检'],
  [/`?mcp_design-studio-pack_interior_project_brief`?/gi, '专业项目需求梳理'],
  [/`?mcp_design-studio-pack_space_planning_checklist`?/gi, '空间规划检查'],
  [/`?generate_image`?/gi, '图片生成服务'],
  [/`?create_ppt`?/gi, '提案文件生成'],
  [/`?design_delivery_package_create`?/gi, '交付包整理'],
  [/`?cad_generate_dxf`?/gi, 'CAD 文件生成'],
  [/`?industry_workflow_complete`?/gi, '完成校验'],
  [/`?work_takeover_task_get`?/gi, '任务状态读取'],
];

export function humanizeIndustryWorkflowResponse(text: unknown): string {
  let value = String(text || '');
  value = value.replace(/`?(?:industry_)?wt_task_[A-Za-z0-9_-]+`?/g, '当前任务');
  for (const [pattern, label] of INTERNAL_CAPABILITY_LABELS) {
    value = value.replace(pattern, label);
  }
  value = value.replace(/未调用完成校验/g, '因此没有标记为完成');
  return value;
}

export function mergeIndustryWorkflowFinalState(
  finalized: { blocked?: boolean; reason?: string; notification?: unknown },
  workflowRecord: { verification?: { passed?: boolean; summary?: string } } | null | undefined,
): { blocked: boolean; reason?: string; notification?: unknown } {
  const workflowBlocked = Boolean(workflowRecord && workflowRecord.verification?.passed !== true);
  const blocked = finalized.blocked === true || workflowBlocked;
  const reason = finalized.reason
    || (workflowBlocked ? String(workflowRecord?.verification?.summary || 'Industry workflow verification did not pass.') : undefined);
  const notification = finalized.notification || (workflowBlocked
    ? {
        type: 'industry_workflow_guard',
        level: 'warning',
        message: reason,
      }
    : undefined);
  return { blocked, reason, notification };
}

const DESIGN_STAGE_LABELS: Record<string, string> = {
  project: '项目建档',
  cad: 'CAD 方案',
  visualization: '效果图',
  presentation: '提案 PPT',
  handoff: '交付中心',
};

export function formatIndustryWorkflowPrerequisiteBlocker(input: {
  projectName?: string;
  entryId: string;
  missing: string[];
}): string {
  const projectName = String(input.projectName || '').trim() || '当前设计项目';
  const target = DESIGN_STAGE_LABELS[input.entryId] || input.entryId;
  const missing = input.missing.map(item => DESIGN_STAGE_LABELS[item] || item).join('、');
  return [
    `我已核对「${projectName}」的持久项目账本。`,
    `当前不能进入${target}：上游的${missing}尚未通过真实回执。`,
    '本轮没有生成或覆盖下游文件，也没有执行任何对外发送。',
    `请先完成${missing}；通过核验后，Lumi 会继续沿用同一项目和已有成果，不需要重新建项目或重新猜测资料。`,
  ].join('\n');
}
