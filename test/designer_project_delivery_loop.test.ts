import './helpers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { flushDBOrThrow, readDB } from '../db_layer';
import {
  createInteriorProject,
  getActiveInteriorProject,
  personalInteriorProjectScope,
  setActiveInteriorProject,
} from '../server/design/projects';
import { getInteriorProjectWorkflow } from '../server/design/project_workflow';
import {
  recordIndustryWorkflowExecution,
  startIndustryWorkflow,
} from '../server/industry/workflow_service';
import { ToolRegistry } from '../server/tools/registry';
import { registerIndustryWorkflowTools } from '../server/tools/definitions/industry_workflow_tools';
import { registerAllTools } from '../server/tools/definitions';
import { buildLumiExecutionPipeline } from '../server/cognition/execution_pipeline';
import {
  formatIndustryCapabilityProfilePrompt,
  formatIndustryWorkflowRoutingPrompt,
  isDesignProjectCreationRequest,
} from '../server/regions/packs/cn/industry_capability_profile';

beforeAll(async () => {
  const { initDatabase } = await import('../db_layer');
  await initDatabase();
});

function stageResult(entryId: string): string {
  const results: Record<string, string> = {
    project: 'concept layout risk implementation brief reviewed and archived. The project scope, fixed conditions, evidence gaps, design direction, room relationships, professional review boundaries, and next implementation actions are recorded for accountable review before later drawing work.',
    cad: 'CAD geometry dimension layer verification reviewed and archived. The source basis, fixed dimensions, coordinate relationships, drawing layers, openings, unresolved structure and MEP conflicts, output path, and geometry verification record are documented for professional review.',
    visualization: 'camera lighting material render image reviewed and archived. The selected space, camera composition, daylight and artificial lighting, material references, creative assumptions, image outputs, and review notes are recorded against the bound project.',
    presentation: 'proposal storyline layout material implementation PPT reviewed and archived. The audience, decision goal, verified project facts, concept sequence, spatial scheme, visual assets, material direction, implementation notes, and presentation file review are documented.',
    handoff: 'drawing schedule version checklist handoff reviewed and archived. The drawing register, file versions, CAD and visual outputs, proposal, material schedules, unresolved items, recipient scope, opening checks, professional approvals, and delivery manifest are documented.',
  };
  return results[entryId];
}

function stageFile(directory: string, entryId: string): string[] {
  const extensions: Record<string, string> = {
    cad: '.dxf',
    visualization: '.png',
    presentation: '.pptx',
    handoff: '.zip',
  };
  const extension = extensions[entryId];
  if (!extension) return [];
  const filePath = path.join(directory, `${entryId}${extension}`);
  if (extension === '.dxf') fs.writeFileSync(filePath, stageResult(entryId), 'utf8');
  else fs.writeFileSync(filePath, Buffer.alloc(256, 9));
  return [filePath];
}

