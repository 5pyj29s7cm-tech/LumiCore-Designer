import React, { useMemo, useState } from 'react';
import {
  CheckCircle,
  FileText,
  Layout,
  Loader2,
  Ruler,
  Send,
  Sparkles,
  Square,
} from 'lucide-react';
import { useT } from '../../lib/useT';
import type {
  InteriorAssetCategory,
  InteriorProject,
  InteriorProjectAsset,
  InteriorProjectStatus,
  InteriorProjectType,
  InteriorProjectWorkflowState,
} from '../../lib/interiorProjects';
import { getActiveInteriorProject } from '../../lib/interiorProjects';
import {
  interiorDesignMessage,
  type InteriorDesignLocale,
  type InteriorDesignMessageKey,
} from '../../i18n/locales/interiorDesign';
import { designerWorkspaceText } from '../../i18n/locales/designerWorkspaces';
import { InteriorProjectPanel } from './InteriorProjectPanel';
import { InteriorProjectAssets } from './InteriorProjectAssets';
import { useDesignChat } from '../../hooks/useDesignChat';
import { useDesignProjectResources } from '../../hooks/useDesignProjectResources';
import { designerLifecycleCopy } from '../../i18n/locales/designerLifecycle';
import { useApp } from '../../contexts/AppContext';

export type DesignView =
  | 'project'
  | 'cad'
  | 'visualization'
  | 'presentation'
  | 'handoff';

interface NavItem {
  id: DesignView;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

interface ToolConfig {
  title: string;
  desc: string;
  placeholder: string;
  button: string;
  role: string;
  output: string[];
  chips: string[];
  icon: React.ReactNode;
}

const VIEW_PRESENTATION: Record<DesignView, {
  shell: string;
  sidebar: string;
  canvas: string;
  brand: string;
  activeNav: string;
  context: string;
}> = {
  project: {
    shell: 'bg-[#071116]',
    sidebar: 'bg-[linear-gradient(180deg,rgba(8,47,73,0.34),rgba(0,0,0,0.24))]',
    canvas: 'bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.08),transparent_36%),rgba(0,0,0,0.10)]',
    brand: 'border-cyan-300/20 bg-cyan-400/12 text-cyan-100',
    activeNav: 'border-cyan-300/25 bg-cyan-400/12 text-cyan-50 shadow-[0_12px_30px_rgba(8,145,178,0.08)]',
    context: 'border-cyan-300/14 bg-cyan-400/[0.055]',
  },
  cad: {
    shell: 'bg-[#12100a]',
    sidebar: 'bg-[linear-gradient(180deg,rgba(120,53,15,0.24),rgba(0,0,0,0.26))]',
    canvas: 'bg-[linear-gradient(rgba(251,191,36,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.025)_1px,transparent_1px),rgba(0,0,0,0.10)] bg-[size:28px_28px]',
    brand: 'border-amber-300/20 bg-amber-400/12 text-amber-100',
    activeNav: 'border-amber-300/25 bg-amber-400/12 text-amber-50 shadow-[0_12px_30px_rgba(217,119,6,0.08)]',
    context: 'border-amber-300/14 bg-amber-400/[0.055]',
  },
  visualization: {
    shell: 'bg-[#110a15]',
    sidebar: 'bg-[linear-gradient(180deg,rgba(112,26,117,0.24),rgba(0,0,0,0.28))]',
    canvas: 'bg-[radial-gradient(circle_at_72%_8%,rgba(217,70,239,0.12),transparent_34%),radial-gradient(circle_at_20%_45%,rgba(124,58,237,0.07),transparent_30%),rgba(0,0,0,0.08)]',
    brand: 'border-fuchsia-300/20 bg-fuchsia-400/12 text-fuchsia-100',
    activeNav: 'border-fuchsia-300/25 bg-fuchsia-400/12 text-fuchsia-50 shadow-[0_12px_30px_rgba(192,38,211,0.09)]',
    context: 'border-fuchsia-300/14 bg-fuchsia-400/[0.055]',
  },
  presentation: {
    shell: 'bg-[#0a101a]',
    sidebar: 'bg-[linear-gradient(180deg,rgba(30,64,175,0.22),rgba(0,0,0,0.27))]',
    canvas: 'bg-[radial-gradient(circle_at_50%_-10%,rgba(59,130,246,0.13),transparent_34%),rgba(0,0,0,0.08)]',
    brand: 'border-blue-300/20 bg-blue-400/12 text-blue-100',
    activeNav: 'border-blue-300/25 bg-blue-400/12 text-blue-50 shadow-[0_12px_30px_rgba(37,99,235,0.09)]',
    context: 'border-blue-300/14 bg-blue-400/[0.055]',
  },
  handoff: {
    shell: 'bg-[#07120f]',
    sidebar: 'bg-[linear-gradient(180deg,rgba(6,95,70,0.24),rgba(0,0,0,0.28))]',
    canvas: 'bg-[radial-gradient(circle_at_82%_0%,rgba(16,185,129,0.11),transparent_34%),rgba(0,0,0,0.08)]',
    brand: 'border-emerald-300/20 bg-emerald-400/12 text-emerald-100',
    activeNav: 'border-emerald-300/25 bg-emerald-400/12 text-emerald-50 shadow-[0_12px_30px_rgba(5,150,105,0.09)]',
    context: 'border-emerald-300/14 bg-emerald-400/[0.055]',
  },
};

export function DesignHub({ initialView = 'project' }: { initialView?: DesignView } = {}) {
  const { user, workDomain, orgConnection } = useApp();
  const owner = [user?.uid, user?.role, workDomain, orgConnection?.orgId, orgConnection?.orgRole].join(':');
  return <ScopedDesignHub key={owner} initialView={initialView} owner={owner} />;
}

function ScopedDesignHub({ initialView, owner }: { initialView: DesignView; owner: string }) {
  const [view, setView] = useState<DesignView>(initialView);
  const [activeProject, setActiveProject] = useState<InteriorProject | null>(null);
  const t = useT();
  const { workDomain } = useApp();
  const locale: InteriorDesignLocale = t.langCode === 'en' ? 'en' : 'zh';
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);

