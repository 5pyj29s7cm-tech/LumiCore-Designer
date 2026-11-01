import React, { useEffect, useMemo, useState } from 'react';
import { designerLifecycleCopy } from '../../i18n/locales/designerLifecycle';
import { FolderOpen, Loader2, Pencil, Plus, Save, X } from 'lucide-react';
import {
  createInteriorProject,
  getActiveInteriorProject,
  listInteriorProjects,
  setActiveInteriorProject,
  updateInteriorProject,
  type InteriorProject,
  type InteriorProjectDomain,
  type InteriorProjectDraft,
  type InteriorProjectStatus,
  type InteriorProjectType,
} from '../../lib/interiorProjects';
import {
  interiorDesignMessage,
  type InteriorDesignLocale,
  type InteriorDesignMessageKey,
} from '../../i18n/locales/interiorDesign';

function emptyDraft(): InteriorProjectDraft {
  return {
    name: '',
    projectType: 'residential',
    status: 'brief',
    brief: {
      location: '',
      area: '',
      occupants: '',
      budget: '',
      style: '',
      requirements: '',
      constraints: '',
    },
  };
}

function draftFromProject(project: InteriorProject): InteriorProjectDraft {
  return {
    name: project.name,
    projectType: project.projectType,
    status: project.status,
    brief: { ...project.brief },
  };
}

interface InteriorProjectPanelProps {
  domain: InteriorProjectDomain;
  locale: InteriorDesignLocale;
  onProjectChange: (project: InteriorProject | null) => void;
}

