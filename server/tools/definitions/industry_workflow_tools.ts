import { ToolRegistry } from '../registry';
import { capabilityContract, capabilityEvidence } from '../capability_contracts';
import { getCurrentIndustryCapabilityProfile, matchCurrentIndustryWorkflow } from '../../regions/packs/cn/industry_capability_profile';
import {
  getIndustryWorkflowTask,
  listIndustryWorkflowTasks,
  recordIndustryWorkflowExecution,
  startIndustryWorkflow,
} from '../../industry/workflow_service';
import type { ToolContext } from '../types';
import { PRODUCT_VARIANT } from '../../../shared/product_variant';
import {
  createInteriorProject,
  getActiveInteriorProject,
  getInteriorProject,
  listInteriorProjects,
  personalInteriorProjectScope,
  setActiveInteriorProject,
} from '../../design/projects';
import { getInteriorProjectWorkflow } from '../../design/project_workflow';

// i18n-allow: The multilingual routing hints below are internal tool-selection
// aliases for Chinese industry requests; they are never rendered as UI copy.

function scope(context?: ToolContext) {
  return {
    userId: context?.userId || 'anonymous',
    domain: context?.domain === 'work' ? 'work' as const : 'personal' as const,
    orgId: context?.domain === 'work' ? String(context?.orgId || '') : '',
  };
}

function designScope(context?: ToolContext): { scopeId: string; userId: string } {
  const active = scope(context);
  const scopeId = active.domain === 'work' ? active.orgId : personalInteriorProjectScope(active.userId);
  if (!scopeId) throw new Error('Organization scope is required for organization design projects.');
  return { scopeId, userId: active.userId };
}

function findDesignProject(args: Record<string, any>, context?: ToolContext) {
  const active = designScope(context);
  const projectId = String(args.projectId || '').trim();
  if (projectId) return { ...active, project: getInteriorProject(active.scopeId, projectId) };
  const name = String(args.name || '').trim().toLocaleLowerCase();
  if (name) {
    const matches = listInteriorProjects(active.scopeId).filter(project => project.name.toLocaleLowerCase() === name);
    if (matches.length > 1) throw new Error('More than one design project has that name; use projectId.');
    return { ...active, project: matches[0] || null };
  }
  return { ...active, project: getActiveInteriorProject(active.scopeId, active.userId) };
}

