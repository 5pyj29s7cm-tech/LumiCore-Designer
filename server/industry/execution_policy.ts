import type { ToolPolicy } from '../personality/types';

export function bindIndustryWorkflowToolPolicy(
  base: ToolPolicy,
  task: any,
  availableToolNames: string[],
): ToolPolicy {
  const contract = task?.metadata?.industryWorkflow?.contract || {};
  const available = new Set(availableToolNames);
  const explicitForbidden = new Set((base.forbiddenTools || []).filter(name => name !== '*'));
  const allowedTools = Array.from(new Set([
    'work_takeover_task_get',
    ...(Array.isArray(contract.executionTools) ? contract.executionTools.map(String) : []),
    'industry_workflow_complete',
    'work_takeover_task_verify_result',
  ])).filter(name => available.has(name) && !explicitForbidden.has(name));
  return {
    ...base,
    allowedTools,
    requireConfirmation: (base.requireConfirmation || []).filter(name => allowedTools.includes(name)),
    forbiddenTools: Array.from(explicitForbidden),
    maxIterations: Math.min(8, Math.max(6, base.maxIterations || 0)),
  };
}
