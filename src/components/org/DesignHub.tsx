import React, { useMemo, useRef, useState } from 'react';
import {
  Building2,
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
} from '../../lib/interiorProjects';
import {
  interiorDesignMessage,
  type InteriorDesignLocale,
  type InteriorDesignMessageKey,
} from '../../i18n/locales/interiorDesign';
import { InteriorProjectPanel } from './InteriorProjectPanel';
import { InteriorProjectAssets } from './InteriorProjectAssets';
import { startIndustryWorkflow } from '../../lib/industryWorkflowClient';

type DesignView =
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

function parseSseEvent(block: string): Record<string, unknown> | null {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function DesignHub() {
  const [view, setView] = useState<DesignView>('project');
  const [activeProject, setActiveProject] = useState<InteriorProject | null>(null);
  const [projectAssets, setProjectAssets] = useState<InteriorProjectAsset[]>([]);
  const t = useT();
  const locale: InteriorDesignLocale = t.langCode === 'en' ? 'en' : 'zh';
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);

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

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.08] bg-black/20">
        <div className="border-b border-white/[0.08] p-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-white/85">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-200">
              <Layout size={16} />
            </span>
            <span className="min-w-0 truncate">{m('workspaceTitle')}</span>
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-white/40">{m('workspaceDescription')}</p>
          <span className="mt-3 inline-flex rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200/80">
            {m('scopeBadge')}
          </span>
        </div>
        <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                view === item.id
                  ? 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100'
                  : 'border-transparent text-white/50 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white/80'
              }`}
            >
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{item.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-white/35">{item.desc}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="custom-scrollbar min-w-0 flex-1 overflow-y-auto bg-black/10">
        <InteriorProjectPanel
          locale={locale}
          onProjectChange={project => {
            setActiveProject(project);
            setProjectAssets([]);
          }}
        />
        {activeProject ? (
          <>
            <InteriorProjectAssets key={activeProject.id} project={activeProject} locale={locale} onAssetsChange={setProjectAssets} />
            <DesignToolView
              key={`${activeProject.id}:${activeProject.updatedAt}:${view}`}
              config={tools[view]}
              entryId={view}
              locale={locale}
              project={activeProject}
              assets={projectAssets}
            />
          </>
        ) : (
          <div className="mx-auto flex max-w-5xl items-center justify-center px-6 py-20">
            <div className="max-w-lg rounded-2xl border border-dashed border-cyan-300/15 bg-cyan-500/[0.04] p-8 text-center">
              <Building2 size={28} className="mx-auto text-cyan-300/60" />
              <h2 className="mt-4 text-lg font-black text-white/85">{m('projectRequiredTitle')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/45">{m('projectRequiredDescription')}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function useDesignChat(locale: InteriorDesignLocale) {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [workflowTaskId, setWorkflowTaskId] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => abortRef.current?.abort();

  const send = async (prompt: string, workflow: {
    entryId: DesignView;
    sourceInput: string;
    projectId: string;
    projectName: string;
  }) => {
    if (!prompt.trim() || loading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult('');
    setWorkflowStatus('creating');
    try {
      const started = await startIndustryWorkflow({
        entryId: workflow.entryId,
        sourceInput: workflow.sourceInput,
        source: 'designer_project_workspace',
        context: { projectId: workflow.projectId, projectName: workflow.projectName },
      });
      setWorkflowTaskId(started.task.id);
      setWorkflowStatus('in_progress');
      const res = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          industryWorkflowTaskId: started.task.id,
          messages: [{ role: 'user', content: `${started.handoffPrompt}\n\n${prompt}` }],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || m('requestFailed'));
      }
      if (!res.body) throw new Error(m('requestFailed'));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const event = parseSseEvent(block);
          if (!event) continue;
          if (typeof event.chunk === 'string') {
            assembled += event.chunk;
            setResult(assembled);
          }
          if (event.done === true && typeof event.text === 'string') {
            assembled = event.text;
            setResult(assembled);
            const workflowResult = event.industryWorkflow as Record<string, unknown> | undefined;
            if (typeof workflowResult?.status === 'string') setWorkflowStatus(workflowResult.status);
          }
        }
        if (done) break;
      }

      const trailing = parseSseEvent(buffer);
      if (trailing?.done === true && typeof trailing.text === 'string') {
        setResult(trailing.text);
        const workflowResult = trailing.industryWorkflow as Record<string, unknown> | undefined;
        if (typeof workflowResult?.status === 'string') setWorkflowStatus(workflowResult.status);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setResult(`${m('errorPrefix')}${err?.message || err}`);
        setWorkflowStatus('blocked');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return { input, setInput, result, loading, workflowTaskId, workflowStatus, send, stop };
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

function DesignToolView({
  config,
  entryId,
  locale,
  project,
  assets,
}: {
  config: ToolConfig;
  entryId: DesignView;
  locale: InteriorDesignLocale;
  project: InteriorProject;
  assets: InteriorProjectAsset[];
}) {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const { input, setInput, result, loading, workflowTaskId, workflowStatus, send, stop } = useDesignChat(locale);

  const run = () => {
    const outputGuide = config.output.map(item => `- ${item}`).join('\n');
    const projectContext = formatProjectContext(project, locale);
    const assetContext = formatProjectAssets(assets, locale);
    const assetSection = assetContext ? `\n\n${m('projectSources')}\n${assetContext}` : '';
    void send(
      `${config.role}\n\n${m('scopeGuard')}\n\n${m('projectContext')}\n${projectContext}${assetSection}\n\n${m('outputInstruction')}\n${outputGuide}\n\n${m('userRequirement')}\n${input}`,
      { entryId, sourceInput: input, projectId: project.id, projectName: project.name },
    );
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
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
              disabled={loading || !input.trim()}
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
        <section className="lumi-panel custom-scrollbar max-h-[560px] overflow-y-auto whitespace-pre-wrap p-5 text-sm leading-relaxed text-white/80">
          {result}
        </section>
      )}
    </div>
  );
}