function registerDesignProjectTools(registry: ToolRegistry): void {
  registry.register({
    name: 'interior_design_project_create',
    description: 'Create and activate one durable interior design project before CAD, visualization, proposal, and handoff work. Use this for a new project, not industry_workflow_start alone.',
    // i18n-allow: Reviewed Chinese input-recognition aliases; not rendered as UI copy.
    routingHints: ['new interior design project', 'create design project', '新建室内设计项目', '创建设计项目', '新建设计项目'],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name. Ask the user when it is missing.' },
        projectType: { type: 'string', enum: ['residential', 'office', 'retail', 'hospitality', 'other'] },
        location: { type: 'string' },
        area: { type: 'string' },
        occupants: { type: 'string' },
        budget: { type: 'string' },
        style: { type: 'string' },
        requirements: { type: 'string' },
        constraints: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args, context) => {
      const active = designScope(context);
      const project = createInteriorProject(active.scopeId, active.userId, {
        name: args.name,
        projectType: args.projectType || 'other',
        brief: {
          location: args.location || '',
          area: args.area || '',
          occupants: args.occupants || '',
          budget: args.budget || '',
          style: args.style || '',
          requirements: args.requirements || '',
          constraints: args.constraints || '',
        },
      });
      setActiveInteriorProject(active.scopeId, active.userId, project.id);
      return JSON.stringify({
        ok: true,
        status: 'created',
        persisted: true,
        active: true,
        project,
        workflow: getInteriorProjectWorkflow(active.scopeId, project.id),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'design.project.create', family: 'industry', lane: 'industry', operation: 'create', risk: 'low',
      sideEffects: [{ type: 'local_state_change', scope: 'interior design project and active project binding', reversible: true }],
      verification: {
        strategy: 'artifact', required: true,
        requiredFields: ['ok', 'status', 'persisted', 'active', 'project.id', 'project.name'],
        requiredValues: { ok: true, persisted: true, active: true }, successStatuses: ['created'],
        successSignals: ['durable scoped project returned'],
        limitations: ['Creates the project container; it does not complete any design deliverable.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'design.project.create', operation: 'create', subjectArgument: 'name', limitations: ['Later stage receipts are required.'] }),
  });

  registry.register({
    name: 'interior_design_project_select',
    description: 'Select the active durable design project by exact id or exact name so later voice/chat workflow commands inherit the same project.',
    // i18n-allow: Reviewed Chinese input-recognition aliases; not rendered as UI copy.
    routingHints: ['select design project', 'switch design project', '选择设计项目', '切换设计项目', '打开这个项目'],
    parameters: {
      type: 'object',
      properties: { projectId: { type: 'string' }, name: { type: 'string' } },
      required: [],
    },
    handler: async (args, context) => {
      const resolved = findDesignProject(args, context);
      if (!resolved.project) throw new Error('Design project not found. Provide an exact project id or name.');
      const project = setActiveInteriorProject(resolved.scopeId, resolved.userId, resolved.project.id);
      return JSON.stringify({
        ok: true, status: 'selected', persisted: true, active: true, project,
        workflow: getInteriorProjectWorkflow(resolved.scopeId, resolved.project.id),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'design.project.select', family: 'industry', lane: 'industry', operation: 'mutate', risk: 'low',
      sideEffects: [{ type: 'local_state_change', scope: 'active design project binding', reversible: true }],
      verification: {
        strategy: 'state_diff', required: true,
        requiredFields: ['ok', 'status', 'persisted', 'active', 'project.id'],
        requiredValues: { ok: true, persisted: true, active: true }, successStatuses: ['selected'],
        successSignals: ['server-owned active project binding updated'],
        limitations: ['Does not execute a design stage.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'design.project.select', operation: 'mutate', subjectArgument: 'projectId', limitations: ['Only changes the current project context.'] }),
  });

  registry.register({
    name: 'interior_design_project_status',
    description: 'Read the active design project and its durable project/CAD/visualization/presentation/handoff task, receipt, artifact, blocker, and completion state.',
    // i18n-allow: Reviewed Chinese input-recognition aliases; not rendered as UI copy.
    routingHints: ['design project status', 'project delivery progress', '设计项目进度', '项目做到哪了', 'CAD效果图PPT进度'],
    parameters: {
      type: 'object',
      properties: { projectId: { type: 'string' }, name: { type: 'string' } },
      required: [],
    },
    handler: async (args, context) => {
      const resolved = findDesignProject(args, context);
      if (!resolved.project) throw new Error('No active design project is bound. Create or select a project first.');
      return JSON.stringify({
        ok: true, status: 'observed', persisted: true, project: resolved.project,
        workflow: getInteriorProjectWorkflow(resolved.scopeId, resolved.project.id),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'design.project.status', family: 'industry', lane: 'industry', operation: 'observe', risk: 'low',
      sideEffects: [{ type: 'none', scope: 'design project workflow state', reversible: true }],
      verification: {
        strategy: 'measured', required: true,
        requiredFields: ['ok', 'status', 'persisted', 'project.id', 'workflow.stages'],
        requiredValues: { ok: true, persisted: true }, successStatuses: ['observed'],
        successSignals: ['durable project workflow state returned'],
        limitations: ['Reports persisted receipts and blockers; it does not infer unrecorded progress.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'design.project.status', operation: 'observe', subjectArgument: 'projectId', limitations: ['Read-only status query.'] }),
  });
}

export function registerIndustryWorkflowTools(registry: ToolRegistry): void {
  if (PRODUCT_VARIANT.productLine === 'design') registerDesignProjectTools(registry);
  registry.register({
    name: 'industry_capability_profile_get',
    description: 'Read the authoritative identity, outcome workspaces, automatic preparation actions, professional-review boundaries, and optional extensions for this exact Lumi industry edition.',
    // i18n-allow: Reviewed Chinese input-recognition aliases; not user-visible copy.
    routingHints: ['this Lumi edition', 'industry capabilities', 'what can you do', '你是什么版本', '你能做什么', '自动流程', '半自动流程'],
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: 'Optional natural-language industry request to classify without starting work.' } },
      required: [],
    },
    handler: async (args) => {
      const profile = getCurrentIndustryCapabilityProfile();
      if (!profile) throw new Error('This runtime has no industry capability profile.');
      const match = args.request ? matchCurrentIndustryWorkflow(args.request) : null;
      return JSON.stringify({
        ok: true, status: 'observed', profile,
        match: match ? { entryId: match.entry.entryId, displayName: match.entry.displayName, score: match.score, matchedTerms: match.matchedTerms } : null,
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'industry.capability-profile.observe', family: 'industry', lane: 'industry', operation: 'observe',
      risk: 'low',
      sideEffects: [{ type: 'none', scope: 'industry capability profile', reversible: true }],
      verification: {
        strategy: 'measured', required: true,
        requiredFields: ['ok', 'status', 'profile.variantId', 'profile.productLine', 'profile.entries'],
        requiredValues: { ok: true }, successStatuses: ['observed'],
        successSignals: ['server-owned profile returned'],
        limitations: ['Describes registered edition workflows; external connectors still require runtime health checks.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'industry.capability-profile.observe', operation: 'observe', subjectArgument: 'request', limitations: ['Does not execute an industry workflow.'] }),
  });

  registry.register({
    name: 'industry_workflow_start',
    description: 'Start exactly one persistent, edition-scoped industry outcome workflow from a natural-language request. Returns the existing task on an idempotent retry. Continue it with real domain tools and verify before claiming completion.',
    // i18n-allow: Reviewed Chinese industry-workspace aliases; not user-visible copy.
    routingHints: ['industry workflow', 'outcome workspace', '今日经营', '爆款雷达', '店铺数据', '商品管理', '内容与客服', '设计项目', 'CAD 方案', '效果图', '提案 PPT', '交付中心', '案件工作台', '文书生成', '合同审查', '法条与类案', '财产线索', '交付核验', '标书制作', '经营看板', '票税管理', '账务处理', '税务申报', '资金与风险', '报表交付'],
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'Exact entry id from industry_capability_profile_get.' },
      },
      required: ['entryId'],
    },
    handler: async (args, context) => {
      const activeScope = scope(context);
      const profile = getCurrentIndustryCapabilityProfile();
      const entryId = String(args.entryId || '').trim();
      const entry = profile?.entries.find(candidate => candidate.entryId === entryId);
      if (!profile || !entry) throw new Error(`Industry entry is not available in this edition: ${entryId}`);
      const namedTaskId = String(context?.routedTaskText || '').match(/\bwt_task_[a-zA-Z0-9_-]+\b/)?.[0] || '';
      const namedTask = namedTaskId ? getIndustryWorkflowTask(activeScope, namedTaskId) : null;
      if (namedTask?.metadata?.industryWorkflow?.entryId === entryId) {
        const metadata = namedTask.metadata.industryWorkflow;
        return JSON.stringify({
          ok: true, status: 'reused', persisted: true,
          entry: { entryId, displayName: entry.displayName }, task: namedTask,
          conversationId: metadata.conversationId,
          conversationTaskId: metadata.conversationTaskId,
          requestId: metadata.requestId,
          handoffPrompt: `Continue existing industry task ${namedTask.id}; do not create a duplicate.`,
          activeTaskCount: listIndustryWorkflowTasks(activeScope, 200).filter(task => ['queued', 'in_progress', 'waiting_confirmation', 'blocked'].includes(task.status)).length,
        }, null, 2);
      }
      const idempotencyKey = String(context?.idempotencyKey || context?.requestId || '').trim();
      const started = startIndustryWorkflow({
        ...activeScope,
        entryId,
        sourceInput: String(context?.actionIntent || ''),
        source: context?.source || 'industry_natural_language',
        context: { source: context?.source || 'industry_natural_language' },
        idempotencyKey: idempotencyKey ? `industry-start:${idempotencyKey}:${entryId}` : undefined,
        conversationId: context?.conversationId,
        conversationTaskId: context?.taskId,
        requestId: context?.requestId,
      });
      return JSON.stringify({
        ok: true, status: started.reused ? 'reused' : 'created', persisted: true,
        entry: { entryId, displayName: entry.displayName }, task: started.task,
        conversationId: started.conversationId, conversationTaskId: started.conversationTaskId,
        requestId: started.requestId, handoffPrompt: started.handoffPrompt,
        activeTaskCount: listIndustryWorkflowTasks(activeScope, 200).filter(task => ['queued', 'in_progress', 'waiting_confirmation', 'blocked'].includes(task.status)).length,
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'industry.workflow.start', family: 'industry', lane: 'industry', operation: 'create',
      risk: 'low',
      sideEffects: [{ type: 'local_state_change', scope: 'persistent industry workflow and linked action ledger', reversible: true }],
      verification: {
        strategy: 'artifact', required: true,
        requiredFields: ['ok', 'status', 'persisted', 'task.id', 'conversationTaskId', 'entry.entryId'],
        requiredValues: { ok: true, persisted: true }, successStatuses: ['created', 'reused'],
        successSignals: ['persistent scoped task returned'],
        limitations: ['Starts and binds the workflow; it is not proof that the requested business result is complete.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'industry.workflow.start', operation: 'create', subjectArgument: 'entryId', limitations: ['A later verified industry receipt is required for completion.'] }),
  });

  registry.register({
    name: 'industry_workflow_complete',
    description: 'Archive and verify the active edition-scoped industry workflow from real tool receipts produced earlier in this exact tool loop. Model text alone is rejected. Returns verified delivery or a concrete blocker.',
    // i18n-allow: Reviewed Chinese industry-verification aliases; not user-visible copy.
    routingHints: ['complete industry workflow', 'verify industry result', 'archive outcome', '验收行业任务', '归档行业结果'],
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'The wt_task_* id returned by industry_workflow_start.' } },
      required: ['taskId'],
    },
    handler: async (args, context) => {
      const activeScope = scope(context);
      const taskId = String(args.taskId || '').trim();
      const task = getIndustryWorkflowTask(activeScope, taskId);
      if (!task) throw new Error('Industry workflow task was not found in the active user scope.');
      const previousVerification = task.metadata?.workTakeoverVerification;
      if (task.status === 'delivered' && previousVerification?.passed === true) {
        return JSON.stringify({
          ok: true, status: 'verified', persisted: true, reused: true,
          task, verification: previousVerification,
        }, null, 2);
      }
      const excluded = new Set([
        'industry_capability_profile_get',
        'industry_workflow_start',
        'industry_workflow_complete',
        'work_takeover_task_get',
      ]);
      const evidenceRecords = (context?.getCurrentToolRecords?.() || []).filter(record => (
        !excluded.has(record.name)
        && !record.error
        && record.terminalVerification?.status === 'verified'
        && String(record.result || '').trim()
      ));
      if (!evidenceRecords.length) {
        throw new Error('No verified domain-tool receipt exists in this execution loop. Run the real industry capability before verification.');
      }
      const receiptText = evidenceRecords.map(record => String(record.result || '')).join('\n\n').slice(0, 12_000);
      const recorded = recordIndustryWorkflowExecution({
        ...activeScope,
        taskId,
        resultText: receiptText,
        toolRecords: evidenceRecords,
        source: context?.source || 'industry_natural_language',
      });
      return JSON.stringify({
        ok: recorded.verification.passed,
        status: recorded.verification.passed ? 'verified' : recorded.verification.status,
        persisted: true,
        task: recorded.task,
        verification: recorded.verification,
        archivedFilePaths: recorded.archivedFilePaths,
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'industry.workflow.complete', family: 'industry', lane: 'industry', operation: 'test', risk: 'low',
      sideEffects: [{ type: 'local_state_change', scope: 'industry workflow archive, verification and linked action ledger', reversible: true }],
      verification: {
        strategy: 'artifact', required: true,
        requiredFields: ['ok', 'status', 'persisted', 'task.id', 'verification.passed'],
        requiredValues: { ok: true, persisted: true, 'verification.passed': true },
        successStatuses: ['verified'], failureStatuses: ['blocked', 'needs_review'],
        successSignals: ['server-side industry verifier passed over current-loop receipts'],
        limitations: ['Verifies the scoped local result; it does not imply any unrequested external side effect.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'industry.workflow.complete', operation: 'test', subjectArgument: 'taskId', limitations: ['Requires earlier verified domain-tool receipts from the same execution loop.'] }),
  });
}
