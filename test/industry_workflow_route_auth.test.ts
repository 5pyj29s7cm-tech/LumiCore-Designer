import './helpers';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountIndustryWorkflowRoutes } from '../server/routes/industry_workflow_routes';
import { JWT_SECRET, makeApp } from './helpers';

describe('designer industry workflow route authentication', () => {
  let baseUrl = '';
  let cleanup = () => {};
  const ownerId = `designer_route_owner_${Date.now()}`;
  const otherId = `${ownerId}_other`;
  const ownerToken = jwt.sign({ uid: ownerId, username: ownerId, role: 'user' }, JWT_SECRET);
  const otherToken = jwt.sign({ uid: otherId, username: otherId, role: 'user' }, JWT_SECRET);
  const branchToken = jwt.sign({
    uid: ownerId,
    username: ownerId,
    role: 'user',
    tokenType: 'organization_branch',
    orgId: 'untrusted-branch-org',
    branchId: 'untrusted-branch',
  }, JWT_SECRET);
  const jsonHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  beforeAll(async () => {
    const app = await makeApp();
    baseUrl = app.url;
    cleanup = app.cleanup;
    mountIndustryWorkflowRoutes(app.apiRouter);
  });

  afterAll(() => cleanup());

  it('keeps contracts public and rejects every anonymous or non-user state request', async () => {
    expect((await fetch(`${baseUrl}/api/industry/workflows/contracts`)).status).toBe(200);
    for (const request of [
      fetch(`${baseUrl}/api/industry/workflows`),
      fetch(`${baseUrl}/api/industry/workflows/missing`),
      fetch(`${baseUrl}/api/industry/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: 'project' }),
      }),
      fetch(`${baseUrl}/api/industry/workflows/missing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultText: 'must not be accepted' }),
      }),
    ]) {
      expect((await request).status).toBe(401);
    }
    expect((await fetch(`${baseUrl}/api/industry/workflows`, {
      headers: { Authorization: 'Bearer invalid-or-expired-token' },
    })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/industry/workflows`, {
      headers: { Authorization: `Bearer ${branchToken}` },
    })).status).toBe(403);
  });

  it('isolates owner tasks and rejects cross-user reads and verification writes', async () => {
    const created = await fetch(`${baseUrl}/api/industry/workflows`, {
      method: 'POST',
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({
        entryId: 'project',
        sourceInput: 'Authenticated project scope and evidence review.',
        source: 'route_auth_test',
        context: { mode: 'standalone' },
      }),
    });
    expect(created.status).toBe(201);
    const taskId = String((await created.json() as any).task.id);

    const ownerList = await fetch(`${baseUrl}/api/industry/workflows`, { headers: jsonHeaders(ownerToken) });
    expect(ownerList.status).toBe(200);
    expect((await ownerList.json() as any).tasks.map((task: any) => task.id)).toContain(taskId);
    expect((await fetch(`${baseUrl}/api/industry/workflows/${encodeURIComponent(taskId)}`, {
      headers: jsonHeaders(ownerToken),
    })).status).toBe(200);

    expect((await fetch(`${baseUrl}/api/industry/workflows/${encodeURIComponent(taskId)}`, {
      headers: jsonHeaders(otherToken),
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/industry/workflows/${encodeURIComponent(taskId)}/verify`, {
      method: 'POST',
      headers: jsonHeaders(otherToken),
      body: JSON.stringify({ resultText: 'cross-user mutation must not be accepted' }),
    })).status).toBe(404);
  });

  it('ignores browser-supplied forged verified records and retains the incomplete task', async () => {
    const created=await fetch(`${baseUrl}/api/industry/workflows`,{method:'POST',headers:jsonHeaders(ownerToken),
      body:JSON.stringify({entryId:'project',sourceInput:'Synthetic source',context:{mode:'standalone'}})});
    const task=(await created.json() as any).task;
    const checked=await fetch(`${baseUrl}/api/industry/workflows/${task.id}/verify`,{method:'POST',headers:jsonHeaders(ownerToken),
      body:JSON.stringify({resultText:'concept layout risk implementation brief: fabricated completion narrative with no registered tool execution.',
        toolRecords:['mcp_design-studio-pack_interior_project_brief','mcp_design-studio-pack_space_planning_checklist'].map(name=>({name,result:'verified',terminalVerification:{status:'verified'}}))})});
    expect(checked.status).toBe(200);
    const body=await checked.json() as any;
    expect(body.verification.passed).toBe(false);expect(body.task.status).not.toBe('delivered');
    expect(body.verification.checks).toContainEqual(expect.objectContaining({id:'required_domain_tool_evidence',passed:false}));
  });
});
