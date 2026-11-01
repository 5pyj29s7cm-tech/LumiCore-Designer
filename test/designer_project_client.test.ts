// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getActiveInteriorProject, listInteriorProjects, listInteriorProjectAssets, getInteriorProjectWorkflow } from '../src/lib/interiorProjects';
import { startIndustryWorkflow, executeIndustryWorkflow } from '../src/lib/industryWorkflowClient';
const fetcher = vi.fn();
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => { localStorage.clear(); localStorage.setItem('lumi_auth_token', 'fixture-token'); localStorage.setItem('lumi_desktop_session_proof', 'fixture-proof'); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('passes the main authentication headers and caller cancellation to project reads', async () => {
  fetcher.mockResolvedValue(response({ projects: [] })); const controller = new AbortController();
  await expect(listInteriorProjects('work', controller.signal)).resolves.toEqual([]);
  const [url, init] = fetcher.mock.calls[0]; expect(url).toContain('/api/org/interior/projects');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fixture-token'); expect(new Headers(init.headers).get('x-lumi-desktop-session')).toBe('fixture-proof');
  expect(init.signal).toBeInstanceOf(AbortSignal); expect(init.credentials).toBe('include');
});
it.each([
  ['project list', () => listInteriorProjects('personal'), {}],
  ['active project', () => getActiveInteriorProject('personal'), {}],
  ['sources', () => listInteriorProjectAssets('personal', 'project-A'), {}],
  ['stages', () => getInteriorProjectWorkflow('personal', 'project-A'), { workflow: { stages: {} } }],
] as const)('rejects malformed %s instead of presenting empty successful data', async (_name, request, data) => {
  fetcher.mockResolvedValue(response(data)); await expect(request()).rejects.toThrow('Invalid');
});
it('bounds a project read even if its adapter ignores the abort signal', async () => {
  vi.useFakeTimers(); fetcher.mockImplementation(() => new Promise(() => {}));
  const pending = getActiveInteriorProject('personal'); const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(15_001); await rejected; expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it('retains the updated common workflow start receipt validation for design', async () => {
  fetcher.mockResolvedValue(response({ task: { id: 'wrong-entry-task' }, handoffPrompt: 'synthetic', contract: { entryId: 'other' } }));
  await expect(startIndustryWorkflow({ entryId: 'cad', sourceInput: 'fixture' })).rejects.toThrow('not confirmed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops a truncated design stream without manufacturing a final delivery receipt', async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"chunk":"partial fixture"}\n\n')); controller.close(); } });
  fetcher.mockResolvedValue({ ok: true, body });
  await expect(executeIndustryWorkflow({ taskId: 'fixture-task', prompt: 'synthetic only' })).rejects.toThrow('before a final receipt');
  expect(body.locked).toBe(false);
});
