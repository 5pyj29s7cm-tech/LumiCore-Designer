import './helpers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase } from '../db_layer';
import { ToolRegistry } from '../server/tools/registry';
import { registerCadDeliveryTools } from '../server/tools/definitions/cad_delivery_tools';
import { registerIndustryWorkflowTools } from '../server/tools/definitions/industry_workflow_tools';
import { executeToolCall, isCanonicalToolExecutionRecord } from '../server/tools/execution_engine';
import { finalizeLumiResponse } from '../server/cognition/result_finalizer';
import { buildConversationActionContinuationState } from '../server/cognition/action_continuation';
import { formatVerifiedDesignProjectStatus } from '../server/design/status_response';
import { buildGeneralDesignPrompt } from '../src/i18n/generalDesignPrompt';
import { humanizeIndustryWorkflowResponse, formatIndustryWorkflowPrerequisiteBlocker } from '../server/industry/user_facing';

const dirs: string[] = [];
beforeAll(() => initDatabase());
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const taskText = '请为“暮蓝-26验收住宅”生成并核验 DXF 和 SVG 预览，不打开外部软件，不客户外发。';
async function cadFixture(bindingOverrides: Record<string, unknown> = {}, reused = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-cad-sync-')); dirs.push(directory);
  const registry = new ToolRegistry(); registerCadDeliveryTools(registry); registerIndustryWorkflowTools(registry);
  const context = { userId: 'designer-cad-sync-fixture', requestId: 'current-request', taskId: 'current-conversation-task', turnId: 'current-request', authenticated: true,
    authRole: 'user' as const, domain: 'personal' as const, localExecution: true, executionBoundary: 'trusted_local' as const, allowLocalFileWrites: true };
  const cad = await executeToolCall({ registry, name: 'cad_generate_dxf', arguments: { title: 'synthetic-cad', width: 11000, height: 8000, outputDirectory: directory, openPreview: false }, context });
  expect(cad.error).toBeUndefined(); expect(cad.terminalVerification?.status).toBe('verified'); expect(isCanonicalToolExecutionRecord(cad)).toBe(true);
  const files = JSON.parse(cad.result!);
  // The actual completion definition owns capability/verification; replace only
  // its business-store handler with a same-scope synthetic terminal fixture.
  const definition = registry.get('industry_workflow_complete')!;
  const terminalRegistry = new ToolRegistry();
  terminalRegistry.register({ ...definition, handler: async () => JSON.stringify({ ok: true, status: 'verified', persisted: true,
    task: { id: 'wt_task_cad', status: 'delivered', artifacts: [{ path: files.path }, { path: files.previewPath }], metadata: { industryWorkflow: { productLine: 'design', entryId: 'cad', requestId: context.requestId, conversationTaskId: context.taskId, context: { projectName: '暮蓝-26验收住宅' }, ...bindingOverrides } } },
    verification: { verificationId: 'wt_verify_cad', passed: true, status: 'passed' }, ...(reused ? { reused: true } : { archivedFilePaths: [files.path, files.previewPath] }) }) });
  const complete = await executeToolCall({ registry: terminalRegistry, name: 'industry_workflow_complete', arguments: { taskId: 'wt_task_cad' }, context });
  expect(complete.error).toBeUndefined(); expect(complete.terminalVerification?.status).toBe('verified');
  const run = (overrides: Record<string, unknown> = {}) => finalizeLumiResponse({ taskText, responseText: '[tool] industry_workflow_complete({"taskId":"wt_task_cad"})',
    toolRecords: [cad, complete], source: 'chat', requestId: context.requestId, taskId: context.taskId, ...overrides });
  const failCompletion = async (unknown = false) => {
    const failedRegistry = new ToolRegistry(); failedRegistry.register({ ...definition, handler: async () => {
      if (unknown) return JSON.stringify({ ok: true, status: 'unknown', persisted: true, task: { id: 'wt_task_cad' }, verification: { passed: true } });
      throw new Error('Synthetic current verification failure');
    } });
    return executeToolCall({ registry: failedRegistry, name: 'industry_workflow_complete', arguments: { taskId: 'wt_task_cad' }, context });
  };
  return { run, cad, complete, files, failCompletion };
}

