import './helpers';
import { beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_VARIANT } from '../shared/product_variant';
import { getIndustryWorkflowContracts } from '../server/industry/workflow_contracts';
import {
  getIndustryWorkflowTask,
  reconcileInterruptedIndustryWorkflowTasks,
  startIndustryWorkflow,
} from '../server/industry/workflow_service';
import { readDB, writeDB } from '../db_layer';

beforeAll(async () => {
  const { initDatabase } = await import('../db_layer');
  await initDatabase();
});
describe('interrupted industry workflow reconciliation', () => {
  it('aligns a stale active industry task with its blocked persistent conversation task without replay', () => {
    const contract = getIndustryWorkflowContracts(PRODUCT_VARIANT.productLine)[0];
    const userId = `industry_reconcile_${PRODUCT_VARIANT.productLine}`;
    const started = startIndustryWorkflow({
      userId,
      domain: 'personal',
      orgId: '',
      entryId: contract.entryId,
      sourceInput: 'Interrupted reconciliation test input.',
    });
    const db = readDB();
    const actionTask = db.conversationActionTasks.find((task: any) => task.id === started.conversationTaskId);
    actionTask.status = 'blocked';
    actionTask.blocker = 'The previous runtime ended before this task reached a terminal receipt.';
    writeDB(db);

    expect(reconcileInterruptedIndustryWorkflowTasks()).toBeGreaterThanOrEqual(1);
    expect(getIndustryWorkflowTask({ userId, domain: 'personal', orgId: '' }, started.task.id)).toMatchObject({
      status: 'blocked',
      blockedBy: [expect.stringContaining('previous runtime ended')],
    });
  });

  it('does not reconcile Main commerce, finance or legal tasks through the Designer startup hook', () => {
    const scope={userId:`retained-main-${Date.now()}`,domain:'personal' as const,orgId:''};
    const started=['today-operations','business-dashboard','workspace'].map(entryId=>startIndustryWorkflow({...scope,entryId,sourceInput:'Synthetic retained Main workflow'}));
    const db=readDB();
    for (const item of started) {
      const action=db.conversationActionTasks.find((task:any)=>task.id===item.conversationTaskId);
      action.status='blocked';action.blocker='Other workflow owner retains its own recovery policy.';
    }
    writeDB(db);
    reconcileInterruptedIndustryWorkflowTasks();
    for(const item of started) expect(getIndustryWorkflowTask(scope,item.task.id)?.status).toBe('in_progress');
  });
});
