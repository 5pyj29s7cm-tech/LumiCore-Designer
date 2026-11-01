// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignChat } from '../src/hooks/useDesignChat';
import { useDesignProjectResources } from '../src/hooks/useDesignProjectResources';
import { DesignHub } from '../src/components/org/DesignHub';
import { designerLifecycleCopy } from '../src/i18n/locales/designerLifecycle';
import { interiorDesignMessage } from '../src/i18n/locales/interiorDesign';
import type { InteriorProject, InteriorProjectWorkflowState } from '../src/lib/interiorProjects';

const mock = vi.hoisted(() => ({ start: vi.fn(), execute: vi.fn(), list: vi.fn(), active: vi.fn(), assets: vi.fn(), workflow: vi.fn(),
  scope: { user: { uid: 'fixture-owner', role: 'user' }, workDomain: 'personal', orgConnection: null as any } }));
vi.mock('../src/contexts/AppContext', () => ({ useApp: () => mock.scope }));
vi.mock('../src/lib/useT', () => ({ useT: () => ({ langCode: 'en' }) }));
vi.mock('../src/lib/industryWorkflowClient', () => ({ startIndustryWorkflow: mock.start, executeIndustryWorkflow: mock.execute, buildIndustryWorkflowIdempotencyKey: async (input: unknown) => JSON.stringify(input) }));
vi.mock('../src/lib/interiorProjects', () => ({ listInteriorProjects: mock.list, getActiveInteriorProject: mock.active,
  listInteriorProjectAssets: mock.assets, getInteriorProjectWorkflow: mock.workflow,
  createInteriorProject: vi.fn(), updateInteriorProject: vi.fn(), setActiveInteriorProject: vi.fn(),
  interiorProjectAssetUrl: () => '/synthetic-asset', removeInteriorProjectAsset: vi.fn(), updateInteriorProjectAsset: vi.fn() }));
