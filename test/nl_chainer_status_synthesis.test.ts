import { describe, expect, it } from 'vitest';
import { deterministicChainerReceiptResponse } from '../server/agents/nl_chainer';

describe('NL chainer deterministic status response', () => {
  it('returns one verified design-project status receipt without a second model synthesis', () => {
    const result = JSON.stringify({ ok: true, persisted: true, project: { id: 'project-1' } });
    expect(deterministicChainerReceiptResponse([{
      name: 'interior_design_project_status',
      arguments: {},
      result,
      terminalVerification: { status: 'verified', strategy: 'measured', reason: 'ledger read' },
    }])).toBe(result);
  });

  it('does not bypass synthesis for failures or unrelated tools', () => {
    expect(deterministicChainerReceiptResponse([{
      name: 'interior_design_project_status',
      arguments: {},
      result: '',
      error: 'read failed',
      terminalVerification: { status: 'failed', strategy: 'measured', reason: 'failed' },
    }])).toBeNull();
    expect(deterministicChainerReceiptResponse([{
      name: 'read_file',
      arguments: {},
      result: 'content',
      terminalVerification: { status: 'verified', strategy: 'measured', reason: 'read' },
    }])).toBeNull();
  });
});