describe('Designer synchronization evidence boundaries', () => {
  it('presents current verified local DXF and SVG without leaking model protocol or claiming external delivery', async () => {
    const f = await cadFixture(); const result = f.run();
    expect(result.blocked, JSON.stringify(result)).toBe(false); expect(result.text).toContain(f.files.path); expect(result.text).toContain(f.files.previewPath);
    expect(result.text).toContain('wt_task_cad'); expect(result.text).toContain('wt_verify_cad'); expect(result.text).toContain('未打开'); expect(result.text).not.toContain('[tool]');
  });
  it('rejects stale request and foreign task receipts', async () => {
    const f = await cadFixture(); expect(f.run({ requestId: 'other-request' }).blocked).toBe(true); expect(f.run({ taskId: 'other-task' }).blocked).toBe(true);
  });
  it('presents the same bounded artifact pair in English', async () => {
    const f = await cadFixture(); const result = f.run({ taskText: 'Generate and verify DXF and SVG preview.' });
    expect(result.blocked, JSON.stringify(result)).toBe(false); expect(result.text).toContain('The local DXF and SVG preview were generated and verified.');
    expect(result.text).toContain(f.files.path); expect(result.text).toContain(f.files.previewPath); expect(result.text).not.toContain('CAD 方案已生成');
  });
  it('accepts the real delivered-task reuse shape with explicit task artifact paths', async () => {
    const f = await cadFixture({}, true); expect(f.run().blocked).toBe(false); expect(f.run().text).toContain(f.files.previewPath);
  });
  it('does not revive earlier success across a later failed completion', async () => {
    const f = await cadFixture(); const failed = await f.failCompletion(); expect(failed.error).toContain('Synthetic current verification failure');
    expect(f.run({ toolRecords: [f.cad, f.complete, failed] }).blocked).toBe(true);
  });
  it('does not revive earlier success across a later unknown completion without an error', async () => {
    const f = await cadFixture(); const unknown = await f.failCompletion(true);
    expect(unknown.error).toBeUndefined(); expect(unknown.terminalVerification?.status).not.toBe('verified');
    expect(f.run({ toolRecords: [f.cad, f.complete, unknown], responseText: 'CAD 方案已生成。' }).blocked).toBe(true);
  });
  it('does not accept copied receipt flags or a deleted artifact', async () => {
    const f = await cadFixture(); expect(f.run({ toolRecords: [{ ...f.cad }, { ...f.complete }] }).blocked).toBe(true);
    fs.unlinkSync(f.files.previewPath); expect(f.run().blocked).toBe(true);
  });
  it('does not swallow an additional positive sending obligation', async () => {
    const f = await cadFixture(); expect(f.run({ taskText: taskText + '然后发邮件给客户。' }).blocked).toBe(true);
  });
  it.each([{ entryId: 'presentation' }, { requestId: 'old-request' }, { conversationTaskId: 'other-task' }, { productLine: 'legal' }, { context: { projectName: 'Other project' } }])('rejects a current host receipt with the wrong workflow binding: %j', async binding => {
    const f = await cadFixture(binding); expect(f.run().blocked).toBe(true);
  });
  it('does not bypass an explicit prior blocker or extra deletion obligation', async () => {
    const f = await cadFixture(); expect(f.run({ completionGuard: { blocked: true, reason: 'explicit blocker' } }).blocked).toBe(true);
    expect(f.run({ taskText: taskText + '删除旧文件。' }).blocked).toBe(true);
  });
  it.each(['再创建一份 PDF 清单。', '并保存到 D:/expected/。'])('does not claim additional deliverables or output locations: %s', async suffix => {
    const f = await cadFixture(); expect(f.run({ taskText: taskText + suffix }).blocked).toBe(true);
  });
  it('rejects completion before the current regenerated artifact', async () => {
    const f = await cadFixture(); expect(f.run({ toolRecords: [f.complete, f.cad] }).blocked).toBe(true);
  });
  it.each(['current-request', 'other-request'])('keeps terminal request identity separate from the execution lease: %s', requestId => {
    const instruction = '执行提案 PPT 阶段，前置未通过就停止。';
    const state = buildConversationActionContinuationState({ previous: { version: 2, taskId: 'old-task', status: 'blocked', goal: instruction, latestInstruction: instruction,
      latestBlocker: 'visualization prerequisite is blocked', activeRequestId: 'current-request', unfinished: true, assistantState: '', appTarget: '', receipts: [], sourcePaths: [], evidenceTools: [], toolSummaries: [], revision: 3, updatedAt: '2026-11-01T00:00:00Z' },
      userText: instruction, requestId, assistantText: '只读状态已返回。', toolCalls: [{ name: 'interior_design_project_status', arguments: {}, result: JSON.stringify({ ok: true, persisted: true, status: 'observed' }), terminalVerification: { status: 'verified', strategy: 'measured', reason: 'fixture' } }] });
    if (requestId === 'current-request') { expect(state?.activeRequestId).toBeUndefined(); expect(state?.status).toBe('blocked'); expect(state?.latestBlocker).toContain('visualization'); expect(state?.taskId).toBe('old-task'); }
    else { expect(state?.latestBlocker || '').not.toContain('visualization prerequisite'); expect(state?.activeRequestId).not.toBe('current-request'); }
  });
});

describe('Designer locale presentation preserves supplied data', () => {
  it.each(['zh', 'en'] as const)('formats the generation prompt in %s without changing source text', locale => {
    const text = buildGeneralDesignPrompt('User-supplied role', '- Source module', '中文用户原文 / exact data', locale);
    expect(text).toContain(locale === 'zh' ? '用户需求：' : 'User requirements:'); expect(text).toContain('中文用户原文 / exact data');
    if (locale === 'en') expect(text).not.toContain('请按以下模块输出');
  });
  it('uses English ledger labels without translating project names and artifact paths', () => {
    const result = formatVerifiedDesignProjectStatus({ name: 'interior_design_project_status', arguments: {}, terminalVerification: { status: 'verified', strategy: 'measured', reason: 'fixture' }, result: JSON.stringify({ ok: true, persisted: true,
      project: { id: 'project-fixture', name: '中文项目原名' }, workflow: { stages: { cad: { status: 'completed', verificationStatus: 'passed', artifacts: [{ path: 'D:/synthetic/中文图.dxf' }] } } } }) }, 'CAD status');
    expect(result).toContain('CAD scheme: Completed'); expect(result).toContain('中文项目原名'); expect(result).toContain('D:/synthetic/中文图.dxf'); expect(result).toContain('Next stage not recorded'); expect(result).not.toContain('All stages completed');
  });
  it('localizes internal capability names and prerequisites without changing execution state', () => {
    expect(humanizeIndustryWorkflowResponse('generate_image is not configured', 'en')).toBe('Image generation service is not configured');
    const text = formatIndustryWorkflowPrerequisiteBlocker({ projectName: '中文项目原名', entryId: 'presentation', missing: ['visualization'], locale: 'en' });
    expect(text).toContain('中文项目原名'); expect(text).toContain('Visualization'); expect(text).toContain('nothing was sent externally');
  });
});