const copy = designerLifecycleCopy('en');
const task = { task: { id: 'fixture-task' }, handoffPrompt: 'fixture-only handoff' };
const project: InteriorProject = { id: 'fixture-project', orgId: '', ownerUserId: 'fixture-owner', name: 'Fixture project', projectType: 'residential', status: 'brief', brief: { location: '', area: '', occupants: '', budget: '', style: '', requirements: '', constraints: '' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const workflow = { stages: Object.fromEntries(['project','cad','visualization','presentation','handoff'].map(id => [id, { status: 'not_started', artifacts: [], receiptIds: [], taskIds: [], sourceTaskIds: [] }])) } as unknown as InteriorProjectWorkflowState;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.useRealTimers(); Object.values(mock).forEach(value => { if (typeof value === 'function') value.mockReset(); });
  mock.scope.user.uid = 'fixture-owner'; mock.scope.workDomain = 'personal'; mock.scope.orgConnection = null;
  mock.start.mockResolvedValue(task); mock.execute.mockResolvedValue({ text: 'Fixture delivered result', status: 'delivered' });
  mock.list.mockResolvedValue([]); mock.active.mockResolvedValue(null); mock.assets.mockResolvedValue([]); mock.workflow.mockResolvedValue(workflow);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('designer request lifecycle with synthetic transports only', () => {
  it('stops during creation, aborts its signal and never executes a late created task', async () => {
    const pending = deferred<typeof task>(); mock.start.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDesignChat('en'));
    let run!: Promise<void>; act(() => { run = result.current.send('Fixture prompt', { entryId: 'project', sourceInput: 'Brief A' }); });
    await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
    const signal = mock.start.mock.calls[0][1]; act(() => result.current.stop()); await act(async () => { await run; });
    expect(signal.aborted).toBe(true); expect(result.current.loading).toBe(false); expect(result.current.workflowStatus).toBe('stopped_locally');
    await act(async () => pending.resolve(task)); expect(mock.execute).not.toHaveBeenCalled(); expect(result.current.workflowTaskId).toBe('');
    expect(result.current.error).toBe(copy.stopped);
  });
  it('bounds an uncooperative create adapter without automatically retrying a mutation', async () => {
    vi.useFakeTimers(); mock.start.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDesignChat('en')); let run!: Promise<void>;
    await act(async () => { run = result.current.send('Fixture', { entryId: 'cad', sourceInput: 'A' }); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); await run; });
    expect(result.current.loading).toBe(false); expect(result.current.error).toBe(copy.timeout); expect(mock.start).toHaveBeenCalledTimes(1); expect(mock.execute).not.toHaveBeenCalled();
  });
  it('bounds the stream and preserves brief for an explicit subsequent decision', async () => {
    vi.useFakeTimers(); mock.execute.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDesignChat('en')); let run!: Promise<void>;
    await act(async () => { result.current.setInput('A'); run = result.current.send('Fixture', { entryId: 'cad', sourceInput: 'A' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(180_001); await run; });
    expect(result.current.input).toBe('A'); expect(result.current.workflowTaskId).toBe('fixture-task'); expect(result.current.workflowStatus).toBe('unconfirmed'); expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a changed brief from the prior delivered result without rerunning', async () => {
    const { result } = renderHook(() => useDesignChat('en'));
    await act(async () => { result.current.setInput('A'); await result.current.send('Fixture', { entryId: 'project', sourceInput: 'A' }); });
    expect(result.current.staleResult).toBe(false);
    act(() => result.current.setInput('B'));
    expect(result.current.staleResult).toBe(true); expect(result.current.resultInput).toBe('A'); expect(result.current.result).toContain('Fixture delivered'); expect(mock.start).toHaveBeenCalledTimes(1);
  });
  it('blocks double-submit before React rerenders', async () => {
    const pending = deferred<typeof task>(); mock.start.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDesignChat('en')); let first!: Promise<void>;
    act(() => { first = result.current.send('A', { entryId: 'project', sourceInput: 'A' }); void result.current.send('A', { entryId: 'project', sourceInput: 'A' }); });
    await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
    await act(async () => { pending.resolve(task); await first; }); expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it('uses a distinct creation key when the project context changes with the same brief', async () => {
    const { result } = renderHook(() => useDesignChat('en', undefined, 'fixture-owner:personal'));
    await act(async () => { await result.current.send('Project context A', { entryId: 'cad', sourceInput: 'Same brief', projectId: 'project-A' }); });
    await act(async () => { await result.current.send('Project context B', { entryId: 'cad', sourceInput: 'Same brief', projectId: 'project-A' }); });
    expect(mock.start.mock.calls[0][0].idempotencyKey).not.toBe(mock.start.mock.calls[1][0].idempotencyKey);
  });
  it('does not execute after owner unmounts during creation', async () => {
    const pending = deferred<typeof task>(); mock.start.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useDesignChat('en')); let run!: Promise<void>;
    act(() => { run = result.current.send('A', { entryId: 'project', sourceInput: 'A' }); }); await waitFor(() => expect(mock.start).toHaveBeenCalled());
    unmount(); pending.resolve(task); await run; expect(mock.execute).not.toHaveBeenCalled();
  });
  it('keeps interrupted execution visibly blocked instead of reporting delivery', async () => {
    mock.execute.mockRejectedValue(new Error('Synthetic truncated stream'));
    const { result } = renderHook(() => useDesignChat('en'));
    await act(async () => { await result.current.send('A', { entryId: 'project', sourceInput: 'A' }); });
    expect(result.current.workflowStatus).toBe('blocked'); expect(result.current.error).toBe(copy.requestFailed);
  });
});
describe('designer data errors and real component integration', () => {
  it.each(['project','cad','visualization','presentation','handoff'] as const)('mounts the distinct %s entry without executing a task', async entry => {
    const view = render(<DesignHub initialView={entry} />);
    await waitFor(() => expect(screen.queryByText(copy.loading)).toBeNull());
    expect(view.container.querySelector(`[data-design-workspace="${entry}"]`)).toBeTruthy(); expect(mock.start).not.toHaveBeenCalled();
  });
  it('shows source failure, retains the independent stage read and retries only reads', async () => {
    mock.assets.mockRejectedValueOnce(new Error('Synthetic denied'));
    const { result } = renderHook(() => useDesignProjectResources('personal', project, 'en'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors).toEqual([copy.assetsFailed]); expect(result.current.workflow).toEqual(workflow);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.errors).toEqual([]); expect(mock.start).not.toHaveBeenCalled(); expect(mock.execute).not.toHaveBeenCalled();
  });
  it('retains successful sources when stage read fails and drops late data for the old project', async () => {
    mock.assets.mockResolvedValue([{ id: 'fixture-source' }]); mock.workflow.mockRejectedValue(new Error('Synthetic failure'));
    const { result, rerender } = renderHook(({ item }) => useDesignProjectResources('personal', item, 'en'), { initialProps: { item: project } });
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.assets).toHaveLength(1); expect(result.current.errors).toEqual([copy.workflowFailed]);
    const pending = deferred<any[]>(); mock.assets.mockReturnValueOnce(pending.promise); let refresh!: Promise<void>; act(() => { refresh = result.current.refresh(); });
    mock.assets.mockResolvedValue([]); rerender({ item: { ...project, id: 'new-project' } });
    await act(async () => { pending.resolve([{ id: 'old-source' }]); await refresh; });
    expect(result.current.assets).toEqual([]);
  });
  it('exposes current-project load failure and read-only retry before enabling work', async () => {
    mock.active.mockRejectedValueOnce(new Error('Synthetic denied'));
    render(<DesignHub initialView="cad" />);
    await screen.findByText(copy.activeFailed);
    fireEvent.change(screen.getByLabelText('Output requirement'), { target: { value: 'Fixture output' } });
    expect(screen.getByRole('button', { name: interiorDesignMessage('cadPlanButton', 'en') })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(screen.queryByText(copy.activeFailed)).toBeNull()); expect(mock.start).not.toHaveBeenCalled();
  });
  it('labels a delivered CAD result as previous input after editing a structured field', async () => {
    render(<DesignHub initialView="cad" />); await waitFor(() => expect(screen.queryByText(copy.loading)).toBeNull());
    fireEvent.change(screen.getByLabelText('Output requirement'), { target: { value: 'First drawing' } });
    fireEvent.click(screen.getByRole('button', { name: interiorDesignMessage('cadPlanButton', 'en') })); await screen.findByText('Fixture delivered result');
    expect(screen.queryByText(copy.draftChanged)).toBeNull();
    fireEvent.change(screen.getByLabelText('Output requirement'), { target: { value: 'Changed drawing' } });
    expect(screen.getByText(copy.draftChanged)).toBeTruthy(); expect(screen.getByText(/First drawing/, { selector: 'details p' })).toBeTruthy(); expect(mock.start).toHaveBeenCalledTimes(1);
  });
  it('remounts owned state on account change and rejects the prior late response', async () => {
    const pending = deferred<typeof task>(); mock.start.mockReturnValueOnce(pending.promise);
    const view = render(<DesignHub initialView="cad" />); await waitFor(() => expect(screen.queryByText(copy.loading)).toBeNull());
    fireEvent.change(screen.getByLabelText('Output requirement'), { target: { value: 'Old owner draft' } });
    fireEvent.click(screen.getByRole('button', { name: interiorDesignMessage('cadPlanButton', 'en') })); await waitFor(() => expect(mock.start).toHaveBeenCalled());
    mock.scope.user.uid = 'new-fixture-owner'; view.rerender(<DesignHub initialView="cad" />);
    await act(async () => pending.resolve(task)); expect(screen.getByLabelText('Output requirement')).toHaveProperty('value', ''); expect(mock.execute).not.toHaveBeenCalled();
  });
});
