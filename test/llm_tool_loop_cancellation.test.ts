import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  makeLLMCall: vi.fn(),
}));

vi.mock('../server/llm/providers', async () => {
  const actual = await vi.importActual<typeof import('../server/llm/providers')>('../server/llm/providers');
  return {
    ...actual,
    makeLLMCall: mocks.makeLLMCall,
  };
});

import { runWithTools } from '../server/llm/adapter';
import { ToolRegistry } from '../server/tools/registry';

function cancellationRegistry() {
  const registry = new ToolRegistry();
  const first = vi.fn(async () => JSON.stringify({ ok: true, verified: true }));
  const second = vi.fn(async () => JSON.stringify({ ok: true, verified: true }));
  for (const [name, handler] of [['cancel_first', first], ['cancel_second', second]] as const) {
    registry.register({
      name,
      description: `Cancellation boundary tool ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
      permission: 'public',
      securityLevel: 'safe',
      handler,
    });
  }
  return { registry, first, second };
}

const getters = [
  () => null,
  () => null,
  () => null,
  () => null,
  () => null,
] as const;

beforeEach(() => {
  mocks.makeLLMCall.mockReset();
});

describe('LLM tool loop cancellation boundary', () => {
  it('drops a late model response before it can dispatch its tool calls', async () => {
    const { registry, first } = cancellationRegistry();
    let cancelled = false;
    mocks.makeLLMCall.mockImplementationOnce(async () => {
      cancelled = true;
      return {
        text: 'late response',
        toolCalls: [{ id: 'late-tool', name: 'cancel_first', arguments: {} }],
      };
    });

    const result = await runWithTools(
      [{ role: 'user', content: 'Run the tool' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      1,
      ...getters,
      undefined,
      { isCancelled: () => cancelled },
    );

    expect(first).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toMatch(/cancelled before the model response/i);
  });

  it('stops the rest of a tool batch when cancellation arrives between calls', async () => {
    const { registry, first, second } = cancellationRegistry();
    let cancelled = false;
    first.mockImplementationOnce(async () => {
      cancelled = true;
      return JSON.stringify({ ok: true, verified: true });
    });
    mocks.makeLLMCall.mockResolvedValueOnce({
      text: 'two calls',
      toolCalls: [
        { id: 'first-tool', name: 'cancel_first', arguments: {} },
        { id: 'second-tool', name: 'cancel_second', arguments: {} },
      ],
    });

    const result = await runWithTools(
      [{ role: 'user', content: 'Run both tools' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      1,
      ...getters,
      undefined,
      { isCancelled: () => cancelled },
    );

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.text).toMatch(/cancelled before the remaining tool calls/i);
  });

  it('keeps changing-argument failures inside the shared route iteration budget', async () => {
    const registry = new ToolRegistry();
    const failing = vi.fn(async () => { throw new Error('missing exact source path'); });
    registry.register({
      name: 'bounded_read',
      description: 'Read one exact source path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      permission: 'public',
      securityLevel: 'safe',
      handler: failing,
    });
    let iteration = 0;
    mocks.makeLLMCall.mockImplementation(async () => ({
      text: '',
      toolCalls: [{ id: `read-${iteration}`, name: 'bounded_read', arguments: { path: `missing-${iteration++}.txt` } }],
    }));

    const result = await runWithTools(
      [{ role: 'user', content: 'Read the exact source and continue.' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      10,
      ...getters,
    );

    expect(failing).toHaveBeenCalledTimes(10);
    expect(result.toolCalls).toHaveLength(10);
    expect(result.text).toMatch(/bounded tool execution.+budget was exhausted/is);
  });

  it('hands a verified design-project status receipt to centralized finalization', async () => {
    const registry = new ToolRegistry();
    const statusHandler = vi.fn(async () => JSON.stringify({
      ok: true,
      status: 'observed',
      persisted: true,
      project: { id: 'project-1' },
      workflow: { completedStages: ['project'], nextStage: 'cad', stages: {} },
    }));
    registry.register({
      name: 'interior_design_project_status',
      description: 'Read durable project status.',
      parameters: { type: 'object', properties: {}, required: [] },
      permission: 'public',
      securityLevel: 'safe',
      handler: statusHandler,
    });
    mocks.makeLLMCall
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'status-read', name: 'interior_design_project_status', arguments: {} }],
      })
      .mockResolvedValueOnce({
        text: 'The project brief is complete and CAD is next.',
        toolCalls: [],
      });

    const result = await runWithTools(
      [{ role: 'user', content: 'What is the current status of the design project?' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      1,
      ...getters,
    );

    expect(statusHandler).toHaveBeenCalledTimes(1);
    expect(mocks.makeLLMCall).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('does not end a creation workflow merely because it read the project status first', async () => {
    const registry = new ToolRegistry();
    const statusHandler = vi.fn(async () => JSON.stringify({
      ok: true,
      status: 'observed',
      project: { id: 'project-1' },
      workflow: { completedStages: ['project', 'cad'], nextStage: 'visualization' },
    }));
    const startHandler = vi.fn(async () => JSON.stringify({
      ok: true,
      status: 'started',
      task: { id: 'visualization-task' },
    }));
    for (const [name, handler] of [
      ['interior_design_project_status', statusHandler],
      ['industry_workflow_start', startHandler],
    ] as const) {
      registry.register({
        name,
        description: name,
        parameters: { type: 'object', properties: {}, required: [] },
        permission: 'public',
        securityLevel: 'safe',
        handler,
      });
    }
    mocks.makeLLMCall
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'status-read', name: 'interior_design_project_status', arguments: {} }],
      })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'stage-start', name: 'industry_workflow_start', arguments: { entryId: 'visualization' } }],
      })
      .mockResolvedValueOnce({ text: 'The visualization task is now ready to continue.', toolCalls: [] });

    const result = await runWithTools(
      [{ role: 'user', content: '矩衡验收户型A进入效果图阶段，先读取项目事实再开始生成。' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      3,
      ...getters,
    );

    expect(statusHandler).toHaveBeenCalledTimes(1);
    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(result.toolCalls.map(record => record.name)).toEqual([
      'interior_design_project_status',
      'industry_workflow_start',
    ]);
  });

  it('does not rebuild product workflow orchestration inside the shared adapter', async () => {
    const registry = new ToolRegistry();
    const assessment = vi.fn(async () => JSON.stringify({
      status: 'not_ready',
      geometryReady: false,
      missing: ['measured plan', 'wall coordinates'],
    }));
    registry.register({
      name: 'industry_source_assessment',
      description: 'Assess whether the bound source can support creation.',
      parameters: { type: 'object', properties: {}, required: [] },
      permission: 'public',
      securityLevel: 'safe',
      handler: assessment,
    });
    mocks.makeLLMCall
      .mockResolvedValueOnce({ text: 'The source looks incomplete.', toolCalls: [] })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'assessment', name: 'industry_source_assessment', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'The source is missing measured geometry, so creation stopped.', toolCalls: [] });

    const result = await runWithTools(
      [{ role: 'user', content: 'Check whether this source is sufficient.' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      1,
      ...getters,
      undefined,
      {
        industryWorkflowTaskId: 'wt_task_bound',
        industryWorkflowRequiredToolReceipts: ['industry_source_assessment', 'industry_output_create'],
        toolPolicy: {
          allowedTools: ['industry_source_assessment'],
          requireConfirmation: [],
          forbiddenTools: [],
          maxIterations: 1,
        },
      },
    );

    expect(assessment).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toBe('The source looks incomplete.');
  });

  it('forces the exact missing industry tool after the model falls back to stale ledger reads', async () => {
    const registry = new ToolRegistry();
    const assessment = vi.fn(async () => JSON.stringify({ ok: true, status: 'verified' }));
    const output = vi.fn(async () => JSON.stringify({ ok: true, status: 'verified', path: 'current.dxf' }));
    const unrelatedRead = vi.fn(async () => JSON.stringify({ ok: true, status: 'observed', path: 'old.dxf' }));
    for (const [name, handler] of [
      ['industry_source_assessment', assessment],
      ['industry_output_create', output],
      ['unrelated_read_only', unrelatedRead],
    ] as const) {
      registry.register({
        name,
        description: name,
        parameters: { type: 'object', properties: {}, required: [] },
        permission: 'public',
        securityLevel: 'safe',
        handler,
      });
    }
    mocks.makeLLMCall
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'assessment', name: 'industry_source_assessment', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'The old CAD file already exists.', toolCalls: [] })
      .mockResolvedValueOnce({
        text: 'Using the historical file as the current result.',
        toolCalls: [{ id: 'old-read', name: 'unrelated_read_only', arguments: {} }],
      })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'current-output', name: 'industry_output_create', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'Created and verified current.dxf.', toolCalls: [] });

    const result = await runWithTools(
      [{ role: 'user', content: 'Create and verify the current CAD output.' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      3,
      ...getters,
      undefined,
      {
        industryWorkflowTaskId: 'wt_task_current',
        industryWorkflowRequiredToolReceipts: ['industry_source_assessment', 'industry_output_create'],
        toolPolicy: {
          allowedTools: ['industry_source_assessment', 'industry_output_create'],
          requireConfirmation: [],
          forbiddenTools: [],
          maxIterations: 3,
        },
      },
    );

    expect(assessment).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledTimes(1);
    expect(unrelatedRead).not.toHaveBeenCalled();
    expect(result.toolCalls.map(record => record.name)).toEqual([
      'industry_source_assessment',
      'industry_output_create',
    ]);
    expect(result.text).toMatch(/bounded tool execution.+budget was exhausted/is);
    expect(result.text).not.toMatch(/historical file as the current result/i);
  });

  it('fails closed when the model also ignores the forced missing industry tool', async () => {
    const registry = new ToolRegistry();
    const assessment = vi.fn(async () => JSON.stringify({ ok: true, status: 'verified' }));
    const output = vi.fn(async () => JSON.stringify({ ok: true, status: 'verified', path: 'current.dxf' }));
    const unrelatedRead = vi.fn(async () => JSON.stringify({ ok: true, status: 'observed', path: 'old.dxf' }));
    for (const [name, handler] of [
      ['industry_source_assessment', assessment],
      ['industry_output_create', output],
      ['unrelated_read_only', unrelatedRead],
    ] as const) {
      registry.register({
        name,
        description: name,
        parameters: { type: 'object', properties: {}, required: [] },
        permission: 'public',
        securityLevel: 'safe',
        handler,
      });
    }
    mocks.makeLLMCall
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'assessment', name: 'industry_source_assessment', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'The old CAD file already exists.', toolCalls: [] })
      .mockResolvedValueOnce({
        text: 'Using the historical file as the current result.',
        toolCalls: [{ id: 'old-read', name: 'unrelated_read_only', arguments: {} }],
      })
      .mockResolvedValueOnce({ text: 'I will still use the historical file.', toolCalls: [] });

    const result = await runWithTools(
      [{ role: 'user', content: 'Create and verify the current CAD output.' }],
      registry,
      { provider: 'deepseek', model: 'test-model' },
      undefined,
      3,
      ...getters,
      undefined,
      {
        industryWorkflowTaskId: 'wt_task_current',
        industryWorkflowRequiredToolReceipts: ['industry_source_assessment', 'industry_output_create'],
        toolPolicy: {
          allowedTools: ['industry_source_assessment', 'industry_output_create'],
          requireConfirmation: [],
          forbiddenTools: [],
          maxIterations: 3,
        },
      },
    );

    expect(assessment).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
    expect(unrelatedRead).not.toHaveBeenCalled();
    expect(result.toolCalls.map(record => record.name)).toEqual(['industry_source_assessment']);
    expect(result.text).not.toMatch(/industry_output_create/);
    expect(result.text).not.toMatch(/historical file as the current result/i);
  });
});
