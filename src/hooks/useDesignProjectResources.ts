import { useCallback, useEffect, useRef, useState } from 'react';
import { getInteriorProjectWorkflow, listInteriorProjectAssets, type InteriorProject, type InteriorProjectAsset, type InteriorProjectWorkflowState, type InteriorProjectDomain } from '../lib/interiorProjects';
import { designerLifecycleCopy } from '../i18n/locales/designerLifecycle';

export function useDesignProjectResources(domain: InteriorProjectDomain, project: InteriorProject | null, locale: string) {
  const [assets, setAssets] = useState<InteriorProjectAsset[]>([]);
  const [workflow, setWorkflow] = useState<InteriorProjectWorkflowState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const projectId = project?.id;
  const owner = `${domain}:${projectId || ''}`;
  const [resolvedOwner, setResolvedOwner] = useState('');
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    if (!projectId) { setAssets([]); setWorkflow(null); setErrors([]); setLoading(false); setResolvedOwner(owner); return; }
    setLoading(true); setErrors([]);
    const results = await Promise.allSettled([
      listInteriorProjectAssets(domain, projectId, controller.signal),
      getInteriorProjectWorkflow(domain, projectId, controller.signal),
    ]);
    if (controller.signal.aborted || request.current !== controller) return;
    const copy = designerLifecycleCopy(locale), nextErrors: string[] = [];
    if (results[0].status === 'fulfilled') setAssets(results[0].value); else nextErrors.push(copy.assetsFailed);
    if (results[1].status === 'fulfilled') setWorkflow(results[1].value); else nextErrors.push(copy.workflowFailed);
    setErrors(nextErrors); setLoading(false); setResolvedOwner(owner);
  }, [domain, projectId, locale, owner]);
  useEffect(() => {
    setAssets([]); setWorkflow(null);
    void refresh();
    return () => request.current?.abort();
  }, [refresh, project?.updatedAt]);
  const current = resolvedOwner === owner;
  return { assets: current ? assets : [], setAssets, workflow: current ? workflow : null,
    errors: current ? errors : [], loading: loading || !current, refresh };
}
