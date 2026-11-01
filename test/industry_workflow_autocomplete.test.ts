import './helpers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createInteriorProject, personalInteriorProjectScope, setActiveInteriorProject } from '../server/design/projects';
import { getInteriorProjectWorkflow } from '../server/design/project_workflow';
import {
  completeIndustryWorkflowFromVerifiedReceipts,
  isVerifiedIndustryWorkflowCompletionRecord,
} from '../server/industry/workflow_autocomplete';
import { startIndustryWorkflow } from '../server/industry/workflow_service';
import { registerIndustryWorkflowTools } from '../server/tools/definitions/industry_workflow_tools';
import { ToolRegistry } from '../server/tools/registry';
import type { ToolExecutionRecord } from '../server/tools/types';

beforeAll(async () => {
  const { initDatabase } = await import('../db_layer');
  await initDatabase();
});

function verifiedRecord(name: string, result: string, binding?: {
  task: { id: string };
  conversationTaskId: string;
  requestId: string;
}): ToolExecutionRecord {
  return {
    id: binding ? `${name}-${binding.requestId}` : undefined,
    taskId: binding?.conversationTaskId,
    requestId: binding?.requestId,
    name,
    arguments: {},
    result,
    terminalVerification: {
      status: 'verified',
      strategy: 'terminal_receipt',
      reason: 'verified test receipt',
    },
  };
}

function setupProjectWorkflow() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = `industry_autocomplete_${suffix}`;
  const scopeId = personalInteriorProjectScope(userId);
  const project = createInteriorProject(scopeId, userId, { name: `Auto complete ${suffix}` });
  setActiveInteriorProject(scopeId, userId, project.id);
  const started = startIndustryWorkflow({
    userId,
    domain: 'personal',
    orgId: '',
    entryId: 'project',
    source: 'chat',
    requestId: `request_${suffix}`,
  });
  const registry = new ToolRegistry();
  registerIndustryWorkflowTools(registry);
  return { suffix, userId, scopeId, project, started, registry };
}

const PROJECT_RESULT = [
  'concept layout risk implementation brief reviewed and archived.',
  'The project scope, fixed conditions, evidence gaps, design direction, room relationships,',
  'professional review boundaries, and next implementation actions are recorded.',
].join(' ');