export function InteriorProjectPanel({ domain, locale, onProjectChange }: InteriorProjectPanelProps) {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const [projects, setProjects] = useState<InteriorProject[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);
  const [draft, setDraft] = useState<InteriorProjectDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedId) || null,
    [projects, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([listInteriorProjects(domain, controller.signal), getActiveInteriorProject(domain, controller.signal)])
      .then(([items, activeProject]) => {
        if (cancelled) return;
        setProjects(items);
        const selected = items.find(project => project.id === activeProject?.id) || null;
        setSelectedId(selected?.id || '');
        onProjectChange(selected);
      })
      .catch(reason => {
        if (!cancelled) setError(`${m('projectLoadFailed')}：${reason?.message || reason}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  // The initial project load is scoped to the mounted workspace and locale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, locale, reload]);

  const chooseProject = async (projectId: string) => {
    const project = projects.find(item => item.id === projectId) || null;
    try {
      const persisted = await setActiveInteriorProject(domain, project?.id || null);
      setSelectedId(persisted?.id || '');
      setEditor(null);
      setError('');
      onProjectChange(persisted);
    } catch (reason: any) {
      setError(`${m('projectLoadFailed')}: ${reason?.message || reason}`);
    }
  };

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditor('create');
    setError('');
  };

  const openEdit = () => {
    if (!selectedProject) return;
    setDraft(draftFromProject(selectedProject));
    setEditor('edit');
    setError('');
  };

  const setBriefField = (field: keyof InteriorProjectDraft['brief'], value: string) => {
    setDraft(current => ({ ...current, brief: { ...current.brief, [field]: value } }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const project = editor === 'edit' && selectedProject
        ? await updateInteriorProject(domain, selectedProject.id, draft)
        : await createInteriorProject(domain, draft);
      const nextProjects = [project, ...projects.filter(item => item.id !== project.id)]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setProjects(nextProjects);
      setSelectedId(project.id);
      setEditor(null);
      onProjectChange(project);
    } catch (reason: any) {
      setError(`${m('projectSaveFailed')}：${reason?.message || reason}`);
    } finally {
      setSaving(false);
    }
  };

  const projectTypeLabels: Record<InteriorProjectType, string> = {
    residential: m('residence'),
    office: m('office'),
    retail: m('retail'),
    hospitality: m('hospitality'),
    other: m('otherProject'),
  };
  const statusLabels: Record<Exclude<InteriorProjectStatus, 'archived'>, string> = {
    brief: m('briefStage'),
    planning: m('planningStage'),
    design: m('designStage'),
    visualization: m('visualizationStage'),
    handoff: m('handoffStage'),
  };

  return (
    <section className="border-b border-white/[0.08] bg-black/20 px-6 py-4">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-white/45">
            <FolderOpen size={15} className="text-cyan-300/70" />
            {m('currentProject')}
          </span>
          <select
            value={selectedId}
            onChange={event => { void chooseProject(event.target.value); }}
            disabled={loading}
            aria-label={m('selectProject')}
            className="lumi-field min-w-52 flex-1 py-2 text-sm disabled:opacity-50"
          >
            <option value="">{loading ? m('loadingProjects') : m('standaloneTask')}</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          {selectedProject && (
            <span className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-bold text-cyan-100/80">
              {statusLabels[selectedProject.status as Exclude<InteriorProjectStatus, 'archived'>] || selectedProject.status}
            </span>
          )}
          <button type="button" onClick={openCreate} className="lumi-button px-3 py-2 text-xs text-white/70">
            <Plus size={14} />
            {m('createProject')}
          </button>
          <button
            type="button"
            onClick={openEdit}
            disabled={!selectedProject}
            className="lumi-button px-3 py-2 text-xs text-white/70 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Pencil size={14} />
            {m('editBrief')}
          </button>
        </div>

        {error && <div role="alert" className="mt-3 text-xs text-rose-300/90"><p>{error}</p><button type="button" disabled={loading} onClick={() => setReload(value => value + 1)} className="lumi-button mt-2">{designerLifecycleCopy(locale).retry}</button><p>{designerLifecycleCopy(locale).refreshOnly}</p></div>}
        {!loading && !selectedProject && !error && (
          <p className="mt-3 text-xs leading-relaxed text-cyan-100/45">{m('projectRequiredDescription')}</p>
        )}

        {editor && (
          <form onSubmit={save} className="mt-4 rounded-2xl border border-cyan-300/10 bg-cyan-950/10 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-white/85">
                {editor === 'create' ? m('newProjectTitle') : m('editProjectTitle')}
              </h3>
              <button type="button" onClick={() => setEditor(null)} className="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white/70" aria-label={m('cancel')}>
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('projectName')}</span>
                <input required maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={m('projectNamePlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('projectType')}</span>
                <select value={draft.projectType} onChange={event => setDraft(current => ({ ...current, projectType: event.target.value as InteriorProjectType }))} className="lumi-field w-full py-2.5 text-sm">
                  {(Object.keys(projectTypeLabels) as InteriorProjectType[]).map(type => <option key={type} value={type}>{projectTypeLabels[type]}</option>)}
                </select>
              </label>
              {editor === 'edit' && (
                <label className="space-y-1 text-xs font-bold text-white/50">
                  <span>{m('projectStatus')}</span>
                  <select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as InteriorProjectStatus }))} className="lumi-field w-full py-2.5 text-sm">
                    {(Object.keys(statusLabels) as Array<Exclude<InteriorProjectStatus, 'archived'>>).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
                  </select>
                </label>
              )}
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('location')}</span>
                <input maxLength={240} value={draft.brief.location} onChange={event => setBriefField('location', event.target.value)} placeholder={m('locationPlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('area')}</span>
                <input maxLength={120} value={draft.brief.area} onChange={event => setBriefField('area', event.target.value)} placeholder={m('areaPlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('occupants')}</span>
                <input maxLength={240} value={draft.brief.occupants} onChange={event => setBriefField('occupants', event.target.value)} placeholder={m('occupantsPlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('budget')}</span>
                <input maxLength={240} value={draft.brief.budget} onChange={event => setBriefField('budget', event.target.value)} placeholder={m('budgetPlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50 md:col-span-2">
                <span>{m('style')}</span>
                <input maxLength={600} value={draft.brief.style} onChange={event => setBriefField('style', event.target.value)} placeholder={m('stylePlaceholder')} className="lumi-field w-full py-2.5 text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('requirements')}</span>
                <textarea rows={4} maxLength={6000} value={draft.brief.requirements} onChange={event => setBriefField('requirements', event.target.value)} placeholder={m('requirementsPlaceholder')} className="lumi-field w-full resize-y text-sm" />
              </label>
              <label className="space-y-1 text-xs font-bold text-white/50">
                <span>{m('constraints')}</span>
                <textarea rows={4} maxLength={6000} value={draft.brief.constraints} onChange={event => setBriefField('constraints', event.target.value)} placeholder={m('constraintsPlaceholder')} className="lumi-field w-full resize-y text-sm" />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button type="submit" disabled={saving || !draft.name.trim()} className="lumi-button-primary border-cyan-400/25 bg-cyan-500/15 px-4 py-2.5 text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {saving ? m('saving') : editor === 'create' ? m('saveProject') : m('saveChanges')}
              </button>
              <button type="button" onClick={() => setEditor(null)} className="lumi-button px-4 py-2.5 text-white/60">{m('cancel')}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