  React.useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const copy = designerLifecycleCopy(locale);
  const [activeError, setActiveError] = useState(false);
  const [activeLoading, setActiveLoading] = useState(true);
  const [activeRevision, setActiveRevision] = useState(0);
  const { assets: projectAssets, setAssets: setProjectAssets, workflow: projectWorkflow, errors: resourceErrors, loading: resourcesLoading, refresh: refreshProjectWorkflow } = useDesignProjectResources(workDomain, activeProject, locale);
  React.useEffect(() => {
    const controller = new AbortController();
    setActiveLoading(true); setActiveError(false);
    getActiveInteriorProject(workDomain, controller.signal)
      .then(project => { if (!controller.signal.aborted) setActiveProject(project); })
      .catch(() => { if (!controller.signal.aborted) setActiveError(true); })
      .finally(() => { if (!controller.signal.aborted) setActiveLoading(false); });
    return () => controller.abort();
  }, [workDomain, activeRevision]);
  const refreshResources = () => {
    if (activeError) setActiveRevision(value => value + 1);
    else void refreshProjectWorkflow();
  };

  const tools = useMemo<Record<DesignView, ToolConfig>>(() => ({
    project: {
      title: m('designProjectTitle'),
      desc: m('designProjectDescription'),
      placeholder: m('designProjectPlaceholder'),
      button: m('designProjectButton'),
      role: m('designProjectRole'),
      output: [m('concept'), m('layout'), m('planningRisks'), m('implementation')],
      chips: [m('office'), m('residence'), m('retail'), m('hospitality')],
      icon: <Layout size={18} />,
    },
    cad: {
      title: m('cadPlanTitle'),
      desc: m('cadPlanDescription'),
      placeholder: m('cadPlanPlaceholder'),
      button: m('cadPlanButton'),
      role: m('cadPlanRole'),
      output: [m('fixedConditions'), m('zoning'), m('keyDimensions'), m('verificationList')],
      chips: [m('floorPlan'), m('loadBearing'), m('doorsWindows'), m('mep')],
      icon: <Ruler size={18} />,
    },
    visualization: {
      title: m('visualizationTitle'),
      desc: m('visualizationDescription'),
      placeholder: m('visualizationPlaceholder'),
      button: m('visualizationButton'),
      role: m('visualizationRole'),
      output: [m('cameraComposition'), m('renderLighting'), m('renderMaterials'), m('generationPrompt')],
      chips: [m('livingRoom'), m('bedroom'), m('restaurant'), m('showroom')],
      icon: <Sparkles size={18} />,
    },
    presentation: {
      title: m('proposalPptTitle'),
      desc: m('proposalPptDescription'),
      placeholder: m('proposalPptPlaceholder'),
      button: m('proposalPptButton'),
      role: m('proposalPptRole'),
      output: [m('proposalStructure'), m('slideStoryline'), m('visualAssetChecklist'), m('verifiedPresentationFile')],
      chips: [m('concept'), m('layout'), m('palette'), m('implementation')],
      icon: <FileText size={18} />,
    },
    handoff: {
      title: m('handoffTitle'),
      desc: m('handoffDescription'),
      placeholder: m('handoffPlaceholder'),
      button: m('handoffButton'),
      role: m('handoffRole'),
      output: [m('drawingList'), m('keyDimensions'), m('consultantCoordination'), m('qaChecklist')],
      chips: [m('floorPlan'), m('elevations'), m('reflectedCeiling'), m('materialSchedule')],
      icon: <CheckCircle size={18} />,
    },
  // `m` is derived only from locale, so locale is the stable memo boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [locale]);

  const navItems: NavItem[] = (Object.keys(tools) as DesignView[]).map(id => ({
    id,
    label: tools[id].title,
    desc: tools[id].desc,
    icon: tools[id].icon,
  }));
  const presentation = VIEW_PRESENTATION[view];

  return (
    <div data-organization-wallpaper-module="design" className={`lumi-org-module-shell lumi-design-hub flex h-full min-h-0 transition-colors duration-300 ${presentation.shell}`} data-design-workspace={view}>
      <aside data-wallpaper-tool="organization-module-tools" className={`lumi-org-module-tools lumi-design-sidebar flex w-64 shrink-0 flex-col border-r border-white/[0.08] ${presentation.sidebar}`}>
        <div className="lumi-org-module-tool-header border-b border-white/[0.08] p-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-white/85">
            <span className={`flex h-8 w-8 items-center justify-center rounded-xl border ${presentation.brand}`}>
              <Layout size={16} />
            </span>
            <span className="lumi-org-module-tool-copy min-w-0 truncate">{m('workspaceTitle')}</span>
          </h3>
          <p className="lumi-org-module-tool-copy mt-2 text-xs leading-relaxed text-white/40">{m('workspaceDescription')}</p>
          <span className="lumi-org-module-tool-copy mt-3 inline-flex rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200/80">
            {m('scopeBadge')}
          </span>
        </div>
        <nav className="lumi-org-module-tool-nav custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`lumi-org-module-tool-button flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                view === item.id
                  ? presentation.activeNav
                  : 'border-transparent text-white/50 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white/80'
              }`}
            >
              <span className="lumi-org-module-tool-icon mt-0.5 shrink-0">{item.icon}</span>
              <span className="lumi-org-module-tool-copy min-w-0">
                <span className="block truncate text-sm font-bold">{item.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-white/35">{item.desc}</span>
              </span>
              {activeProject && projectWorkflow && (
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    projectWorkflow.stages[item.id].status === 'completed'
                      ? 'bg-emerald-300'
                      : projectWorkflow.stages[item.id].status === 'blocked'
                        ? 'bg-rose-300'
                        : ['in_progress', 'waiting_confirmation'].includes(projectWorkflow.stages[item.id].status)
                          ? 'bg-amber-300'
                          : 'bg-white/15'
                  }`}
                  title={`${item.label}: ${projectWorkflow.stages[item.id].status}`}
                />
              )}
            </button>
          ))}
        </nav>
      </aside>
      <main data-wallpaper-tool="organization-module-workspace" className={`lumi-org-module-workspace lumi-design-workspace custom-scrollbar min-w-0 flex-1 overflow-y-auto ${presentation.canvas}`}>
        {(activeLoading || resourcesLoading) && <p role="status" className="px-6 py-3 text-sm text-white/60">{copy.loading}</p>}
        {(activeError || resourceErrors.length > 0) && <div role="alert" className="px-6 py-3 text-sm text-amber-200">
          {activeError && <p>{copy.activeFailed}</p>}
          {resourceErrors.map(error => <p key={error}>{error}</p>)}
          <button type="button" disabled={activeLoading || resourcesLoading} onClick={refreshResources} className="lumi-button mt-2">{copy.retry}</button>
          <p className="mt-1 text-xs">{copy.refreshOnly}</p>
        </div>}
        {view === 'project' ? (
          <InteriorProjectPanel
            domain={workDomain}
            locale={locale}
            onProjectChange={project => {
              setActiveProject(project);
              setProjectAssets([]);
              setActiveError(false);
            }}
          />
        ) : (
          <section className={`flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3 ${presentation.context}`}>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{designerWorkspaceText(locale, 'Project cockpit')}</p>
              <p className="mt-1 truncate text-sm font-black text-white/75">{activeProject?.name || designerWorkspaceText(locale, 'No project bound')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-black/15 px-3 py-1.5 text-[11px] font-bold text-white/45">
                {activeProject ? `${projectAssets.length} ${designerWorkspaceText(locale, 'files')}` : designerWorkspaceText(locale, 'Standalone')}
              </span>
              <button type="button" onClick={() => setView('project')} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white/65 transition-colors hover:bg-white/10 hover:text-white">
                {m('designProjectTitle')}
              </button>
            </div>
          </section>
        )}
        {activeProject && view === 'project' && (
          <InteriorProjectAssets key={`${workDomain}:${activeProject.id}`} domain={workDomain} project={activeProject} locale={locale} onAssetsChange={setProjectAssets} />
        )}
        {activeProject && projectWorkflow && (
          <ProjectWorkflowStrip
            workflow={projectWorkflow}
            tools={tools}
            activeView={view}
            onSelect={setView}
          />
        )}
        <DesignToolView
          key={`${activeProject?.id || 'standalone'}:${activeProject?.updatedAt || ''}:${view}`}
          config={tools[view]}
          entryId={view}
          locale={locale}
          project={activeProject}
          assets={activeProject ? projectAssets : []}
          workflow={activeProject ? projectWorkflow : null}
          onWorkflowChange={refreshProjectWorkflow}
          blocked={activeLoading || resourcesLoading || activeError || resourceErrors.length > 0}
          owner={owner}
        />
      </main>
    </div>
  );
}

