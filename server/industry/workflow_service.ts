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
  updateInteriorProject,
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

function isVerifiedIndustryCompletionRecord(record: ToolExecutionRecord, expectedTaskId = ''): boolean {
  if (record.name !== 'industry_workflow_complete' || record.error) return false;
  if (record.terminalVerification?.status !== 'verified') return false;
  const payload = parseObject(record.result);
  const verification = parseObject(payload.verification);
  const payloadTask = parseObject(payload.task);
  const receiptTaskId = compact(payloadTask.id || record.arguments?.taskId, 200);
  return payload.ok === true
    && payload.persisted === true
    && String(payload.status || '').toLowerCase() === 'verified'
    && verification.passed === true
    && (!expectedTaskId || receiptTaskId === expectedTaskId);
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function validateIndustryWorkflowSourceInput(task: WorkTakeoverTask, value: unknown): string {
  const sourceInput = compact(value, 12_000);
  if (!sourceInput) return '';
  const expectedDigest = compact(workflowMetadata(task).inputDigest, 128);
  if (!expectedDigest || sha256(sourceInput) !== expectedDigest) {
    throw new Error('Industry workflow source input does not match the source bound when the task was created.');
  }
  return sourceInput;
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

export interface IndustryWorkflowPrerequisiteStatus {
  projectId: string;
  projectName: string;
  entryId: InteriorDesignStageId;
  missing: InteriorDesignStageId[];
  blocker: string;
}

export function getIndustryWorkflowPrerequisiteStatus(
  task: WorkTakeoverTask,
): IndustryWorkflowPrerequisiteStatus | null {
  const binding = designProjectBinding(task);
  if (!binding || binding.entryId === 'project') return null;
  const workflow = getInteriorProjectWorkflow(binding.scopeId, binding.projectId);
  if (!workflow) return null;
  const missing = getMissingInteriorProjectPrerequisites(workflow, binding.entryId);
  if (!missing.length) return null;
  const blocker = `Design stage ${binding.entryId} is blocked until verified upstream stages complete: ${missing.join(', ')}.`;
  return { ...binding, missing, blocker };
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
    contract.executionTools?.length
      ? `Preferred domain tools for this exact workspace: ${contract.executionTools.join(', ')}. Prefer them over generic document creation.`
      : '',
    contract.requiredToolReceipts?.length
      ? `Completion requires verified current-loop receipts from every one of these tools: ${contract.requiredToolReceipts.join(', ')}.`
      : '',
    'Preserve user-provided dimensions, paths, quantities, constraints, and unknown fields exactly. Do not translate, reformat, infer, or replace missing values with zero.',
    'Never call a file-reading tool without an exact bound source-asset path. If no path is bound, use the structured source facts or report the missing asset once; do not guess paths or repeat failed reads.',
    `Required local artifact labels: ${contract.requiredArtifactLabels.join(', ')}.`,
    `Required evidence terms: ${contract.expectedContentTerms.join(', ')}.`,
    `Confirmation boundaries: ${contract.confirmationBoundaries.join(' ')}`,
    projectContext,
    contract.requiresFileArtifact
      ? `A real non-empty file is mandatory. Accepted extensions: ${contract.acceptedFileExtensions.join(', ')}. Model text alone is not completion.`
      : 'A persisted, reviewable result is mandatory. Model narration that is not archived and verified is not completion.',
    `Before claiming completion, call industry_workflow_complete with taskId=${task.id}; the server will bind current-loop receipts, persist the result, and run the canonical verifier.`,
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

function recordCanProduceFileArtifact(record: ToolExecutionRecord): boolean {
  if (record.error || record.terminalVerification?.status !== 'verified') return false;
  if (record.capability?.sideEffects?.some(effect => effect.type === 'local_write')) return true;
  return /^(?:write_file|create_|generate_|export_|save_|document_|cad_generate_dxf|design_delivery_package_create|legal_(?:generate|draft|finalize|review_contract|analyze_folder))/i
    .test(String(record.name || ''));
}

function recordFilePaths(records: ToolExecutionRecord[], contract: IndustryWorkflowContract): string[] {
  const candidates: string[] = [];
  records
    .filter(recordCanProduceFileArtifact)
    .forEach(record => collectPathCandidates(parseRecordPayload(record), candidates));
  return safeFilePaths(candidates, contract);
}

function toolRunHistory(task: WorkTakeoverTask, records: ToolExecutionRecord[]): any[] {
  const current = Array.isArray(task.metadata?.workTakeoverToolRuns) ? task.metadata.workTakeoverToolRuns : [];
  const appended = records.slice(-30).map(record => ({
    id: compact(record.id || `industry_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, 200),
    toolName: compact(record.name, 200),
    status: record.error || !String(record.result || '').trim() ? 'failed' : 'completed',
    error: compact(record.error, 1000),
    argumentsDigest: sha256(JSON.stringify(record.arguments || {})),
    result: compact(record.result, 3000),
    resultDigest: sha256(record.result),
    taskId: record.taskId || '',
    requestId: record.requestId || '',
    recordedAt: new Date().toISOString(),
  }));
  return [...current.slice(-60), ...appended].slice(-60);
}

function verifiedToolNames(records: ToolExecutionRecord[]): Set<string> {
  return new Set(records
    .filter(record => (
      !record.error
      && record.terminalVerification?.status === 'verified'
      && String(record.result || '').trim().length > 0
    ))
    .map(record => record.name));
}

function persistedCompletedToolNames(task: WorkTakeoverTask): Set<string> {
  const history = Array.isArray(task.metadata?.workTakeoverToolRuns)
    ? task.metadata.workTakeoverToolRuns
    : [];
  return new Set(history
    .filter((record: any) => record?.status === 'completed' && String(record?.result || '').trim())
    .map((record: any) => String(record.toolName || '')));
}

function missingFileArtifactBlocker(
  contract: IndustryWorkflowContract,
  records: ToolExecutionRecord[],
): string {
  const failedRequiredCreation = [...records].reverse().find(record => (
    Boolean(record.error)
    && (contract.requiredToolReceipts || []).includes(record.name)
    && record.name !== 'mcp_design-studio-pack_drawing_ingest_qa'
  ));
  if (
    contract.entryId === 'cad'
    && failedRequiredCreation?.error
    && /requires user confirmation|local write actions require confirmation/i.test(failedRequiredCreation.error)
  ) {
    return 'CAD file generation did not run because this continuation did not inherit the bound local-file authorization; no file was created.';
  }
  if (failedRequiredCreation) {
    const labels: Record<string, string> = {
      visualization: 'Image generation',
      presentation: 'Presentation generation',
      handoff: 'Delivery package creation',
      cad: 'CAD file generation',
    };
    const detail = compact(failedRequiredCreation.error, 500)
      .replace(/Tool\s+["'][^"']+["']\s*/gi, '')
      .replace(/\b(?:generate_image|create_ppt|design_delivery_package_create|cad_generate_dxf)\b/gi, 'the required creation service');
    return `${labels[contract.entryId] || 'Required file generation'} failed before a reviewable file was produced: ${detail}`;
  }
  if (contract.entryId !== 'cad') {
    return `A real non-empty file is required (${contract.acceptedFileExtensions.join(', ')}); model text alone cannot complete this workflow.`;
  }

  const assessment = records.find(record => (
    record.name === 'mcp_design-studio-pack_drawing_ingest_qa'
    && !record.error
    && record.terminalVerification?.status === 'verified'
  ));
  const generation = records.find(record => record.name === 'cad_generate_dxf');
  if (generation?.error) {
    if (/requires user confirmation|local write actions require confirmation/i.test(generation.error)) {
      return 'CAD file generation did not run because this continuation did not inherit the bound local-file authorization; no file was created.';
    }
    return `CAD file generation failed before a reviewable drawing was produced: ${compact(generation.error, 400)}`;
  }

  const assessmentStatus = String(parseObject(assessment ? parseRecordPayload(assessment) : null).status || '').toLowerCase();
  if (assessment && assessmentStatus === 'ready_for_geometry_extraction') {
    return 'CAD source QA passed, but no verified CAD file-generation receipt or non-empty drawing file was produced.';
  }
  if (assessment) {
    return 'CAD generation is blocked because the supplied source does not contain enough verified geometry to produce a reviewable drawing; no placeholder drawing was created.';
  }
  return `A real non-empty CAD file is required (${contract.acceptedFileExtensions.join(', ')}); model text alone cannot complete this workflow.`;
}

function missingRequiredToolReceipts(
  task: WorkTakeoverTask,
  contract: IndustryWorkflowContract,
  records: ToolExecutionRecord[],
  includePersisted = false,
): string[] {
  const names = verifiedToolNames(records);
  if (includePersisted) {
    for (const name of persistedCompletedToolNames(task)) names.add(name);
  }
  return (contract.requiredToolReceipts || []).filter(name => !names.has(name));
}

function enforceRequiredToolReceipts(
  task: WorkTakeoverTask,
  contract: IndustryWorkflowContract,
  records: ToolExecutionRecord[],
  verification: WorkTakeoverResultVerification,
): WorkTakeoverResultVerification {
  const missing = missingRequiredToolReceipts(task, contract, records);
  if (!missing.length) {
    if (!(contract.requiredToolReceipts || []).length) return verification;
    return {
      ...verification,
      checks: [...verification.checks, {
        id: 'required_industry_tool_receipts',
        label: 'Required industry capability receipts',
        passed: true,
        detail: `Verified: ${(contract.requiredToolReceipts || []).join(', ')}.`,
      }],
    };
  }
  const receiptBlocker = `Missing verified required capability receipts: ${missing.join(', ')}.`;
  const blocker = verification.status === 'blocked' && verification.summary
    ? verification.summary
    : receiptBlocker;
  return {
    ...verification,
    passed: false,
    status: verification.status === 'blocked' ? 'blocked' : 'needs_review',
    summary: blocker,
    blockers: Array.from(new Set([...verification.blockers, blocker, receiptBlocker])),
    checks: [...verification.checks, {
      id: 'required_industry_tool_receipts',
      label: 'Required industry capability receipts',
      passed: false,
      detail: receiptBlocker,
    }],
  };
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
  if (!binding || binding.entryId === 'project') return verification;
  const prerequisite = getIndustryWorkflowPrerequisiteStatus(task);
  if (!prerequisite) {
    return {
      ...verification,
      checks: [
        ...verification.checks,
        {
          id: 'design_project_stage_dependencies',
          label: 'Design project upstream stages',
          passed: true,
          detail: `All prerequisites for design stage ${binding.entryId} have verified receipts.`,
        },
      ],
    };
  }
  const blocker = prerequisite.blocker;
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
  toolRecords: ToolExecutionRecord[] = [],
): InteriorProjectWorkflowState | undefined {
  const binding = designProjectBinding(task);
  if (!binding) return undefined;
  if (binding.entryId === 'project' && verification.passed) {
    syncDesignProjectBriefFromReceipts(binding.scopeId, binding.projectId, toolRecords);
  }
  const state = settleInteriorProjectWorkflowStage({
    orgId: binding.scopeId,
    projectId: binding.projectId,
    entryId: binding.entryId,
    taskId: task.id,
    conversationTaskId: conversationTaskIdFor(task),
    artifacts: task.artifacts,
    verification,
  });
  if (state.rootTaskId) {
    const correlation = correlationFor(task);
    const record = verificationRecord(task, verification, correlation);
    const db = readDB();
    const projectCompleted = binding.entryId === 'handoff' && verification.passed;
    const blocker = verification.passed
      ? `Stage ${binding.entryId} is verified. Awaiting an explicit request for the next design stage.`
      : verification.summary;
    settleBackgroundConversationActionTask(db, {
      taskId: state.rootTaskId,
      userId: task.userId,
      records: [{
        ...record,
        id: `${record.id}_project_root`,
        taskId: state.rootTaskId,
        idempotencyKey: `${record.idempotencyKey}:project-root`,
      }],
      status: projectCompleted ? 'completed' : 'blocked',
      blocker: projectCompleted ? undefined : blocker,
      requestId: correlation.requestId,
    });
    writeDB(db);
  }
  return state;
}

function parseStructuredReceipt(record: ToolExecutionRecord): Record<string, any> | null {
  let value: unknown = String(record.result || '').trim();
  for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function receiptText(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).join('；');
  return String(value || '').trim();
}

function mergeBriefText(current: string, incoming: string): string {
  const existing = String(current || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return existing;
  if (!existing || existing === next) return next;
  if (existing.includes(next)) return existing;
  if (next.includes(existing)) return next;
  return `${existing}\n${next}`;
}

function syncDesignProjectBriefFromReceipts(
  scopeId: string,
  projectId: string,
  records: ToolExecutionRecord[],
): void {
  const project = getInteriorProject(scopeId, projectId);
  if (!project) return;
  const briefRecord = records.find(record => (
    record.name === 'mcp_design-studio-pack_interior_project_brief'
    && !record.error
    && record.terminalVerification?.status === 'verified'
  ));
  if (!briefRecord) return;
  const receipt = parseStructuredReceipt(briefRecord);
  if (!receipt) return;
  const priorities = receiptText(receipt.priorities);
  const requiredSpaces = receiptText(receipt.requiredSpaces);
  const decisions = receiptText(receipt.decisions);
  updateInteriorProject(scopeId, projectId, {
    brief: {
      area: receiptText(receipt.grossArea) || project.brief.area,
      occupants: receiptText(receipt.occupants) || project.brief.occupants,
      budget: receiptText(receipt.budget) || project.brief.budget,
      style: mergeBriefText(project.brief.style, priorities),
      requirements: mergeBriefText(project.brief.requirements, [requiredSpaces, decisions].filter(Boolean).join('\n')),
      constraints: mergeBriefText(project.brief.constraints, receiptText(receipt.existingConstraints)),
    },
  });
}

export function reconcileVerifiedDesignProjectBrief(
  scopeId: string,
  projectId: string,
  userId: string,
): InteriorProject | null {
  const project = getInteriorProject(scopeId, projectId);
  const workflow = getInteriorProjectWorkflow(scopeId, projectId);
  const taskId = workflow?.stages.project.currentTaskId || '';
  if (!project || !taskId || workflow?.stages.project.status !== 'completed') return project;
  const task = getWorkTakeoverTask(userId, taskId);
  if (!task || task.metadata?.workTakeoverVerification?.passed !== true) return project;
  const records: ToolExecutionRecord[] = (Array.isArray(task.metadata?.workTakeoverToolRuns)
    ? task.metadata.workTakeoverToolRuns
    : [])
    .filter((run: any) => run?.status === 'completed' && run?.toolName && run?.result)
    .map((run: any) => ({
      id: String(run.id || ''),
      name: String(run.toolName),
      arguments: {},
      result: String(run.result),
      terminalVerification: {
        status: 'verified' as const,
        strategy: 'terminal_receipt' as const,
        reason: 'Recovered from a previously verified industry workflow receipt.',
      },
    }));
  syncDesignProjectBriefFromReceipts(scopeId, projectId, records);
  return getInteriorProject(scopeId, projectId);
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
  const requestedConversationTaskId = compact(input.conversationTaskId, 200);
  const existingConversationTaskId = requestedConversationTaskId && (readDB().conversationActionTasks || []).some((candidate: any) => (
    candidate.id === requestedConversationTaskId
    && candidate.conversationId === conversation.id
    && candidate.userId === input.userId
    && candidate.domain === input.domain
    && String(candidate.orgId || '') === String(input.orgId || '')
  )) ? requestedConversationTaskId : '';
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
      const previousCorrelation = correlationFor(existingStageTask);
      const conversationTaskId = existingConversationTaskId || previousCorrelation.conversationTaskId;
      const reboundStageTask = conversationTaskId && (
        conversationTaskId !== previousCorrelation.conversationTaskId
        || conversation.id !== previousCorrelation.conversationId
        || requestId !== previousCorrelation.requestId
      )
        ? updateWorkTakeoverTask(input.userId, existingStageTask.id, {
            metadata: {
              industryWorkflow: {
                ...workflowMetadata(existingStageTask),
                conversationId: conversation.id,
                conversationTaskId,
                requestId,
              },
            },
            note: `Rebound active industry workflow to conversation action task ${conversationTaskId}.`,
          }) || existingStageTask
        : existingStageTask;
      const correlation = correlationFor(reboundStageTask);
      const actionDb = readDB();
      const actionTask = (actionDb.conversationActionTasks || []).find((candidate: any) => (
        candidate.id === correlation.conversationTaskId && candidate.userId === input.userId
      ));
      if (actionTask) {
        const existingContext = parseObject(actionTask.context);
        actionTask.context = JSON.stringify({
          ...existingContext,
          industryWorkflow: {
            workTakeoverTaskId: reboundStageTask.id,
            productLine: contract.productLine,
            entryId: contract.entryId,
            inputDigest: sha256(sourceInput),
            ...(designProject ? { projectId: designProject.id, projectName: designProject.name } : {}),
          },
        });
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
            taskId: reboundStageTask.id,
            conversationTaskId: correlation.conversationTaskId,
            rootConversationId: conversation.id,
            rootTaskId: projectRootTaskId,
          })
        : undefined;
      return {
        task: reboundStageTask,
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
          executionTools: contract.executionTools || [],
          requiredToolReceipts: contract.requiredToolReceipts || [],
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

export function reconcileInterruptedIndustryWorkflowTasks(): number {
  const line = productLine();
  if (!line) return 0;
  const db = readDB();
  let reconciled = 0;
  for (const actionTask of db.conversationActionTasks || []) {
    if (!['blocked', 'cancelled', 'completed'].includes(String(actionTask.status || ''))) continue;
    const context = parseObject(actionTask.context);
    const industry = parseObject(context.industryWorkflow);
    if (industry.productLine !== line) continue;
    const workTakeoverTaskId = compact(industry.workTakeoverTaskId, 200);
    if (!workTakeoverTaskId) continue;
    const task = getWorkTakeoverTask(String(actionTask.userId || ''), workTakeoverTaskId);
    if (!task || !['queued', 'in_progress'].includes(task.status)) continue;
    const metadata = workflowMetadata(task);
    if (metadata.productLine !== line) continue;
    const verificationPassed = task.metadata?.workTakeoverVerification?.passed === true;
    const nextStatus: WorkTakeoverStatus = actionTask.status === 'cancelled'
      ? 'cancelled'
      : actionTask.status === 'completed' && verificationPassed
        ? 'delivered'
        : 'blocked';
    const blocker = nextStatus === 'blocked'
      ? compact(actionTask.blocker, 1000) || 'The previous runtime ended before this industry workflow reached a verified terminal receipt.'
      : '';
    updateWorkTakeoverTask(task.userId, task.id, {
      status: nextStatus,
      blockedBy: blocker ? Array.from(new Set([...task.blockedBy, blocker])) : [],
      metadata: {
        industryWorkflowLastAttempt: {
          ...(task.metadata?.industryWorkflowLastAttempt || {}),
          status: nextStatus === 'delivered' ? 'passed' : nextStatus,
          reason: blocker,
          reconciledFromConversationTaskId: String(actionTask.id || ''),
          at: new Date().toISOString(),
        },
      },
      note: nextStatus === 'delivered'
        ? 'Industry workflow reconciled from a verified completed conversation task.'
        : 'Interrupted industry workflow reconciled from its persistent conversation task; no work was replayed.',
    });
    reconciled += 1;
  }
  return reconciled;
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

  const previousVerification = existing.metadata?.workTakeoverVerification as WorkTakeoverResultVerification | undefined;
  if (
    existing.status === 'delivered'
    && previousVerification?.passed === true
    && toolRecords.some(record => isVerifiedIndustryCompletionRecord(record, existing.id))
    && missingRequiredToolReceipts(existing, contract, toolRecords, true).length === 0
  ) {
    const updated = resultText
      ? updateWorkTakeoverTask(input.userId, existing.id, {
          result: resultText,
          metadata: {
            industryWorkflowLastAttempt: {
              status: 'passed',
              source: input.source || 'industry_client',
              verificationId: previousVerification.verificationId,
              resultDigest: sha256(resultText),
              reusedVerifiedReceipt: true,
              at: new Date().toISOString(),
            },
          },
        }) || existing
      : existing;
    return {
      task: updated,
      verification: previousVerification,
      conversationTaskId: conversationTaskIdFor(updated),
      archivedFilePaths: safeFilePaths(updated.artifacts.map(artifact => artifact.path || ''), contract),
    };
  }
  if (contract.requiresFileArtifact && filePaths.length === 0) {
    const blocker = missingFileArtifactBlocker(contract, toolRecords);
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
    const baseVerification = verifyWorkTakeoverResult(blocked, {
      requiredArtifactLabels: contract.requiredArtifactLabels,
      expectedContentTerms: contract.expectedContentTerms,
      minMatchedContentTerms: contract.minMatchedContentTerms,
      minFileBytes: 16,
      requireExternalOutcome: false,
      outcomeEvidence: toolRecords,
      requireOutputEvidence: true,
    });
    const blockedVerification: WorkTakeoverResultVerification = {
      ...baseVerification,
      passed: false,
      status: 'blocked',
      summary: blocker,
      blockers: Array.from(new Set([...baseVerification.blockers, blocker])),
    };
    const verification = enforceDesignProjectPrerequisites(blocked, enforceRequiredToolReceipts(
      blocked,
      contract,
      toolRecords,
      blockedVerification,
    ));
    settleBoundDesignProjectStage(blocked, verification, toolRecords);
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

  const verification = enforceDesignProjectPrerequisites(updated, enforceRequiredToolReceipts(
    updated,
    contract,
    toolRecords,
    verifyWorkTakeoverResult(updated, {
      filePaths,
      draftRequired: contract.draftRequired === true,
      requiredArtifactLabels: contract.requiredArtifactLabels,
      expectedContentTerms: contract.expectedContentTerms,
      minMatchedContentTerms: contract.minMatchedContentTerms,
      minFileBytes: 16,
      requireExternalOutcome: false,
      outcomeEvidence: toolRecords,
      requireOutputEvidence: true,
    }),
  ));
  const status: WorkTakeoverStatus = verification.passed
    ? 'delivered'
    : verification.status === 'blocked'
      ? 'blocked'
      : 'in_progress';
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
  settleBoundDesignProjectStage(updated, verification, toolRecords);
  settleIndustryWorkflowConversationTask(updated, verification);
  return {
    task: updated,
    verification,
    conversationTaskId: conversationTaskIdFor(updated),
    archivedFilePaths: filePaths,
  };
}
