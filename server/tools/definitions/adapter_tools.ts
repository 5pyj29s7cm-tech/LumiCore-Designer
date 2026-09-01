import { getAdapterRegistry, summarizeAdapters, AdapterCapability, AdapterCategory, AdapterStatus } from '../../adapters/registry';
import { getClientStateForScope } from '../../client/self_model';
import { ToolRegistry } from '../registry';
import { mcpManager } from '../../mcp/client';
import { capabilityContract, capabilityEvidence } from '../capability_contracts';

const STATUSES: AdapterStatus[] = [
  'ready',
  'available',
  'draft_only',
  'requires_setup',
  'attention',
  'degraded',
  'blocked',
  'planned',
];

const CATEGORIES: AdapterCategory[] = [
  'client',
  'workspace',
  'media',
  'files',
  'web',
  'messaging',
  'cad_bim',
  'ai',
  'automation',
  'collaboration',
  'organization',
  'memory',
  'system',
];

export function registerAdapterTools(registry: ToolRegistry): void {
  registry.register({
    name: 'adapter_registry_list',
    description: 'List Lumi client capability adapters: windows, modes, tools, skills, music, meeting, organization, runtime logs, knowledge, settings, permissions, desktop control, CAD/BIM, external apps, and collaboration.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: CATEGORIES,
          description: 'Optional category filter.',
        },
        status: {
          type: 'string',
          enum: STATUSES,
          description: 'Optional status filter.',
        },
        includePlanned: {
          type: 'boolean',
          description: 'Whether to include planned/not-yet-wired adapters. Defaults to true.',
        },
      },
      required: [],
    },
    handler: async (args, context) => {
      const userId = context?.userId || 'anonymous';
      const report = getAdapterRegistry({
        userId,
        clientState: getClientStateForScope(userId, { domain: context?.domain, orgId: context?.orgId }),
        includePlanned: args.includePlanned !== false,
        capabilityManifest: registry.getCapabilityManifest(context?.toolPolicy, { context }),
      });
      const adapters = filterAdapters(report.adapters, args);
      return JSON.stringify({
        ...report,
        summary: summarizeAdapters(adapters),
        adapters,
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'adapter_health_check',
    description: 'Check Lumi adapter readiness and return blockers, setup needs, degraded areas, and safe next actions. Use this when Lumi needs to understand whether a capability can really be used.',
    parameters: {
      type: 'object',
      properties: {
        adapterId: {
          type: 'string',
          description: 'Optional exact adapter id, e.g. cad_bim.drafting, automation.computer_use, workspace.skills_mcp.',
        },
        category: {
          type: 'string',
          enum: CATEGORIES,
          description: 'Optional category filter.',
        },
      },
      required: [],
    },
    handler: async (args, context) => {
      const userId = context?.userId || 'anonymous';
      const report = getAdapterRegistry({
        userId,
        clientState: getClientStateForScope(userId, { domain: context?.domain, orgId: context?.orgId }),
        includePlanned: true,
        capabilityManifest: registry.getCapabilityManifest(context?.toolPolicy, { context }),
      });
      const adapters = filterAdapters(report.adapters, args)
        .filter(adapter => !args.adapterId || adapter.id === String(args.adapterId));
      const needsAttention = adapters.filter(adapter => ['attention', 'degraded'].includes(adapter.status));
      const setupRequired = adapters.filter(adapter => ['requires_setup', 'blocked'].includes(adapter.status));
      const draftOnly = adapters.filter(adapter => adapter.status === 'draft_only');
      const planned = adapters.filter(adapter => adapter.status === 'planned');
      const usable = adapters.filter(adapter => ['ready', 'available', 'draft_only'].includes(adapter.status));

      return JSON.stringify({
        generatedAt: report.generatedAt,
        userId,
        checkedCount: adapters.length,
        summary: summarizeAdapters(adapters),
        usable: usable.map(compactAdapter),
        needsAttention: needsAttention.map(adapter => ({
          ...compactAdapter(adapter),
          diagnostics: adapter.diagnostics || [],
          setup: adapter.setup || [],
        })),
        setupRequired: setupRequired.map(adapter => ({
          ...compactAdapter(adapter),
          setup: adapter.setup || [],
          safety: adapter.safety,
        })),
        draftOnly: draftOnly.map(compactAdapter),
        planned: planned.map(adapter => ({
          ...compactAdapter(adapter),
          setup: adapter.setup || [],
        })),
        nextActions: buildNextActions(adapters),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'adapter_auto_recover',
    description: 'Safely recover enabled local MCP/skill runtimes that are already configured but crashed or failed. It never enables disabled connectors, installs packages, changes credentials, bypasses login/security checks, or retries external commits.',
    parameters: {
      type: 'object',
      properties: {
        serverName: { type: 'string', description: 'Optional exact configured MCP/skill server name. Omit to recover up to three unhealthy enabled runtimes.' },
        dryRun: { type: 'boolean', description: 'Inspect and report the recovery plan without restarting anything.' },
      },
      required: [],
    },
    handler: async (args) => {
      const requested = String(args.serverName || '').trim();
      const config = mcpManager.getConfig();
      const healthBefore = mcpManager.getServerHealth();
      if (requested && !config[requested]) {
        return JSON.stringify({ ok: false, status: 'not_configured', requested, recovered: [], blocked: ['server is not configured'] }, null, 2);
      }
      if (requested && config[requested]?.enabled !== true) {
        return JSON.stringify({ ok: false, status: 'setup_required', requested, recovered: [], blocked: ['disabled connectors are never enabled by auto recovery'] }, null, 2);
      }
      const candidates = selectSafeMcpRecoveryCandidates(config, healthBefore, requested).slice(0, 3);
      if (args.dryRun === true || candidates.length === 0) {
        return JSON.stringify({ ok: true, status: candidates.length ? 'planned' : 'healthy', dryRun: args.dryRun === true, candidates, recovered: [], healthBefore }, null, 2);
      }
      const recovered: Array<Record<string, unknown>> = [];
      const blocked: Array<Record<string, unknown>> = [];
      for (const name of candidates) {
        try {
          const tools = await mcpManager.restartServer(name);
          const current = mcpManager.getServerHealth()[name];
          const verified = tools.length > 0 && ['connected', 'idle', 'available'].includes(String(current?.status || ''));
          if (!verified) throw new Error('runtime restarted without a verified connected tool inventory');
          recovered.push({ name, toolCount: tools.length, health: current?.status || 'connected' });
        } catch (error: any) {
          blocked.push({ name, reason: String(error?.message || error).slice(0, 500) });
        }
      }
      return JSON.stringify({
        ok: blocked.length === 0,
        status: blocked.length === 0 ? 'recovered' : recovered.length ? 'partial' : 'blocked',
        recovered,
        blocked,
        healthAfter: mcpManager.getServerHealth(),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
    capability: capabilityContract({
      id: 'adapter.runtime.safe-recovery', family: 'adapter-recovery', lane: 'system', operation: 'mutate', risk: 'low',
      sideEffects: [{ type: 'process_execution', scope: 'restart already-enabled local MCP/skill process', reversible: true }],
      verification: {
        strategy: 'state_diff', required: true,
        requiredFields: ['ok', 'status', 'recovered'],
        successStatuses: ['healthy', 'planned', 'recovered'], failureStatuses: ['not_configured', 'setup_required', 'partial', 'blocked'],
        successSignals: ['post-restart health and non-empty tool inventory'],
        limitations: ['Does not enable, install, authenticate, reconfigure, or replay any business mutation.'],
      },
    }),
    evidence: capabilityEvidence({ id: 'adapter.runtime.safe-recovery', operation: 'mutate', subjectArgument: 'serverName', limitations: ['Only already-enabled failed local runtimes are eligible.'] }),
  });
}

export function selectSafeMcpRecoveryCandidates(
  config: Record<string, { enabled?: boolean; source?: string }>,
  health: Record<string, { status?: string; consecutiveCrashes?: number }>,
  requested = '',
): string[] {
  const names = requested ? [requested] : Object.keys(config).sort();
  return names.filter(name => {
    if (config[name]?.enabled !== true) return false;
    if (config[name]?.source === 'external') return false;
    const state = health[name];
    const status = String(state?.status || '').toLowerCase();
    const crashes = Number(state?.consecutiveCrashes || 0);
    if (crashes >= 5) return false;
    return ['crashed', 'failed'].includes(status);
  });
}

function filterAdapters(adapters: AdapterCapability[], args: Record<string, any>): AdapterCapability[] {
  const category = String(args.category || '').trim();
  const status = String(args.status || '').trim();
  return adapters.filter(adapter => (
    (!category || adapter.category === category) &&
    (!status || adapter.status === status)
  ));
}

function compactAdapter(adapter: AdapterCapability) {
  return {
    id: adapter.id,
    label: adapter.label,
    category: adapter.category,
    status: adapter.status,
    actions: adapter.actions,
    surfaces: adapter.surfaces || [],
    requiresConfirmation: Boolean(adapter.requiresConfirmation),
    notes: adapter.notes,
  };
}

function buildNextActions(adapters: AdapterCapability[]): string[] {
  const actions: string[] = [];
  if (adapters.some(adapter => adapter.status === 'degraded' || adapter.status === 'attention')) {
    actions.push('Use client_health_check, then open the related recovery surface with client_self_repair if the cause is a client state/runtime issue.');
  }
  if (adapters.some(adapter => adapter.status === 'requires_setup' || adapter.status === 'blocked')) {
    actions.push('Open Settings or Skill Hall for setup before claiming this capability is usable.');
  }
  if (adapters.some(adapter => adapter.requiresConfirmation)) {
    actions.push('Ask for explicit confirmation before desktop automation, external messaging, meetings, autonomous execution, provider changes, installs, or file writes.');
  }
  if (adapters.some(adapter => adapter.status === 'planned')) {
    actions.push('Treat planned adapters as roadmap items. Use capability_research before building or installing integrations.');
  }
  if (!actions.length) actions.push('Adapters checked are usable. Prefer their explicit actions over blind UI control.');
  return actions;
}