function formatProjectContext(project: InteriorProject, locale: InteriorDesignLocale): string {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const projectTypes: Record<InteriorProjectType, string> = {
    residential: m('residence'),
    office: m('office'),
    retail: m('retail'),
    hospitality: m('hospitality'),
    other: m('otherProject'),
  };
  const statuses: Record<InteriorProjectStatus, string> = {
    brief: m('briefStage'),
    planning: m('planningStage'),
    design: m('designStage'),
    visualization: m('visualizationStage'),
    handoff: m('handoffStage'),
    archived: 'Archived',
  };
  const rows: Array<[string, string]> = [
    [m('projectName'), project.name],
    [m('projectType'), projectTypes[project.projectType]],
    [m('projectStatus'), statuses[project.status]],
    [m('location'), project.brief.location],
    [m('area'), project.brief.area],
    [m('occupants'), project.brief.occupants],
    [m('budget'), project.brief.budget],
    [m('style'), project.brief.style],
    [m('requirements'), project.brief.requirements],
    [m('constraints'), project.brief.constraints],
  ];
  return rows.filter(([, value]) => value.trim()).map(([label, value]) => `- ${label}: ${value}`).join('\n');
}

function formatProjectAssets(assets: InteriorProjectAsset[], locale: InteriorDesignLocale): string {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const categoryLabels: Record<InteriorAssetCategory, string> = {
    'floor-plan': m('floorPlanAsset'),
    cad: m('cadAsset'),
    'site-photo': m('sitePhotoAsset'),
    material: m('materialAsset'),
    reference: m('referenceAsset'),
    other: m('otherAsset'),
  };
  return assets.map(asset => `- ${categoryLabels[asset.category]}: ${asset.displayName}`).join('\n');
}