describe('designer project delivery loop', () => {
  it('persists an active project binding per user for voice and chat inheritance', () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const owner = `design_active_owner_${suffix}`;
    const other = `design_active_other_${suffix}`;
    const scopeId = personalInteriorProjectScope(owner);
    const project = createInteriorProject(scopeId, owner, { name: 'Persistent voice project' });

    expect(getActiveInteriorProject(scopeId, owner)).toBeNull();
    setActiveInteriorProject(scopeId, owner, project.id);
    expect(getActiveInteriorProject(scopeId, owner)?.id).toBe(project.id);
    expect(getActiveInteriorProject(scopeId, other)).toBeNull();
  });

  it('links all five stages to one project root and completes only from verified receipts', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userId = `design_loop_${suffix}`;
    const scopeId = personalInteriorProjectScope(userId);
    const project = createInteriorProject(scopeId, userId, {
      name: 'Apartment full delivery',
      projectType: 'residential',
      brief: { area: '120 m2', requirements: 'Three bedrooms and shared family space' },
    });
    setActiveInteriorProject(scopeId, userId, project.id);
    const scope = { userId, domain: 'personal' as const, orgId: '' };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-design-loop-'));

    try {
      const projectStage = startIndustryWorkflow({ ...scope, entryId: 'project', source: 'voice' });
      expect(projectStage.project?.id).toBe(project.id);
      expect(projectStage.handoffPrompt).toContain(project.id);
      expect(projectStage.projectWorkflow?.rootTaskId).toBe(`design_project_${project.id}`);

      const duplicate = startIndustryWorkflow({ ...scope, entryId: 'project', source: 'chat' });
      expect(duplicate.reused).toBe(true);
      expect(duplicate.task.id).toBe(projectStage.task.id);

      const earlyHandoff = startIndustryWorkflow({ ...scope, entryId: 'handoff', source: 'voice' });
      const blockedHandoff = recordIndustryWorkflowExecution({
        ...scope,
        taskId: earlyHandoff.task.id,
        resultText: stageResult('handoff'),
        filePaths: stageFile(directory, 'handoff'),
      });
      expect(blockedHandoff.verification.passed).toBe(false);
      expect(blockedHandoff.verification.summary).toMatch(/upstream stages/i);

      const projectResult = recordIndustryWorkflowExecution({
        ...scope,
        taskId: projectStage.task.id,
        resultText: stageResult('project'),
      });
      expect(projectResult.verification.passed).toBe(true);

      for (const entryId of ['cad', 'visualization', 'presentation'] as const) {
        const started = startIndustryWorkflow({ ...scope, entryId, source: 'voice' });
        expect(started.handoffPrompt).toContain(projectStage.task.id);
        const recorded = recordIndustryWorkflowExecution({
          ...scope,
          taskId: started.task.id,
          resultText: stageResult(entryId),
          filePaths: stageFile(directory, entryId),
        });
        expect(recorded.verification.passed, `${entryId}: ${recorded.verification.summary}; ${JSON.stringify(recorded.verification.checks)}`).toBe(true);
      }

      const resumedHandoff = startIndustryWorkflow({ ...scope, entryId: 'handoff', source: 'chat' });
      expect(resumedHandoff.task.id).toBe(earlyHandoff.task.id);
      const delivered = recordIndustryWorkflowExecution({
        ...scope,
        taskId: resumedHandoff.task.id,
        resultText: stageResult('handoff'),
        filePaths: stageFile(directory, 'handoff'),
      });
      expect(delivered.verification.passed).toBe(true);

      await flushDBOrThrow();
      const workflow = getInteriorProjectWorkflow(scopeId, project.id)!;
      expect(Object.values(workflow.stages).every(stage => stage.status === 'completed')).toBe(true);
      expect(workflow.stages.cad.sourceTaskIds).toContain(projectStage.task.id);
      expect(workflow.stages.handoff.sourceTaskIds).toHaveLength(4);
      expect(workflow.stages.handoff.artifacts.some(artifact => artifact.fileName === 'handoff.zip')).toBe(true);
      expect(workflow.stages.handoff.receiptIds).toContain(`industry_receipt_${delivered.verification.verificationId}`);

      const db = readDB();
      const rootTask = db.conversationActionTasks.find((task: any) => task.id === workflow.rootTaskId);
      expect(rootTask).toMatchObject({ status: 'completed', completionSource: 'tool_receipt' });
      const childTasks = db.conversationActionTasks.filter((task: any) => task.parentTaskId === workflow.rootTaskId);
      expect(childTasks.length).toBeGreaterThanOrEqual(5);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exposes project creation and receipt-grounded status to the model tool layer', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userId = `design_tools_${suffix}`;
    const registry = new ToolRegistry();
    registerIndustryWorkflowTools(registry);
    const context = { userId, domain: 'personal' as const, orgId: '' } as any;

    const created = JSON.parse(await registry.execute('interior_design_project_create', {
      name: 'Voice-created studio',
      projectType: 'office',
      area: '88 m2',
    }, context));
    expect(created).toMatchObject({ ok: true, status: 'created', persisted: true, active: true });

    const status = JSON.parse(await registry.execute('interior_design_project_status', {}, context));
    expect(status.project.id).toBe(created.project.id);
    expect(status.workflow.stages).toHaveProperty('handoff');
  });

  it('routes spoken project creation to the durable project tool before stage execution', () => {
    const command = '\u65b0\u5efa\u4e00\u4e2a\u5ba4\u5185\u8bbe\u8ba1\u9879\u76ee';
    expect(isDesignProjectCreationRequest(command)).toBe(true);
    expect(formatIndustryCapabilityProfilePrompt(command)).toContain('interior_design_project_create');
    const routing = formatIndustryWorkflowRoutingPrompt(command);
    expect(routing).toContain('interior_design_project_create');
    expect(routing).not.toContain('industry_workflow_start(entryId=');

    const registry = new ToolRegistry();
    registerAllTools(registry);
    for (const channel of ['voice', 'chat'] as const) {
      const pipeline = buildLumiExecutionPipeline({
        dispatch: {
          userId: `design_project_create_${channel}`,
          text: command,
          channel,
          source: channel,
          operationMode: 'chat',
          targetIsLumi: true,
        },
        registry,
        source: channel,
      });
      expect(pipeline.turnIntent.flow.industryWorkflowEntryId).toBe('project');
      expect(pipeline.execution.toolPolicy.allowedTools).toContain('interior_design_project_create');
      expect(pipeline.execution.promptOverlay).toContain('interior_design_project_create');
    }
  });
});
