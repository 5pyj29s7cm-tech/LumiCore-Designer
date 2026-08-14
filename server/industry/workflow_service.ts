import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readDB, writeDB } from '../../db_layer';
import { getConversationForScope, getOrCreateActiveConversation } from '../conversation/manager';
import {
  ensureBackgroundConversationActionTask,
  settleBackgroundConversationActionTask,
} from '../conversation/action_ledger';
import type { ToolExecutionRecord } from '../tools/types';
import { verifyWorkTakeoverResult, type WorkTakeoverResultVerification } from '../work_takeover/result_verifier';
import {
  createWorkTakeoverTask,
  getWorkTakeoverTask,
  listWorkTakeoverTasks,
  updateWorkTakeoverTask,
  type WorkTakeoverTask,
  type WorkTakeoverStatus,
} from '../work_takeover/tasks';
import { PRODUCT_VARIANT } from '../../shared/product_variant';
import {
  getIndustryWorkflowContract,
  getIndustryWorkflowContracts,
  normalizeIndustryProductLine,
  type IndustryWorkflowContract,
} from './workflow_contracts';
import {
  getActiveInteriorProject,
  getInteriorProject,
  personalInteriorProjectScope,
  type InteriorProject,
} from '../design/projects';
import {
  formatInteriorProjectWorkflowContext,
  getInteriorProjectWorkflow,
  getMissingInteriorProjectPrerequisites,
  isInteriorDesignStageId,
  linkInteriorProjectWorkflowStage,
  settleInteriorProjectWorkflowStage,
  type InteriorDesignStageId,
  type InteriorProjectWorkflowState,
} from '../design/project_workflow';
import { listInteriorProjectAssets } from '../design/project_assets';

export interface IndustryWorkflowScope {
  userId: string;
  domain: 'personal' | 'work';
  orgId: string;
}

export interface StartIndustryWorkflowInput extends IndustryWorkflowScope {
  entryId: string;
  sourceInput?: string;
  source?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
  conversationId?: string;
  conversationTaskId?: string;
  requestId?: string;
}

export interface IndustryWorkflowStartResult {
  task: WorkTakeoverTask;
  conversationId: string;
  conversationTaskId: string;
  requestId: string;
  contract: IndustryWorkflowContract;
  handoffPrompt: string;
  reused?: boolean;
  project?: InteriorProject;
  projectWorkflow?: InteriorProjectWorkflowState;
}

export interface RecordIndustryWorkflowInput extends IndustryWorkflowScope {
  taskId: string;
  resultText?: string;
  filePaths?: string[];
  toolRecords?: ToolExecutionRecord[];
  source?: string;
}

export interface IndustryWorkflowRecordResult {
  task: WorkTakeoverTask;
  verification: WorkTakeoverResultVerification;
  conversationTaskId: string;
  archivedFilePaths: string[];
}