interface DesignToolViewProps {
  blocked?: boolean;
  owner?: string;
  config: ToolConfig;
  entryId: DesignView;
  locale: InteriorDesignLocale;
  project: InteriorProject | null;
  assets: InteriorProjectAsset[];
  workflow: InteriorProjectWorkflowState | null;
  onWorkflowChange: () => void | Promise<void>;
}

function ProjectWorkflowStrip({ workflow, tools, activeView, onSelect }: {
  workflow: InteriorProjectWorkflowState;
  tools: Record<DesignView, ToolConfig>;
  activeView: DesignView;
  onSelect: (view: DesignView) => void;
}) {
  const statusClass = (status: string) => status === 'completed'
    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
    : status === 'blocked'
      ? 'border-rose-300/20 bg-rose-400/10 text-rose-100'
      : ['in_progress', 'waiting_confirmation'].includes(status)
        ? 'border-amber-300/20 bg-amber-400/10 text-amber-100'
        : 'border-white/[0.07] bg-white/[0.025] text-white/45';
  return (
    <section className="border-b border-white/[0.08] bg-black/15 px-6 py-3">
      <div className="mx-auto grid max-w-6xl gap-2 sm:grid-cols-5">
        {(Object.keys(tools) as DesignView[]).map((entryId, index) => {
          const stage = workflow.stages[entryId];
          return (
            <button
              key={entryId}
              type="button"
              onClick={() => onSelect(entryId)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${statusClass(stage.status)} ${activeView === entryId ? 'ring-1 ring-cyan-300/30' : ''}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black opacity-45">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-[10px] font-mono opacity-45">{stage.receiptIds.length}R</span>
              </span>
              <span className="mt-1 block truncate text-xs font-black">{tools[entryId].title}</span>
              <span className="mt-0.5 block truncate text-[10px] opacity-55">{stage.status}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DesignToolView(props: DesignToolViewProps) {
  if (props.entryId === 'project') return <ProjectWorkspace {...props} />;
  if (props.entryId === 'cad') return <CadWorkspace {...props} />;
  if (props.entryId === 'visualization') return <VisualizationWorkspace {...props} />;
  if (props.entryId === 'presentation') return <PresentationWorkspace {...props} />;
  return <HandoffWorkspace {...props} />;
}

function GenericDesignToolView({
  config,
  entryId,
  locale,
  project,
  assets,
  onWorkflowChange,
  blocked,
  owner,
}: DesignToolViewProps) {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const { input, setInput, result, resultInput, staleResult, loading, workflowTaskId, workflowStatus, error, send, stop } = useDesignChat(locale, onWorkflowChange, owner);
  const copy = designerLifecycleCopy(locale);

  const run = () => {
    if (blocked) return;
    const outputGuide = config.output.map(item => `- ${item}`).join('\n');
    const projectContext = project ? formatProjectContext(project, locale) : m('standaloneContext');
    const assetContext = project ? formatProjectAssets(assets, locale) : '';
    const assetSection = assetContext ? `\n\n${m('projectSources')}\n${assetContext}` : '';
    void send(
      `${config.role}\n\n${m('scopeGuard')}\n\n${m('projectContext')}\n${projectContext}${assetSection}\n\n${m('outputInstruction')}\n${outputGuide}\n\n${m('userRequirement')}\n${input}`,
      {
        entryId,
        sourceInput: input,
        ...(project ? { projectId: project.id, projectName: project.name } : {}),
      },
    );
  };

  return (
    <div className="lumi-design-tool mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <section className="border-b border-white/[0.08] pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-cyan-200">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-200">
                {config.icon}
              </span>
              <h2 className="text-xl font-black tracking-tight text-white">{config.title}</h2>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-white/55">{config.desc}</p>
          </div>
          <div className="hidden shrink-0 gap-2 lg:flex">
            <span className="max-w-48 truncate rounded-full border border-cyan-300/10 bg-cyan-400/[0.06] px-3 py-1 text-[12px] font-bold text-cyan-100/55">
              {project?.name || m('standaloneTask')}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[12px] font-bold uppercase tracking-[0.12em] text-white/45">
              {m('schemeBadge')}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[12px] font-bold uppercase tracking-[0.12em] text-white/45">
              {m('deliverableBadge')}
            </span>
          </div>
        </div>
      </section>

      {workflowTaskId && (
        <div className="rounded-xl border border-emerald-300/12 bg-emerald-400/[0.05] px-3 py-2 text-[11px] font-mono text-emerald-100/55">
          task {workflowTaskId} · {workflowStatus || 'in_progress'}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {staleResult && <p role="status" className="text-sm text-amber-200">{copy.draftChanged}</p>}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={config.placeholder}
            rows={8}
            className="lumi-field min-h-56 w-full resize-none focus:border-cyan-500/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            {config.chips.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setInput(previous => previous ? `${previous}\n${chip}` : chip)}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/55 transition-colors hover:border-cyan-400/25 hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={run}
              disabled={loading || blocked || !input.trim()}
              className="lumi-button-primary border-cyan-400/25 bg-cyan-500/15 px-6 py-3 text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {loading ? m('working') : config.button}
            </button>
            {loading && (
              <button type="button" onClick={stop} className="lumi-button px-4 py-3 text-white/65">
                <Square size={14} />
                {m('stop')}
              </button>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            <Ruler size={14} />
            {m('outputStructure')}
          </h4>
          <div className="grid gap-2">
            {config.output.map(item => (
              <div key={item} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-2 text-sm text-white/65">
                <FileText size={14} className="shrink-0 text-cyan-300/70" />
                <span className="min-w-0 truncate">{item}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      {result && (
        <section className="lumi-design-result lumi-panel custom-scrollbar max-h-[560px] overflow-y-auto p-5 text-sm leading-relaxed whitespace-pre-wrap text-white/80">
          <details className="mb-3 text-xs text-white/55"><summary>{copy.resultBrief}</summary><p>{resultInput}</p></details>
          {result}
        </section>
      )}
    </div>
  );
}

function ProjectWorkspace(props: DesignToolViewProps) {
  const { locale, project, assets } = props;
  const stageLabels: Record<InteriorProjectStatus, string> = {
    brief: designerWorkspaceText(locale, "Brief"),
    planning: designerWorkspaceText(locale, "Planning"),
    design: designerWorkspaceText(locale, "Design"),
    visualization: designerWorkspaceText(locale, "Visualization"),
    handoff: designerWorkspaceText(locale, "Handoff"),
    archived: designerWorkspaceText(locale, "Archived"),
  };
  return (
    <div>
      <section className="mx-auto grid max-w-5xl gap-3 px-6 pt-6 sm:grid-cols-3">
        <article className="rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.05] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/45">{designerWorkspaceText(locale, "Project cockpit")}</p>
          <p className="mt-2 text-lg font-black text-cyan-50">{project ? stageLabels[project.status] : designerWorkspaceText(locale, "Standalone")}</p>
        </article>
        <article className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{designerWorkspaceText(locale, "Project evidence")}</p>
          <p className="mt-2 text-lg font-black text-white/80">{assets.length} {designerWorkspaceText(locale, "files")}</p>
        </article>
        <article className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{designerWorkspaceText(locale, "Continuity")}</p>
          <p className="mt-2 truncate text-lg font-black text-white/80">{project?.name || designerWorkspaceText(locale, "No project bound")}</p>
        </article>
      </section>
      <GenericDesignToolView {...props} />
    </div>
  );
}

function useStageWorkflow(props: DesignToolViewProps) {
  const { config, entryId, locale, project, assets } = props;
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const chat = useDesignChat(locale, props.onWorkflowChange, props.owner);
  const run = (details: string) => {
    if (props.blocked) return;
    const projectContext = project ? formatProjectContext(project, locale) : m('standaloneContext');
    const assetContext = project ? formatProjectAssets(assets, locale) : '';
    const outputGuide = config.output.map(item => `- ${item}`).join('\n');
    void chat.send(
      `${config.role}\n\n${m('scopeGuard')}\n\n${m('projectContext')}\n${projectContext}${assetContext ? `\n\n${m('projectSources')}\n${assetContext}` : ''}\n\n${m('outputInstruction')}\n${outputGuide}\n\n${m('userRequirement')}\n${details}`,
      {
        entryId,
        sourceInput: details,
        ...(project ? { projectId: project.id, projectName: project.name } : {}),
      },
    );
  };
  return { chat, run };
}

function StageHeader({ config, project, eyebrow, accent }: {
  config: ToolConfig;
  project: InteriorProject | null;
  eyebrow: string;
  accent: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
      <div className="min-w-0">
        <div className={`mb-2 flex items-center gap-3 ${accent}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-current/20 bg-current/10">{config.icon}</span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-55">{eyebrow}</p>
            <h2 className="text-xl font-black tracking-tight text-white">{config.title}</h2>
          </div>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-white/50">{config.desc}</p>
      </div>
      <span className="max-w-64 truncate rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/55">{project?.name || 'Standalone'}</span>
    </header>
  );
}

function StageRunBar({ chat, button, disabled, onRun, className, locale, currentInput }: {
  chat: ReturnType<typeof useDesignChat>;
  currentInput: string;
  button: string;
  disabled: boolean;
  onRun: () => void;
  className: string;
  locale: InteriorDesignLocale;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-4">
        <button type="button" onClick={onRun} disabled={chat.loading || disabled} className={`lumi-button-primary px-6 py-3 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
          {chat.loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {chat.loading ? designerWorkspaceText(locale, 'Lumi is working') : button}
        </button>
        {chat.loading && <button type="button" onClick={chat.stop} className="lumi-button px-4 py-3 text-white/65"><Square size={14} />{designerWorkspaceText(locale, 'Stop')}</button>}
        {chat.workflowTaskId && <span className="rounded-full border border-emerald-300/12 bg-emerald-400/[0.05] px-3 py-1.5 text-[11px] font-mono text-emerald-100/60">{chat.workflowStatus || 'in_progress'} · {chat.workflowTaskId.slice(0, 12)}</span>}
      </div>
      {chat.error && <p role="alert" className="text-sm text-amber-200">{chat.error}</p>}
      {chat.resultInput !== null && currentInput !== chat.resultInput && <p role="status" className="text-sm text-amber-200">{designerLifecycleCopy(locale).draftChanged}</p>}
      {chat.result && <section className="lumi-panel custom-scrollbar max-h-[560px] overflow-y-auto whitespace-pre-wrap p-5 text-sm leading-relaxed text-white/80"><details className="mb-3 text-xs text-white/55"><summary>{designerLifecycleCopy(locale).resultBrief}</summary><p>{chat.resultInput}</p></details>{chat.result}</section>}
    </>
  );
}

function CadWorkspace(props: DesignToolViewProps) {
  const { config, locale, project, assets } = props;
  const { chat, run } = useStageWorkflow(props);
  const [drawingType, setDrawingType] = useState(designerWorkspaceText(locale, "Floor plan"));
  const [output, setOutput] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [constraints, setConstraints] = useState('');
  const sources = assets.filter(asset => asset.category === 'cad' || asset.category === 'floor-plan' || /\.(dwg|dxf|ifc|rvt|pdf)$/i.test(asset.displayName));
  const checks = [designerWorkspaceText(locale, "Grid, structure, and fixed conditions"), designerWorkspaceText(locale, "Key dimensions and closure"), designerWorkspaceText(locale, "Fire, MEP, and opening conflicts"), designerWorkspaceText(locale, "Openable file and geometry receipt")];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <StageHeader config={config} project={project} eyebrow={designerWorkspaceText(locale, "Drawing desk")} accent="text-amber-200" />
      <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <aside className="rounded-2xl border border-amber-300/12 bg-amber-400/[0.045] p-4">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-amber-100/60"><FileText size={14} />{designerWorkspaceText(locale, "Drawing sources")}</h3>
          <div className="mt-3 space-y-2">{sources.length ? sources.slice(0, 8).map(asset => <div key={asset.id} className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5"><p className="truncate text-sm font-bold text-white/70">{asset.displayName}</p><p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-amber-100/35">{asset.category}</p></div>) : <p className="rounded-xl border border-dashed border-amber-300/15 px-3 py-5 text-center text-xs leading-relaxed text-amber-100/40">{designerWorkspaceText(locale, "No CAD, PDF, or base plan is bound. Describe a standalone task first.")}</p>}</div>
        </aside>
        <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Drawing type")}</span><select value={drawingType} onChange={event => setDrawingType(event.target.value)} className="lumi-field mt-2 w-full py-2.5 text-sm"><option>{designerWorkspaceText(locale, "Floor plan")}</option><option>{designerWorkspaceText(locale, "Reflected ceiling")}</option><option>{designerWorkspaceText(locale, "Elevation")}</option><option>{designerWorkspaceText(locale, "Detail")}</option></select></label>
            <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Output requirement")}</span><input value={output} onChange={event => setOutput(event.target.value)} placeholder={designerWorkspaceText(locale, "e.g. DWG + dimension checklist")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          </div>
          <label className="mt-4 block text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Known dimensions and survey basis")}</span><textarea value={dimensions} onChange={event => setDimensions(event.target.value)} rows={5} placeholder={designerWorkspaceText(locale, "Enter verified grids, spans, heights, openings, and service points")} className="lumi-field mt-2 w-full resize-y" /></label>
          <label className="mt-4 block text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Fixed conditions and conflicts")}</span><textarea value={constraints} onChange={event => setConstraints(event.target.value)} rows={5} placeholder={config.placeholder} className="lumi-field mt-2 w-full resize-y" /></label>
        </div>
        <aside className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4"><h3 className="text-xs font-black uppercase tracking-[0.14em] text-white/45">{designerWorkspaceText(locale, "Pre-drawing checks")}</h3><div className="mt-3 space-y-2">{checks.map((check, index) => <div key={check} className="flex gap-3 rounded-xl border border-white/[0.06] px-3 py-3 text-sm text-white/60"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-300/20 text-[10px] font-black text-amber-200">{index + 1}</span><span>{check}</span></div>)}</div></aside>
      </section>
      <StageRunBar locale={locale} chat={chat} button={config.button} disabled={Boolean(props.blocked) || (!output.trim() && !dimensions.trim() && !constraints.trim())} currentInput={`${designerWorkspaceText(locale, "Drawing type")}: ${drawingType}\n${designerWorkspaceText(locale, "Output")}: ${output}\n${designerWorkspaceText(locale, "Dimensions")}: ${dimensions}\n${designerWorkspaceText(locale, "Fixed conditions and conflicts")}: ${constraints}`} onRun={() => run(`${designerWorkspaceText(locale, "Drawing type")}: ${drawingType}\n${designerWorkspaceText(locale, "Output")}: ${output}\n${designerWorkspaceText(locale, "Dimensions")}: ${dimensions}\n${designerWorkspaceText(locale, "Fixed conditions and conflicts")}: ${constraints}`)} className="border-amber-400/25 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25" />
    </div>
  );
}

function VisualizationWorkspace(props: DesignToolViewProps) {
  const { config, locale, project, assets } = props;
  const { chat, run } = useStageWorkflow(props);
  const [space, setSpace] = useState('');
  const [style, setStyle] = useState('');
  const [lighting, setLighting] = useState('');
  const [materials, setMaterials] = useState('');
  const [brief, setBrief] = useState('');
  const views = [designerWorkspaceText(locale, "Hero view"), designerWorkspaceText(locale, "Spatial relation"), designerWorkspaceText(locale, "Material detail"), designerWorkspaceText(locale, "Lighting mood")];
  const references = assets.filter(asset => asset.mimeType.startsWith('image/') || ['site-photo', 'material', 'reference'].includes(asset.category)).length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <StageHeader config={config} project={project} eyebrow={designerWorkspaceText(locale, "Visualization studio")} accent="text-fuchsia-200" />
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">
          <label className="rounded-2xl border border-fuchsia-300/10 bg-fuchsia-400/[0.04] p-4 text-xs font-bold text-fuchsia-100/55"><span>{designerWorkspaceText(locale, "Space and camera")}</span><input value={space} onChange={event => setSpace(event.target.value)} placeholder={designerWorkspaceText(locale, "Hero view, entrance reverse view")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="rounded-2xl border border-fuchsia-300/10 bg-fuchsia-400/[0.04] p-4 text-xs font-bold text-fuchsia-100/55"><span>{designerWorkspaceText(locale, "Style direction")}</span><input value={style} onChange={event => setStyle(event.target.value)} placeholder={designerWorkspaceText(locale, "Natural modern, restrained sci-fi")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Lighting and time")}</span><input value={lighting} onChange={event => setLighting(event.target.value)} placeholder={designerWorkspaceText(locale, "Afternoon daylight, warm evening light")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Key materials")}</span><input value={materials} onChange={event => setMaterials(event.target.value)} placeholder={designerWorkspaceText(locale, "Wood veneer, microcement, metal")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
        </div><textarea value={brief} onChange={event => setBrief(event.target.value)} rows={6} placeholder={config.placeholder} className="lumi-field w-full resize-y" /></div>
        <aside className="overflow-hidden rounded-2xl border border-fuchsia-300/12 bg-gradient-to-br from-fuchsia-950/25 to-violet-950/20 p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-[0.14em] text-fuchsia-100/55">{designerWorkspaceText(locale, "Shot board")}</h3><span className="text-[11px] text-white/30">{references} refs</span></div><div className="mt-4 grid grid-cols-2 gap-3">{views.map((label, index) => <div key={label} className="flex aspect-[4/3] flex-col justify-between rounded-2xl border border-white/[0.08] bg-black/25 p-3"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-fuchsia-100/35">VIEW {String(index + 1).padStart(2, '0')}</span><Sparkles size={20} className="self-center text-fuchsia-200/25" /><span className="text-xs font-bold text-white/55">{label}</span></div>)}</div></aside>
      </section>
      <StageRunBar locale={locale} chat={chat} button={config.button} disabled={Boolean(props.blocked) || (!space.trim() && !style.trim() && !brief.trim())} currentInput={`${designerWorkspaceText(locale, "Space and camera")}: ${space}\n${designerWorkspaceText(locale, "Style")}: ${style}\n${designerWorkspaceText(locale, "Lighting")}: ${lighting}\n${designerWorkspaceText(locale, "Materials")}: ${materials}\n${designerWorkspaceText(locale, "Additional brief")}: ${brief}`} onRun={() => run(`${designerWorkspaceText(locale, "Space and camera")}: ${space}\n${designerWorkspaceText(locale, "Style")}: ${style}\n${designerWorkspaceText(locale, "Lighting")}: ${lighting}\n${designerWorkspaceText(locale, "Materials")}: ${materials}\n${designerWorkspaceText(locale, "Additional brief")}: ${brief}`)} className="border-fuchsia-400/25 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25" />
    </div>
  );
}

function PresentationWorkspace(props: DesignToolViewProps) {
  const { config, locale, project } = props;
  const { chat, run } = useStageWorkflow(props);
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [slideCount, setSlideCount] = useState('12');
  const [style, setStyle] = useState('');
  const [required, setRequired] = useState('');
  const slides = [designerWorkspaceText(locale, "Cover and positioning"), designerWorkspaceText(locale, "Brief and insight"), designerWorkspaceText(locale, "Concept and strategy"), designerWorkspaceText(locale, "Spatial scheme"), designerWorkspaceText(locale, "Visuals and materials"), designerWorkspaceText(locale, "Budget, schedule, next step")];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <StageHeader config={config} project={project} eyebrow={designerWorkspaceText(locale, "Proposal builder")} accent="text-blue-200" />
      <section className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-blue-300/12 bg-blue-400/[0.04] p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-[0.14em] text-blue-100/55">{designerWorkspaceText(locale, "Suggested storyline")}</h3><span className="rounded-full bg-blue-400/10 px-2 py-1 text-[10px] font-bold text-blue-100/45">{slideCount || '—'} PAGES</span></div><div className="mt-4 space-y-2">{slides.map((slide, index) => <div key={slide} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-3"><span className="text-[11px] font-black text-blue-200/45">{String(index + 1).padStart(2, '0')}</span><span className="text-sm font-bold text-white/65">{slide}</span></div>)}</div></aside>
        <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5"><div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Audience")}</span><input value={audience} onChange={event => setAudience(event.target.value)} placeholder={designerWorkspaceText(locale, "Client, management, review panel")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Slide count")}</span><input type="number" min="4" max="80" value={slideCount} onChange={event => setSlideCount(event.target.value)} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="text-xs font-bold text-white/45 sm:col-span-2"><span>{designerWorkspaceText(locale, "Meeting goal")}</span><input value={goal} onChange={event => setGoal(event.target.value)} placeholder={designerWorkspaceText(locale, "What decision should this proposal enable?")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label>
          <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Visual style")}</span><textarea value={style} onChange={event => setStyle(event.target.value)} rows={5} placeholder={designerWorkspaceText(locale, "Layout, color, and brand constraints")} className="lumi-field mt-2 w-full resize-y" /></label>
          <label className="text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Required content")}</span><textarea value={required} onChange={event => setRequired(event.target.value)} rows={5} placeholder={config.placeholder} className="lumi-field mt-2 w-full resize-y" /></label>
        </div></div>
      </section>
      <StageRunBar locale={locale} chat={chat} button={config.button} disabled={Boolean(props.blocked) || (!audience.trim() && !goal.trim() && !required.trim())} currentInput={`${designerWorkspaceText(locale, "Audience")}: ${audience}\n${designerWorkspaceText(locale, "Meeting goal")}: ${goal}\n${designerWorkspaceText(locale, "Slide count")}: ${slideCount}\n${designerWorkspaceText(locale, "Visual style")}: ${style}\n${designerWorkspaceText(locale, "Required content")}: ${required}`} onRun={() => run(`${designerWorkspaceText(locale, "Audience")}: ${audience}\n${designerWorkspaceText(locale, "Meeting goal")}: ${goal}\n${designerWorkspaceText(locale, "Slide count")}: ${slideCount}\n${designerWorkspaceText(locale, "Visual style")}: ${style}\n${designerWorkspaceText(locale, "Required content")}: ${required}`)} className="border-blue-400/25 bg-blue-500/15 text-blue-100 hover:bg-blue-500/25" />
    </div>
  );
}

function HandoffWorkspace(props: DesignToolViewProps) {
  const { config, locale, project, assets } = props;
  const { chat, run } = useStageWorkflow(props);
  const checklist = [designerWorkspaceText(locale, "Drawing register and revisions"), designerWorkspaceText(locale, "Key dimensions and schedules"), designerWorkspaceText(locale, "Consultant coordination and conflicts"), designerWorkspaceText(locale, "Openable files and naming"), designerWorkspaceText(locale, "Client approvals and open items")];
  const [checked, setChecked] = useState<string[]>([]);
  const [recipient, setRecipient] = useState('');
  const [version, setVersion] = useState('V1.0');
  const [notes, setNotes] = useState('');
  const toggle = (item: string) => setChecked(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item]);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <StageHeader config={config} project={project} eyebrow={designerWorkspaceText(locale, "Handoff control")} accent="text-emerald-200" />
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-2xl border border-emerald-300/12 bg-emerald-400/[0.035] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-black uppercase tracking-[0.14em] text-emerald-100/55">{designerWorkspaceText(locale, "Delivery checklist")}</h3><span className="text-xs font-bold text-emerald-100/45">{checked.length}/{checklist.length} {designerWorkspaceText(locale, "verified")}</span></div><div className="mt-4 space-y-2">{checklist.map(item => <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${checked.includes(item) ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-50' : 'border-white/[0.07] bg-black/15 text-white/55'}`}><input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} className="h-4 w-4 accent-emerald-400" /><span className="text-sm font-bold">{item}</span></label>)}</div></div>
        <aside className="rounded-2xl border border-white/[0.08] bg-black/20 p-5"><label className="block text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Recipient")}</span><input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder={designerWorkspaceText(locale, "Client, contractor, supplier")} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label><label className="mt-4 block text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Delivery version")}</span><input value={version} onChange={event => setVersion(event.target.value)} className="lumi-field mt-2 w-full py-2.5 text-sm" /></label><label className="mt-4 block text-xs font-bold text-white/45"><span>{designerWorkspaceText(locale, "Open items and verification focus")}</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={7} placeholder={config.placeholder} className="lumi-field mt-2 w-full resize-y" /></label><div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-xs leading-relaxed text-white/40">{assets.length} {designerWorkspaceText(locale, "project files are available as evidence. Completion requires verified file receipts.")}</div></aside>
      </section>
      <StageRunBar locale={locale} chat={chat} button={config.button} disabled={Boolean(props.blocked) || (!recipient.trim() && !notes.trim() && checked.length === 0)} currentInput={`${designerWorkspaceText(locale, "Recipient")}: ${recipient}\n${designerWorkspaceText(locale, "Version")}: ${version}\n${designerWorkspaceText(locale, "Manually checked")}: ${checked.join('、')}\n${designerWorkspaceText(locale, "Open items")}: ${notes}`} onRun={() => run(`${designerWorkspaceText(locale, "Recipient")}: ${recipient}\n${designerWorkspaceText(locale, "Version")}: ${version}\n${designerWorkspaceText(locale, "Manually checked")}: ${checked.join('、')}\n${designerWorkspaceText(locale, "Open items")}: ${notes}`)} className="border-emerald-400/25 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25" />
    </div>
  );
}
