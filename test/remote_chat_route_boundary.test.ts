import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runWithTools: vi.fn(),
}));

vi.mock('../server/llm/adapter', () => ({
  runWithTools: mocks.runWithTools,
}));

import jwt from 'jsonwebtoken';
import { makeApp, JWT_SECRET } from './helpers';
import { mountChatRoutes } from '../server/routes/chat_routes';
import {
  DESKTOP_SESSION_HEADER,
  issueDesktopSessionProof,
} from '../server/config/desktop_bootstrap';
import { buildHttpToolSecurityContext } from '../server/runtime/http_execution_boundary';
import {
  getIndustryWorkflowTask,
  recordIndustryWorkflowExecution,
  startIndustryWorkflow,
} from '../server/industry/workflow_service';

let baseUrl = '';
let cleanup: (() => void) | undefined;
const userToken = jwt.sign({
  uid: 'remote-chat-user',
  username: 'remote',
  role: 'user',
}, JWT_SECRET);

describe('REST chat remote execution boundary', () => {
  beforeAll(async () => {
    const app = await makeApp();
    baseUrl = app.url;
    cleanup = app.cleanup;
    const unavailable = () => null;
    mountChatRoutes(app.apiRouter, JWT_SECRET, {
      getDeepSeek: unavailable,
      getGemini: unavailable,
      getOpenAI: unavailable,
      getAnthropic: unavailable,
      getQwen: unavailable,
    });
  });

  afterAll(() => cleanup?.());

  beforeEach(() => {
    mocks.runWithTools.mockReset();
    mocks.runWithTools.mockResolvedValue({
      text: 'remote answer',
      toolCalls: [],
      usageRecords: [],
    });
  });

  it('does not expose the shared model to an anonymous caller', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(response.status).toBe(401);
    expect(mocks.runWithTools).not.toHaveBeenCalled();
  });

  it('marks authenticated REST chat remote and narrows the model policy before dispatch', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ message: '读取 D:\\work\\brief.txt 并告诉我唯一风险，但不要修改文件' }),
    });
    expect(response.status).toBe(200);
    expect(mocks.runWithTools).toHaveBeenCalledTimes(1);
    const context = mocks.runWithTools.mock.calls[0][11] as any;
    expect(context).toMatchObject({
      userId: 'remote-chat-user',
      authenticated: true,
      authRole: 'user',
      localExecution: false,
      executionBoundary: 'remote_restricted',
      source: 'rest_chat',
    });
    expect(context.toolPolicy.allowedTools.every((name: string) => name === 'web_search')).toBe(true);
    expect(context.toolPolicy.allowedTools).not.toEqual(expect.arrayContaining([
      'read_file',
      'list_directory',
      'search_files',
      'desktop_capture_screen',
      'desktop_running_processes',
      'run_command',
      'credential_get',
    ]));
  });

  it('fails closed for an invalid proof and never trusts a valid proof from a non-loopback peer', async () => {
    const invalidResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
        [DESKTOP_SESSION_HEADER]: 'invalid-native-proof-that-is-long-enough-to-be-presented',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(invalidResponse.status).toBe(403);
    expect(await invalidResponse.json()).toMatchObject({ code: 'DESKTOP_SESSION_PROOF_REQUIRED' });
    expect(mocks.runWithTools).not.toHaveBeenCalled();

    const emptyResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
        [DESKTOP_SESSION_HEADER]: '',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(emptyResponse.status).toBe(403);
    expect(await emptyResponse.json()).toMatchObject({ code: 'DESKTOP_SESSION_PROOF_REQUIRED' });
    expect(mocks.runWithTools).not.toHaveBeenCalled();

    const validProof = issueDesktopSessionProof('remote-chat-user').proof;
    expect(buildHttpToolSecurityContext({
      user: { uid: 'remote-chat-user', username: 'remote', role: 'user' },
      headers: { [DESKTOP_SESSION_HEADER]: validProof },
      socket: { remoteAddress: '192.0.2.10' },
    } as any)).toMatchObject({
      authenticated: true,
      desktopProofPresented: true,
      localExecution: false,
      executionBoundary: 'remote_restricted',
    });
  });

  it('accepts the native desktop proof as trusted local and persists the bound industry receipt', async () => {
    const sourceInput = 'Review the project scope, fixed conditions, evidence gaps, design direction, room relationships, professional boundaries, risks, and next implementation actions.';
    const started = startIndustryWorkflow({
      userId: 'remote-chat-user',
      domain: 'personal',
      orgId: '',
      entryId: 'project',
      sourceInput,
      source: 'designer_standalone_workspace',
      context: { mode: 'standalone' },
    });
    const receiptText = [
      'Concept layout risk implementation brief reviewed and archived.',
      'The project scope, fixed conditions, evidence gaps, design direction, room relationships,',
      'professional review boundaries, and next implementation actions are recorded for accountable review.',
    ].join(' ');
    const requiredReceipts = [
      'mcp_design-studio-pack_interior_project_brief',
      'mcp_design-studio-pack_space_planning_checklist',
    ].map((name, index) => ({
      id: `native-design-receipt-${index}`,
      taskId: started.conversationTaskId,
      requestId: started.requestId,
      name,
      arguments: {},
      result: JSON.stringify({
        ok: true,
        status: 'verified',
        taskId: started.task.id,
        summary: receiptText,
      }),
      terminalVerification: {
        status: 'verified' as const,
        strategy: 'terminal_receipt' as const,
        reason: 'Verified native desktop industry receipt.',
      },
    }));
    const toolCalls = [
      ...requiredReceipts,
      {
        id: 'native-design-completion',
        name: 'industry_workflow_complete',
        arguments: { taskId: started.task.id },
        result: JSON.stringify({
          ok: true,
          status: 'verified',
          persisted: true,
          task: { id: started.task.id },
          verification: { passed: true },
        }),
        terminalVerification: {
          status: 'verified' as const,
          strategy: 'terminal_receipt' as const,
          reason: 'Canonical industry workflow completion receipt.',
        },
      },
    ];
    mocks.runWithTools.mockImplementationOnce(async () => {
      const canonicalReceipt = recordIndustryWorkflowExecution({
        userId: 'remote-chat-user',
        domain: 'personal',
        orgId: '',
        taskId: started.task.id,
        resultText: receiptText,
        toolRecords: requiredReceipts,
        source: 'native_desktop_tool_loop',
      });
      expect(canonicalReceipt.verification.passed).toBe(true);
      return {
        text: receiptText,
        toolCalls,
        usageRecords: [],
      };
    });
    const desktopProof = issueDesktopSessionProof('remote-chat-user').proof;
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
        [DESKTOP_SESSION_HEADER]: desktopProof,
      },
      body: JSON.stringify({
        industryWorkflowTaskId: started.task.id,
        industryWorkflowSourceInput: sourceInput,
        messages: [{ role: 'user', content: `${started.handoffPrompt}\n\nComplete this independent design brief.` }],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(mocks.runWithTools).toHaveBeenCalledTimes(1);
    const context = mocks.runWithTools.mock.calls[0][11] as any;
    expect(context).toMatchObject({
      userId: 'remote-chat-user',
      authenticated: true,
      authRole: 'user',
      localExecution: true,
      executionBoundary: 'trusted_local',
      source: 'rest_chat_local',
      industryWorkflowTaskId: started.task.id,
    });
    expect(payload.industryWorkflow, JSON.stringify(payload.industryWorkflow?.verification)).toMatchObject({
      taskId: started.task.id,
      status: 'delivered',
      verification: { passed: true },
    });
    expect(getIndustryWorkflowTask({
      userId: 'remote-chat-user',
      domain: 'personal',
      orgId: '',
    }, started.task.id)).toMatchObject({ status: 'delivered' });
  });
});