describe('industry workflow server autocomplete', () => {
  it('archives after every required current-loop receipt succeeds, even after an earlier retry failure', async () => {
    const setup = setupProjectWorkflow();
    const records: ToolExecutionRecord[] = [
      verifiedRecord('industry_workflow_start', JSON.stringify({
        ok: true,
        status: 'created',
        persisted: true,
        task: { id: setup.started.task.id },
      })),
      {
        name: 'mcp_design-studio-pack_interior_project_brief',
        arguments: {},
        result: '',
        error: 'Transient invalid arguments',
        terminalVerification: { status: 'failed', strategy: 'terminal_receipt', reason: 'failed test attempt' },
      },
      verifiedRecord('mcp_design-studio-pack_interior_project_brief', PROJECT_RESULT, setup.started),
      verifiedRecord('mcp_design-studio-pack_space_planning_checklist', PROJECT_RESULT, setup.started),
    ];

    const completed = await completeIndustryWorkflowFromVerifiedReceipts({
      registry: setup.registry,
      records,
      context: {
        userId: setup.userId,
        domain: 'personal',
        taskId: setup.started.conversationTaskId,
        requestId: setup.started.requestId,
        industryWorkflowEntryId: 'project',
        industryWorkflowProductLine: 'design',
      },
    });

    expect(isVerifiedIndustryWorkflowCompletionRecord(completed || undefined)).toBe(true);
    expect(JSON.parse(completed!.result)).toMatchObject({
      ok: true,
      status: 'verified',
      persisted: true,
      task: { id: setup.started.task.id, status: 'delivered', metadata: { industryWorkflow: {entryId: 'project'} } },
      verification: { passed: true },
    });
    expect(getInteriorProjectWorkflow(setup.scopeId, setup.project.id)?.stages.project.status).toBe('completed');
  });

  it('leaves the workflow open when any contract-required receipt is missing', async () => {
    const setup = setupProjectWorkflow();
    const completed = await completeIndustryWorkflowFromVerifiedReceipts({
      registry: setup.registry,
      records: [verifiedRecord('mcp_design-studio-pack_interior_project_brief', PROJECT_RESULT, setup.started)],
      context: {
        userId: setup.userId,
        domain: 'personal',
        taskId: setup.started.conversationTaskId,
        requestId: setup.started.requestId,
        industryWorkflowTaskId: setup.started.task.id,
        industryWorkflowEntryId: 'project',
        industryWorkflowProductLine: 'design',
      },
    });

    expect(completed).toBeNull();
    expect(getInteriorProjectWorkflow(setup.scopeId, setup.project.id)?.stages.project.status).toBe('in_progress');
  });

  it('settles the durable ledger after every required capability was attempted and one failed', async () => {
    const setup = setupProjectWorkflow();
    const failed: ToolExecutionRecord = {
      id: `mcp_design-studio-pack_space_planning_checklist-${setup.started.requestId}`,
      taskId: setup.started.conversationTaskId,
      requestId: setup.started.requestId,
      name: 'mcp_design-studio-pack_space_planning_checklist',
      arguments: {},
      result: '',
      error: 'Provider rejected the request.',
      terminalVerification: { status: 'failed', strategy: 'terminal_receipt', reason: 'provider failure' },
    };
    const settled = await completeIndustryWorkflowFromVerifiedReceipts({
      registry: setup.registry,
      records: [
        verifiedRecord('mcp_design-studio-pack_interior_project_brief', PROJECT_RESULT, setup.started),
        failed,
      ],
      context: {
        userId: setup.userId,
        domain: 'personal',
        taskId: setup.started.conversationTaskId,
        requestId: setup.started.requestId,
        industryWorkflowTaskId: setup.started.task.id,
        industryWorkflowEntryId: 'project',
        industryWorkflowProductLine: 'design',
      },
    });

    expect(settled).not.toBeNull();
    expect(isVerifiedIndustryWorkflowCompletionRecord(settled || undefined)).toBe(false);
    expect(settled?.terminalVerification?.status).toBe('failed');
    expect(getInteriorProjectWorkflow(setup.scopeId, setup.project.id)?.stages.project.status)
      .not.toBe('in_progress');
  });

  it('does not repeat a failed completion attempt unless newer required evidence arrives', async () => {
    const setup = setupProjectWorkflow();
    const required = [
      verifiedRecord('mcp_design-studio-pack_interior_project_brief', PROJECT_RESULT, setup.started),
      verifiedRecord('mcp_design-studio-pack_space_planning_checklist', PROJECT_RESULT, setup.started),
    ];
    const priorFailedCompletion: ToolExecutionRecord = {
      taskId: setup.started.conversationTaskId,
      requestId: setup.started.requestId,
      name: 'industry_workflow_complete',
      arguments: { taskId: setup.started.task.id },
      result: '',
      error: 'Canonical verifier rejected the current evidence.',
      terminalVerification: { status: 'failed', strategy: 'terminal_receipt', reason: 'failed verifier' },
    };

    const completed = await completeIndustryWorkflowFromVerifiedReceipts({
      registry: setup.registry,
      records: [...required, priorFailedCompletion],
      context: {
        userId: setup.userId,
        domain: 'personal',
        taskId: setup.started.conversationTaskId,
        requestId: setup.started.requestId,
        industryWorkflowTaskId: setup.started.task.id,
        industryWorkflowEntryId: 'project',
        industryWorkflowProductLine: 'design',
      },
    });

    expect(completed).toBeNull();
  });
});
