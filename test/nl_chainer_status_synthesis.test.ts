import './helpers';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeLumiResponse } from '../server/cognition/result_finalizer';
import type { ToolExecutionRecord } from '../server/tools/types';

beforeAll(async () => { await (await import('../db_layer')).initDatabase(); });
const request = '\u67e5\u8be2\u5f53\u524d\u8bbe\u8ba1\u9879\u76ee\u7684 CAD \u65b9\u6848\u9636\u6bb5\u72b6\u6001';
const receipt = (extra: Partial<ToolExecutionRecord> = {}): ToolExecutionRecord => ({
  name: 'interior_design_project_status', arguments: {}, requestId: 'current-status',
  result: JSON.stringify({ ok: true, persisted: true, project: { id: 'project-1', name: 'Fixture design' },
    workflow: { nextStage: 'cad', stages: { cad: { status: 'blocked', verificationStatus: 'failed', currentTaskId: 'cad-fixture', blocker: 'Synthetic missing prerequisite' } } } }),
  terminalVerification: { status: 'verified', strategy: 'measured', reason: 'synthetic ledger read' }, ...extra,
});
const finalize = (records: ToolExecutionRecord[]) => finalizeLumiResponse({
  taskText: request, responseText: 'All design work and customer delivery are complete.', source: 'chat', requestId: 'current-status', toolRecords: records,
});

describe('canonical deterministic Designer status response', () => {
  it('renders the verified ledger rather than unsupported model completion prose', () => {
    const result = finalize([receipt()]);
    expect(result.blocked).toBe(false);
    expect(result.text).toContain('cad-fixture');
    expect(result.text).toContain('Synthetic missing prerequisite');
    expect(result.text).not.toContain('customer delivery are complete');
  });
  it.each([
    { error: 'read failed', terminalVerification: { status: 'failed', strategy: 'measured', reason: 'failed' } },
    { requestId: 'older-status' },
    { name: 'read_file' },
  ] as Partial<ToolExecutionRecord>[])('keeps failed, stale or unrelated receipts from completing status %#', extra => {
    expect(finalize([receipt(extra)]).blocked).toBe(true);
  });
});