function compact(value: unknown, limit = 5000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function productLine() {
  return normalizeIndustryProductLine(PRODUCT_VARIANT.productLine);
}

function contractForCurrentProduct(entryId: unknown): IndustryWorkflowContract {
  const line = productLine();
  const contract = line ? getIndustryWorkflowContract(line, entryId) : null;
  if (!contract) throw new Error(`Industry workflow is not available in ${PRODUCT_VARIANT.variantId}: ${String(entryId || '')}`);
  return contract;
}

function scopeMatches(task: WorkTakeoverTask, scope: IndustryWorkflowScope): boolean {
  return task.userId === scope.userId
    && task.domain === scope.domain
    && String(task.orgId || '') === String(scope.orgId || '');
}

function workflowMetadata(task: WorkTakeoverTask): Record<string, any> {
  const metadata = task.metadata?.industryWorkflow;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function taskContract(task: WorkTakeoverTask): IndustryWorkflowContract {
  const metadata = workflowMetadata(task);
  const contract = contractForCurrentProduct(metadata.entryId);
  if (metadata.productLine !== contract.productLine) throw new Error('Industry workflow product boundary mismatch.');
  return contract;
}

function designProjectScope(scope: IndustryWorkflowScope): string {
  return scope.domain === 'work' ? String(scope.orgId || '') : personalInteriorProjectScope(scope.userId);
}

function designProjectForInput(
  input: StartIndustryWorkflowInput,
  contract: IndustryWorkflowContract,
): InteriorProject | null {
  if (contract.productLine !== 'design') return null;
  const scopeId = designProjectScope(input);
  if (!scopeId) throw new Error('Organization scope is required for organization design projects.');
  const requestedProjectId = compact(input.context?.projectId, 200);
  if (requestedProjectId) {
    const requested = getInteriorProject(scopeId, requestedProjectId);
    if (!requested) throw new Error('The requested design project was not found in the active user scope.');
    return requested;
  }
  return getActiveInteriorProject(scopeId, input.userId);
}

function designProjectBinding(task: WorkTakeoverTask): {
  scopeId: string;
  projectId: string;
  projectName: string;
  entryId: InteriorDesignStageId;
} | null {
  const metadata = workflowMetadata(task);
  const context = metadata.context && typeof metadata.context === 'object' && !Array.isArray(metadata.context)
    ? metadata.context
    : {};
  const projectId = compact(context.projectId, 200);
  if (metadata.productLine !== 'design' || !projectId || !isInteriorDesignStageId(metadata.entryId)) return null;
  return {
    scopeId: designProjectScope({ userId: task.userId, domain: task.domain === 'work' ? 'work' : 'personal', orgId: task.orgId }),
    projectId,
    projectName: compact(context.projectName, 200),
    entryId: metadata.entryId,
  };
}

function buildTaskSummary(contract: IndustryWorkflowContract, sourceInput: string): string {
  const normalized = compact(sourceInput, 12_000);
  return [
    `${contract.title} workflow prepared by the ${contract.productLine} client.`,
    normalized ? `Source input digest=${sha256(normalized)}; characters=${normalized.length}.` : 'Source input is collected by the execution surface when the task continues.',
    'Completion is allowed only after server-side evidence verification.',
  ].join(' ');
}

function buildHandoffPrompt(task: WorkTakeoverTask, contract: IndustryWorkflowContract): string {
  const binding = designProjectBinding(task);
  const projectWorkflow = binding
    ? getInteriorProjectWorkflow(binding.scopeId, binding.projectId)
    : null;
  const projectAssets = binding
    ? listInteriorProjectAssets(binding.scopeId, binding.projectId)
    : [];
  const projectContext = binding && projectWorkflow
    ? [
        `Bound design project: ${binding.projectName || binding.projectId} (${binding.projectId}).`,
        `Project root action task: ${projectWorkflow.rootTaskId || 'pending'}.`,
        'Reuse verified upstream task receipts and artifact paths; do not infer a different project or repeat completed side effects.',
        'Bound project source assets:',
        ...(projectAssets.length
          ? projectAssets.map(asset => `- ${asset.category}: ${asset.displayName}; fileId=${asset.fileId}; extraction=${asset.extractionStatus || 'unknown'}`)
          : ['- none; request the required source instead of guessing dimensions or project facts.']),
        'Durable stage ledger:',
        formatInteriorProjectWorkflowContext(projectWorkflow),
      ].join('\n')
    : '';
  return [
    `Continue the existing industry workflow task ${task.id}; do not create a duplicate task.`,
    `Workflow: ${contract.title} (${contract.productLine}/${contract.entryId}).`,
    `First call work_takeover_task_get with id=${task.id}, then execute the real domain tools required by the user's request.`,
    `Required local artifact labels: ${contract.requiredArtifactLabels.join(', ')}.`,
    `Required evidence terms: ${contract.expectedContentTerms.join(', ')}.`,
    `Confirmation boundaries: ${contract.confirmationBoundaries.join(' ')}`,
    projectContext,
    contract.requiresFileArtifact
      ? `A real non-empty file is mandatory. Accepted extensions: ${contract.acceptedFileExtensions.join(', ')}. Model text alone is not completion.`
      : 'A persisted, reviewable result is mandatory. Model narration that is not archived and verified is not completion.',
    `Before claiming completion, call work_takeover_task_verify_result with id=${task.id}, requiredArtifactLabels and expectedContentTerms from this contract.`,
    'If verification does not pass, report the blocker and next step; never claim completion from a draft, plan, or opened screen.',
  ].filter(Boolean).join('\n');
}

function conversationTaskIdFor(task: WorkTakeoverTask): string {
  return compact(workflowMetadata(task).conversationTaskId, 200);
}

function correlationFor(task: WorkTakeoverTask): { conversationId: string; conversationTaskId: string; requestId: string } {
  const metadata = workflowMetadata(task);
  return {
    conversationId: compact(metadata.conversationId, 200),
    conversationTaskId: compact(metadata.conversationTaskId, 200),
    requestId: compact(metadata.requestId, 200),
  };
}

function ensureDesignProjectRootActionTask(input: {
  db: any;
  project: InteriorProject;
  conversationId: string;
  userId: string;
  domain: 'personal' | 'work';
  orgId: string;
  requestId: string;
}): string {
  const rootTaskId = `design_project_${input.project.id}`;
  const rootTask = ensureBackgroundConversationActionTask(input.db, {
    taskId: rootTaskId,
    conversationId: input.conversationId,
    userId: input.userId,
    domain: input.domain,
    orgId: input.orgId,
    goal: `Complete and verify design project ${input.project.name}`,
    target: `design-project:${input.project.id}`,
    requestId: input.requestId,
    source: 'design_project_workflow',
    context: { designProject: { projectId: input.project.id, projectName: input.project.name } },
  });
  if (rootTask.status !== 'executing') {
    rootTask.status = 'executing';
    rootTask.blocker = '';
    rootTask.completedAt = '';
    rootTask.completionSource = '';
    rootTask.activeRequestId = input.requestId;
    rootTask.updatedAt = new Date().toISOString();
    rootTask.revision = Math.max(1, Number(rootTask.revision) || 0) + 1;
  }
  return rootTaskId;
}

function safeFilePaths(input: string[], contract: IndustryWorkflowContract): string[] {
  const accepted = new Set(contract.acceptedFileExtensions.map(extension => extension.toLowerCase()));
  const paths: string[] = [];
  for (const raw of input.slice(0, 30)) {
    const filePath = String(raw || '').trim();
    if (!filePath || paths.includes(filePath)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size < 16) continue;
      if (accepted.size > 0 && !accepted.has(path.extname(filePath).toLowerCase())) continue;
      paths.push(filePath);
    } catch {}
  }
  return paths;
}

function collectPathCandidates(value: unknown, result: string[], depth = 0): void {
  if (depth > 5 || value == null || result.length >= 60) return;
  if (Array.isArray(value)) {
    value.slice(0, 60).forEach(item => collectPathCandidates(item, result, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:path|filePath|outputPath|artifactPath|receiptPath|presentationPath|pdfPath|documentPath|imagePath|cadPath)$/i.test(key) && typeof child === 'string') {
      result.push(child);
    } else if (/(?:paths|files|artifacts|outputs|deliverables)$/i.test(key) || typeof child === 'object') {
      collectPathCandidates(child, result, depth + 1);
    }
  }
}

function parseRecordPayload(record: ToolExecutionRecord): unknown {
  if (record.receipt && typeof record.receipt === 'object') return record.receipt;
  let value: unknown = record.result;
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}

function recordFilePaths(records: ToolExecutionRecord[], contract: IndustryWorkflowContract): string[] {
  const candidates: string[] = [];
  records.forEach(record => collectPathCandidates(parseRecordPayload(record), candidates));
  return safeFilePaths(candidates, contract);
}

function toolRunHistory(task: WorkTakeoverTask, records: ToolExecutionRecord[]): any[] {
  const current = Array.isArray(task.metadata?.workTakeoverToolRuns) ? task.metadata.workTakeoverToolRuns : [];
  const appended = records.slice(-30).map(record => ({
    id: compact(record.id || `industry_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, 200),
    toolName: compact(record.name, 200),
    status: record.error || !String(record.result || '').trim() ? 'failed' : 'completed',
    result: compact(record.result, 3000),
    resultDigest: sha256(record.result),
    taskId: record.taskId || '',
    requestId: record.requestId || '',
    recordedAt: new Date().toISOString(),
  }));
  return [...current.slice(-30), ...appended].slice(-30);
}

function verificationRecord(
  task: WorkTakeoverTask,
  verification: WorkTakeoverResultVerification,
  correlation: ReturnType<typeof correlationFor>,
): ToolExecutionRecord {
  const verified = verification.passed;
  const receipt = {
    ok: verified,
    status: verified ? 'verified' : verification.status,
    persisted: true,
    workTakeoverTaskId: task.id,
    conversationTaskId: correlation.conversationTaskId,
    verificationId: verification.verificationId,
    verificationStatus: verification.status,
    blockerCount: verification.blockers.length,
  };
  return {
    id: `industry_receipt_${verification.verificationId}`,
    name: 'industry_workflow_verify',
    arguments: { taskId: task.id, entryId: workflowMetadata(task).entryId },
    result: JSON.stringify(receipt),
    receipt,
    ...(verified ? {} : { error: verification.summary }),
    taskId: correlation.conversationTaskId,
    requestId: correlation.requestId,
    idempotencyKey: `industry:${task.id}:${verification.verificationId}`,
    terminalVerification: {
      status: verified ? 'verified' : 'failed',
      strategy: 'artifact',
      reason: verification.summary,
    },
    capability: {
      capabilityId: 'industry.workflow.verify',
      lane: 'industry',
      operation: 'test',
      risk: 'low',
      sideEffects: [{ type: 'local_state_change', scope: 'industry workflow archive and receipt ledger', reversible: true }],
      verification: {
        strategy: 'artifact',
        required: true,
        requiredFields: ['ok', 'status', 'persisted', 'verificationId'],
        requiredValues: { ok: true, persisted: true },
        successStatuses: ['verified'],
        failureStatuses: ['blocked', 'needs_review'],
        successSignals: ['server-side industry workflow verifier passed'],
        limitations: ['This verifies the scoped industry deliverable, not any unrequested external side effect.'],
      },
    },
  };
}

function enforceDesignProjectPrerequisites(
  task: WorkTakeoverTask,
  verification: WorkTakeoverResultVerification,
): WorkTakeoverResultVerification {
  const binding = designProjectBinding(task);
  if (!binding || binding.entryId !== 'handoff') return verification;
  const workflow = getInteriorProjectWorkflow(binding.scopeId, binding.projectId);
  if (!workflow) return verification;
  const missing = getMissingInteriorProjectPrerequisites(workflow, binding.entryId);
  if (!missing.length) {
    return {
      ...verification,
      checks: [
        ...verification.checks,
        {
          id: 'design_project_stage_dependencies',
          label: 'Design project upstream stages',
          passed: true,
          detail: 'Project scheme, CAD, visualization, and proposal stages all have verified receipts.',
        },
      ],
    };
  }
  const blocker = `Project handoff is blocked until verified upstream stages complete: ${missing.join(', ')}.`;
  return {
    ...verification,
    passed: false,
    status: 'blocked',
    summary: blocker,
    blockers: Array.from(new Set([...verification.blockers, blocker])),
    checks: [
      ...verification.checks,
      {
        id: 'design_project_stage_dependencies',
        label: 'Design project upstream stages',
        passed: false,
        detail: blocker,
      },
    ],
  };
}

function settleBoundDesignProjectStage(
  task: WorkTakeoverTask,
  verification: WorkTakeoverResultVerification,
): InteriorProjectWorkflowState | undefined {
  const binding = designProjectBinding(task);
  if (!binding) return undefined;
  const state = settleInteriorProjectWorkflowStage({
    orgId: binding.scopeId,
    projectId: binding.projectId,
    entryId: binding.entryId,
    taskId: task.id,
    conversationTaskId: conversationTaskIdFor(task),
    artifacts: task.artifacts,
    verification,
  });
  if (binding.entryId === 'handoff' && verification.passed && state.rootTaskId) {
    const correlation = correlationFor(task);
    const record = verificationRecord(task, verification, correlation);
    const db = readDB();
    settleBackgroundConversationActionTask(db, {
      taskId: state.rootTaskId,
      userId: task.userId,
      records: [{
        ...record,
        id: `${record.id}_project_root`,
        taskId: state.rootTaskId,
        idempotencyKey: `${record.idempotencyKey}:project-root`,
      }],
      status: 'completed',
      requestId: correlation.requestId,
    });
    writeDB(db);
  }
  return state;
}

export function listCurrentIndustryWorkflowContracts(): IndustryWorkflowContract[] {
  const line = productLine();
  return line ? getIndustryWorkflowContracts(line) : [];
}

export function startIndustryWorkflow(input: StartIndustryWorkflowInput): IndustryWorkflowStartResult {
  const contract = contractForCurrentProduct(input.entryId);
  const sourceInput = compact(input.sourceInput, 12_000);
  const designProject = designProjectForInput(input, contract);
  const resolvedContext = designProject
    ? { ...(input.context || {}), projectId: designProject.id, projectName: designProject.name }
    : (input.context || {});
  const idempotencyKey = compact(input.idempotencyKey, 300);
  if (idempotencyKey) {
    const existing = listIndustryWorkflowTasks(input, 200).find(task => (
      workflowMetadata(task).idempotencyKey === idempotencyKey
      && workflowMetadata(task).entryId === contract.entryId
      && (!designProject || compact(workflowMetadata(task).context?.projectId, 200) === designProject.id)
    ));
    if (existing) {
      const correlation = correlationFor(existing);
      return {
        task: existing,
        conversationId: correlation.conversationId,
        conversationTaskId: correlation.conversationTaskId,
        requestId: correlation.requestId,
        contract,
        handoffPrompt: buildHandoffPrompt(existing, contract),
        reused: true,
        ...(designProject ? {
          project: designProject,
          projectWorkflow: getInteriorProjectWorkflow(designProject.orgId, designProject.id) || undefined,
        } : {}),
      };
    }
  }
  const requestId = compact(input.requestId, 200) || `industry_request_${crypto.randomUUID()}`;
  const requestedConversationId = compact(input.conversationId, 200);
  const conversation = (requestedConversationId
    ? getConversationForScope(requestedConversationId, input.userId, input.domain, input.orgId)
    : null) || getOrCreateActiveConversation(input.userId, 'lumi', input.domain, input.orgId);
  let projectRootTaskId = '';
  if (designProject) {
    const rootDb = readDB();
    projectRootTaskId = ensureDesignProjectRootActionTask({
      db: rootDb,
      project: designProject,
      conversationId: conversation.id,
      userId: input.userId,
      domain: input.domain,
      orgId: input.orgId,
      requestId,
    });
    writeDB(rootDb);
  }
  if (designProject) {
    const existingStageTask = listIndustryWorkflowTasks(input, 200).find(candidate => {
      const metadata = workflowMetadata(candidate);
      return metadata.entryId === contract.entryId
        && compact(metadata.context?.projectId, 200) === designProject.id
        && ['queued', 'in_progress', 'waiting_confirmation', 'blocked'].includes(candidate.status);
    });
    if (existingStageTask) {
      const correlation = correlationFor(existingStageTask);
      const actionDb = readDB();
      const actionTask = (actionDb.conversationActionTasks || []).find((candidate: any) => (
        candidate.id === correlation.conversationTaskId && candidate.userId === input.userId
      ));
      if (actionTask) {
        actionTask.parentTaskId = projectRootTaskId;
        actionTask.status = 'executing';
        actionTask.blocker = '';
        actionTask.completedAt = '';
        actionTask.completionSource = '';
        actionTask.activeRequestId = correlation.requestId || requestId;
        actionTask.updatedAt = new Date().toISOString();
      }
      writeDB(actionDb);
      const projectWorkflow = isInteriorDesignStageId(contract.entryId)
        ? linkInteriorProjectWorkflowStage({
            orgId: designProject.orgId,
            projectId: designProject.id,
            entryId: contract.entryId,
            taskId: existingStageTask.id,
            conversationTaskId: correlation.conversationTaskId,
            rootConversationId: conversation.id,
            rootTaskId: projectRootTaskId,
          })
        : undefined;
      return {
        task: existingStageTask,
        conversationId: correlation.conversationId,
        conversationTaskId: correlation.conversationTaskId,
        requestId: correlation.requestId,
        contract,
        handoffPrompt: buildHandoffPrompt(existingStageTask, contract),
        reused: true,
        project: designProject,
        projectWorkflow,
      };
    }
  }
  const requestedConversationTaskId = compact(input.conversationTaskId, 200);
  const existingConversationTaskId = requestedConversationTaskId && (readDB().conversationActionTasks || []).some((candidate: any) => (
    candidate.id === requestedConversationTaskId
    && candidate.conversationId === conversation.id
    && candidate.userId === input.userId
    && candidate.domain === input.domain
    && String(candidate.orgId || '') === String(input.orgId || '')
  )) ? requestedConversationTaskId : '';
  const task = createWorkTakeoverTask({
    userId: input.userId,
    domain: input.domain,
    orgId: input.orgId,
    title: contract.title,
    category: contract.category,
    source: input.source || 'industry_client',
    status: 'in_progress',
    summary: buildTaskSummary(contract, sourceInput),
    recommendedWorkflow: contract.recommendedWorkflow,
    nextActions: contract.nextActions,
    artifactsToPrepare: contract.requiredArtifactLabels,
    allowedNow: ['Read scoped source records', 'Run safe local analysis', 'Create reviewable local drafts and files', 'Verify and archive local results'],
    confirmationRequired: contract.confirmationBoundaries,
    risks: ['Missing or ambiguous source data must be reported, not guessed', 'Model narration is not completion evidence'],
    metadata: {
      industryWorkflow: {
        schemaVersion: 1,
        productLine: contract.productLine,
        variantId: PRODUCT_VARIANT.variantId,
        entryId: contract.entryId,
        idempotencyKey,
        inputDigest: sha256(sourceInput),
        inputLength: sourceInput.length,
        requestId,
        conversationId: conversation.id,
        context: resolvedContext,
        contract: {
          requiredArtifactLabels: contract.requiredArtifactLabels,
          expectedContentTerms: contract.expectedContentTerms,
          confirmationBoundaries: contract.confirmationBoundaries,
          requiresFileArtifact: contract.requiresFileArtifact,
          acceptedFileExtensions: contract.acceptedFileExtensions,
        },
        createdAt: new Date().toISOString(),
      },
    },
  });
  const conversationTaskId = existingConversationTaskId || `industry_${task.id}`;
  const linkedTask = updateWorkTakeoverTask(input.userId, task.id, {
    metadata: {
      industryWorkflow: {
        ...workflowMetadata(task),
        conversationTaskId,
      },
    },
    note: `Linked to conversation action task ${conversationTaskId}.`,
  }) || task;

  const db = readDB();
  const industryContext = {
    workTakeoverTaskId: task.id,
    productLine: contract.productLine,
    entryId: contract.entryId,
    inputDigest: sha256(sourceInput),
    ...(designProject ? { projectId: designProject.id, projectName: designProject.name } : {}),
  };
  if (existingConversationTaskId) {
    const actionTask = (db.conversationActionTasks || []).find((candidate: any) => candidate.id === existingConversationTaskId);
    const existingContext = parseObject(actionTask?.context);
    actionTask.context = JSON.stringify({ ...existingContext, industryWorkflow: industryContext });
    actionTask.updatedAt = new Date().toISOString();
    if (projectRootTaskId) actionTask.parentTaskId = projectRootTaskId;
  } else {
    const actionTask = ensureBackgroundConversationActionTask(db, {
      taskId: conversationTaskId,
      conversationId: conversation.id,
      userId: input.userId,
      domain: input.domain,
      orgId: input.orgId,
      goal: `Execute and verify ${contract.title} industry workflow`,
      target: `${contract.productLine}:${contract.entryId}`,
      requestId,
      source: 'industry_workflow',
      context: { industryWorkflow: industryContext },
    });
    if (projectRootTaskId) actionTask.parentTaskId = projectRootTaskId;
  }
  writeDB(db);

  const projectWorkflow = designProject && isInteriorDesignStageId(contract.entryId)
    ? linkInteriorProjectWorkflowStage({
        orgId: designProject.orgId,
        projectId: designProject.id,
        entryId: contract.entryId,
        taskId: linkedTask.id,
        conversationTaskId,
        rootConversationId: conversation.id,
        rootTaskId: projectRootTaskId,
      })
    : undefined;

  return {
    task: linkedTask,
    conversationId: conversation.id,
    conversationTaskId,
    requestId,
    contract,
    handoffPrompt: buildHandoffPrompt(linkedTask, contract),
    ...(designProject ? { project: getInteriorProject(designProject.orgId, designProject.id) || designProject } : {}),
    ...(projectWorkflow ? { projectWorkflow } : {}),
  };
}

export function listIndustryWorkflowTasks(scope: IndustryWorkflowScope, limit = 50): WorkTakeoverTask[] {
  return listWorkTakeoverTasks({
    userId: scope.userId,
    domain: scope.domain,
    orgId: scope.orgId,
    limit: Math.max(1, Math.min(Number(limit) || 50, 200)),
  }).filter(task => {
    const metadata = workflowMetadata(task);
    return metadata.productLine === productLine() && Boolean(metadata.entryId);
  });
}

export function getIndustryWorkflowTask(scope: IndustryWorkflowScope, taskId: string): WorkTakeoverTask | null {
  const task = getWorkTakeoverTask(scope.userId, taskId);
  if (!task || !scopeMatches(task, scope)) return null;
  const metadata = workflowMetadata(task);
  return metadata.productLine === productLine() && metadata.entryId ? task : null;
}

export function settleIndustryWorkflowConversationTask(
  task: WorkTakeoverTask,
  verification: WorkTakeoverResultVerification,
): void {
  const correlation = correlationFor(task);
  if (!correlation.conversationTaskId) return;
  const record = verificationRecord(task, verification, correlation);
  const db = readDB();
  settleBackgroundConversationActionTask(db, {
    taskId: correlation.conversationTaskId,
    userId: task.userId,
    records: [record],
    status: verification.passed ? 'completed' : 'blocked',
    blocker: verification.passed ? '' : verification.summary,
    requestId: correlation.requestId,
  });
  writeDB(db);
}

export function recordIndustryWorkflowExecution(input: RecordIndustryWorkflowInput): IndustryWorkflowRecordResult {
  const existing = getIndustryWorkflowTask(input, input.taskId);
  if (!existing) throw new Error('Industry workflow task was not found in the active user scope.');
  const contract = taskContract(existing);
  const resultText = compact(input.resultText, 5000);
  const toolRecords = (input.toolRecords || []).slice(-40);
  const explicitPaths = safeFilePaths(input.filePaths || [], contract);
  const discoveredPaths = recordFilePaths(toolRecords, contract);
  const filePaths = Array.from(new Set([...explicitPaths, ...discoveredPaths]));

  if (!resultText && filePaths.length === 0 && toolRecords.length === 0) {
    throw new Error('No result, file, or tool receipt was supplied for verification.');
  }
  if (contract.requiresFileArtifact && filePaths.length === 0) {
    const blocker = `A real non-empty file is required (${contract.acceptedFileExtensions.join(', ')}); model text alone cannot complete this workflow.`;
    const blocked = updateWorkTakeoverTask(input.userId, existing.id, {
      status: 'blocked',
      blockedBy: Array.from(new Set([...existing.blockedBy, blocker])),
      result: resultText || blocker,
      metadata: {
        workTakeoverToolRuns: toolRunHistory(existing, toolRecords),
        industryWorkflowLastAttempt: { status: 'blocked', reason: blocker, at: new Date().toISOString() },
      },
      note: blocker,
    }) || existing;
    const verification = enforceDesignProjectPrerequisites(blocked, verifyWorkTakeoverResult(blocked, {
      requiredArtifactLabels: contract.requiredArtifactLabels,
      expectedContentTerms: contract.expectedContentTerms,
      minMatchedContentTerms: contract.minMatchedContentTerms,
      minFileBytes: 16,
      requireExternalOutcome: false,
      outcomeEvidence: toolRecords,
      requireOutputEvidence: true,
    }));
    settleBoundDesignProjectStage(blocked, verification);
    settleIndustryWorkflowConversationTask(blocked, verification);
    return { task: blocked, verification, conversationTaskId: conversationTaskIdFor(blocked), archivedFilePaths: [] };
  }

  let updated = updateWorkTakeoverTask(input.userId, existing.id, {
    status: 'in_progress',
    result: resultText || `Verified file candidates: ${filePaths.map(filePath => path.basename(filePath)).join(', ')}`,
    ...(contract.draftRequired && resultText ? { draftReply: resultText } : {}),
    metadata: {
      workTakeoverToolRuns: toolRunHistory(existing, toolRecords),
      industryWorkflowLastAttempt: {
        status: 'verifying',
        source: input.source || 'industry_client',
        resultDigest: sha256(resultText),
        fileDigests: filePaths.map(filePath => ({ path: filePath, digest: sha256(`${filePath}:${fs.statSync(filePath).size}`) })),
        at: new Date().toISOString(),
      },
    },
    artifact: {
      type: filePaths.length ? (contract.entryId === 'cad' ? 'cad' : 'file') : 'document',
      label: contract.requiredArtifactLabels[0],
      path: filePaths[0],
      content: resultText || undefined,
      status: 'prepared',
    },
    note: 'Industry workflow result submitted for server-side verification.',
  }) || existing;

  for (const filePath of filePaths.slice(1)) {
    updated = updateWorkTakeoverTask(input.userId, updated.id, {
      artifact: {
        type: contract.entryId === 'cad' ? 'cad' : 'file',
        label: `${contract.requiredArtifactLabels[0]}: ${path.basename(filePath)}`,
        path: filePath,
        status: 'prepared',
      },
    }) || updated;
  }

  const verification = enforceDesignProjectPrerequisites(updated, verifyWorkTakeoverResult(updated, {
    filePaths,
    draftRequired: contract.draftRequired === true,
    requiredArtifactLabels: contract.requiredArtifactLabels,
    expectedContentTerms: contract.expectedContentTerms,
    minMatchedContentTerms: contract.minMatchedContentTerms,
    minFileBytes: 16,
    requireExternalOutcome: false,
    outcomeEvidence: toolRecords,
    requireOutputEvidence: true,
  }));
  const status: WorkTakeoverStatus = verification.passed
    ? 'delivered'
    : verification.status === 'blocked'
      ? 'blocked'
      : 'waiting_confirmation';
  updated = updateWorkTakeoverTask(input.userId, updated.id, {
    status,
    blockedBy: verification.passed ? [] : Array.from(new Set([...updated.blockedBy, ...verification.blockers])),
    metadata: {
      workTakeoverVerification: verification,
      industryWorkflowLastAttempt: {
        ...(updated.metadata?.industryWorkflowLastAttempt || {}),
        status: verification.status,
        verificationId: verification.verificationId,
      },
    },
    artifact: {
      type: 'checklist',
      label: 'Industry workflow verification receipt',
      content: JSON.stringify({
        verificationId: verification.verificationId,
        status: verification.status,
        checkedAt: verification.checkedAt,
        checks: verification.checks,
      }, null, 2),
      status: verification.passed ? 'delivered' : 'needs_review',
    },
    note: verification.summary,
  }) || updated;
  settleBoundDesignProjectStage(updated, verification);
  settleIndustryWorkflowConversationTask(updated, verification);
  return {
    task: updated,
    verification,
    conversationTaskId: conversationTaskIdFor(updated),
    archivedFilePaths: filePaths,
  };
}
