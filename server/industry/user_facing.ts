export { humanizeIndustryWorkflowResponse, formatIndustryWorkflowPrerequisiteBlocker } from '../regions/messages/industry_user_facing_messages';

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
