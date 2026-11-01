import { useEffect, useRef, useState } from 'react';
import { startIndustryWorkflow, executeIndustryWorkflow, buildIndustryWorkflowIdempotencyKey } from '../lib/industryWorkflowClient';
import { withRequestDeadline } from '../lib/requestDeadline';
import { designerLifecycleCopy } from '../i18n/locales/designerLifecycle';

export interface DesignWorkflowInput { entryId: string; sourceInput: string; projectId?: string; projectName?: string }

/** One mounted user/domain/project owns the request; cancellation never starts a late chat. */
export function useDesignChat(locale: string, onWorkflowChange?: () => void | Promise<void>, scope = '') {
  const copy = designerLifecycleCopy(locale);
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [resultInput, setResultInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workflowTaskId, setWorkflowTaskId] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abortRef.current?.abort(); }; }, []);

  const stop = () => abortRef.current?.abort();
  const send = async (prompt: string, workflow: DesignWorkflowInput) => {
    if (!prompt.trim() || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const owns = () => mounted.current && abortRef.current === controller;
    setLoading(true); setResult(''); setResultInput(workflow.sourceInput); setError('');
    setWorkflowTaskId(''); setWorkflowStatus('creating');
    try {
      const idempotencyKey = await buildIndustryWorkflowIdempotencyKey({ entryId: workflow.entryId, sourceInput: `${workflow.sourceInput}\n${prompt}`, source: `${scope}:${workflow.projectId || 'standalone'}` });
      controller.signal.throwIfAborted();
      const started = await withRequestDeadline(signal => startIndustryWorkflow({
        entryId: workflow.entryId, sourceInput: workflow.sourceInput, idempotencyKey,
        source: workflow.projectId ? 'designer_project_workspace' : 'designer_standalone_workspace',
        context: workflow.projectId ? { projectId: workflow.projectId, projectName: workflow.projectName } : { mode: 'standalone' },
      }, signal), controller.signal, 30_000);
      controller.signal.throwIfAborted();
      if (!owns()) return;
      setWorkflowTaskId(started.task.id); setWorkflowStatus('in_progress');
      // Refresh failures have their own visible read-only error state.
      void Promise.resolve(onWorkflowChange?.()).catch(() => {});
      const completed = await withRequestDeadline(signal => executeIndustryWorkflow({
        taskId: started.task.id, sourceInput: workflow.sourceInput,
        prompt: `${started.handoffPrompt}\n\n${prompt}`, signal,
        onProgress: progress => { if (owns() && !signal.aborted) { setResult(progress.text); setWorkflowStatus(progress.status); } },
      }), controller.signal, 180_000);
      if (!owns()) return;
      setResult(completed.text); setWorkflowStatus(completed.status);
      if (completed.status === 'in_progress') setError(copy.incomplete);
    } catch (reason: any) {
      if (!owns()) return;
      const stopped = controller.signal.aborted;
      setWorkflowStatus(stopped ? 'stopped_locally' : reason?.name === 'TimeoutError' ? 'unconfirmed' : 'blocked');
      setError(stopped ? copy.stopped : reason?.name === 'TimeoutError' ? copy.timeout : copy.requestFailed);
    } finally {
      if (owns()) {
        abortRef.current = null; setLoading(false);
        void Promise.resolve(onWorkflowChange?.()).catch(() => {});
      }
    }
  };
  return { input, setInput, result, resultInput, staleResult: resultInput !== null && input !== resultInput,
    loading, workflowTaskId, workflowStatus, error, send, stop };
}
