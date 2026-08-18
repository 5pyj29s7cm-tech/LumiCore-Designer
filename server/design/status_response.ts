import type { ToolExecutionRecord } from '../tools/types';

type DesignStageId = 'project' | 'cad' | 'visualization' | 'presentation' | 'handoff';

const STAGE_LABELS: Record<DesignStageId, string> = {
  project: '\u8bbe\u8ba1\u9879\u76ee',
  cad: 'CAD \u65b9\u6848',
  visualization: '\u6548\u679c\u56fe',
  presentation: '\u63d0\u6848 PPT',
  handoff: '\u4ea4\u4ed8\u4e2d\u5fc3',
};

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

function requestedStage(text: unknown): DesignStageId | null {
  const value = String(text || '');
  if (/\bCAD\b|\bDXF\b|\bDWG\b/i.test(value)) return 'cad';
  if (/\u6548\u679c\u56fe|\u6e32\u67d3|\b(?:visualization|render)\b/i.test(value)) return 'visualization';
  if (/\bPPT\b|\u63d0\u6848|\b(?:presentation|proposal)\b/i.test(value)) return 'presentation';
  if (/\u4ea4\u4ed8\u4e2d\u5fc3|\u4ea4\u4ed8\u5305|\b(?:handoff|delivery)\b/i.test(value)) return 'handoff';
  if (/\u8bbe\u8ba1\u9879\u76ee|\u9879\u76ee\u65b9\u6848|\bproject\s+(?:scheme|stage|status)\b/i.test(value)) return 'project';
  return null;
}

function statusLabel(value: unknown): string {
  const status = String(value || '').toLowerCase();
  if (status === 'completed' || status === 'delivered') return '\u5df2\u5b8c\u6210';
  if (status === 'in_progress' || status === 'executing') return '\u8fdb\u884c\u4e2d';
  if (status === 'blocked') return '\u5df2\u963b\u585e';
  if (status === 'waiting_confirmation') return '\u7b49\u5f85\u786e\u8ba4';
  if (status === 'queued') return '\u5df2\u6392\u961f';
  if (status === 'not_started' || !status) return '\u672a\u5f00\u59cb';
  return status;
}

function verificationLabel(value: unknown): string {
  const status = String(value || '').toLowerCase();
  if (status === 'passed' || status === 'verified') return '\u5df2\u901a\u8fc7';
  if (status === 'blocked' || status === 'failed') return '\u672a\u901a\u8fc7';
  if (status === 'needs_review') return '\u5f85\u590d\u6838';
  return status || '\u5c1a\u65e0\u9a8c\u8bc1';
}

function artifactPaths(stage: Record<string, any>): string[] {
  const paths = (Array.isArray(stage.artifacts) ? stage.artifacts : [])
    .map((artifact: any) => String(artifact?.path || '').trim())
    .filter(Boolean);
  return Array.from(new Set(paths));
}

function blockerLabel(value: unknown): string {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '\u65e0';
  const prerequisiteMatch = raw.match(/Design stage\s+([a-z_]+)\s+is blocked until verified upstream stages complete:\s*([^.]*)/i);
  if (prerequisiteMatch) {
    const stage = prerequisiteMatch[1] as DesignStageId;
    const stageLabel = STAGE_LABELS[stage] || stage;
    const upstream = prerequisiteMatch[2]
      .split(/[,\s]+/)
      .map(value => STAGE_LABELS[value as DesignStageId] || value)
      .filter(Boolean)
      .join('\u3001');
    const possessive = /[A-Za-z]$/.test(stageLabel) ? `${stageLabel} \u7684` : `${stageLabel}\u7684`;
    return `${possessive}\u524d\u7f6e\u9636\u6bb5\u5c1a\u672a\u901a\u8fc7\uff1a${upstream || '\u672a\u77e5\u9636\u6bb5'}\u3002\u5fc5\u987b\u5148\u5b8c\u6210\u5e76\u9a8c\u8bc1\u8fd9\u4e9b\u9636\u6bb5\uff0c\u5f53\u524d\u5df2\u505c\u6b62\u6267\u884c\u3002`;
  }
  if (/Arrearage|overdue payment|account is in good standing/i.test(raw)) {
    return '\u56fe\u50cf\u751f\u6210\u670d\u52a1 DashScope\uff08\u901a\u4e49\u4e07\u76f8\uff09\u8d26\u6237\u6b20\u8d39\uff08Arrearage\uff09\uff0c\u6ca1\u6709\u4ea7\u751f\u771f\u5b9e\u56fe\u7247\uff0c\u7cfb\u7edf\u5df2\u505c\u6b62\u81ea\u52a8\u91cd\u8bd5\u3002\u8bf7\u6062\u590d DashScope \u8ba1\u8d39\uff0c\u6216\u914d\u7f6e OpenAI / SiliconFlow \u56fe\u50cf\u670d\u52a1\u540e\u518d\u7ee7\u7eed\u3002';
  }
  if (/No working image generation provider|Configure OpenAI, DashScope, or SiliconFlow/i.test(raw)) {
    return '\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u7684\u56fe\u50cf\u751f\u6210\u670d\u52a1\uff0c\u672a\u751f\u6210\u771f\u5b9e\u56fe\u7247\u3002\u8bf7\u5148\u5728\u201c\u8bbe\u7f6e > \u751f\u6210\u6a21\u578b\u201d\u4e2d\u914d\u7f6e OpenAI\u3001DashScope \u6216 SiliconFlow\u3002';
  }
  if (/external commit outcome is unknown|automatic resend was stopped/i.test(raw)) {
    return '\u672c\u6b21\u5916\u90e8\u751f\u6210\u7ed3\u679c\u65e0\u6cd5\u786e\u8ba4\uff0c\u4e3a\u907f\u514d\u91cd\u590d\u6267\u884c\uff0c\u7cfb\u7edf\u5df2\u505c\u6b62\u81ea\u52a8\u91cd\u8bd5\u3002';
  }
  return raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

export function formatVerifiedDesignProjectStatus(
  record: ToolExecutionRecord | undefined,
  taskText = '',
): string | null {
  if (
    !record
    || record.name !== 'interior_design_project_status'
    || record.error
    || record.terminalVerification?.status !== 'verified'
  ) return null;
  const payload = parseObject(record.result);
  const project = parseObject(payload.project);
  const workflow = parseObject(payload.workflow);
  const stages = parseObject(workflow.stages);
  if (payload.ok !== true || payload.persisted !== true || !String(project.id || '').trim()) return null;

  const selected = requestedStage(taskText);
  const nextStage = String(workflow.nextStage || '').trim() as DesignStageId;
  const nextLabel = nextStage && STAGE_LABELS[nextStage]
    ? `${STAGE_LABELS[nextStage]}\uff08${statusLabel(parseObject(stages[nextStage]).status)}\uff09`
    : '\u5168\u90e8\u9636\u6bb5\u5df2\u5b8c\u6210';
  const header = `\u201c${String(project.name || project.id)}\u201d\u9879\u76ee\u8d26\u672c\uff1a`;

  if (selected && stages[selected]) {
    const stage = parseObject(stages[selected]);
    const paths = artifactPaths(stage);
    return [
      header,
      `- ${STAGE_LABELS[selected]}\uff1a${statusLabel(stage.status)}`,
      `- \u9a8c\u8bc1\u72b6\u6001\uff1a${verificationLabel(stage.verificationStatus)}`,
      `- \u5f53\u524d\u4efb\u52a1 ID\uff1a${String(stage.currentTaskId || '\u65e0')}`,
      `- \u4ea4\u4ed8\u6587\u4ef6\uff1a${paths.length ? paths.join('\uff1b') : '\u6682\u65e0\u5df2\u5f52\u6863\u6587\u4ef6'}`,
      `- \u963b\u585e\u9879\uff1a${blockerLabel(stage.blocker)}`,
      `- \u4e0b\u4e00\u9636\u6bb5\uff1a${nextLabel}`,
      '\u4ee5\u4e0a\u7ed3\u8bba\u6765\u81ea\u5f53\u524d\u6301\u4e45\u9879\u76ee\u8d26\u672c\uff0c\u672c\u6b21\u53ea\u8bfb\u67e5\u8be2\u6ca1\u6709\u91cd\u65b0\u6267\u884c\u8bbe\u8ba1\u5de5\u4f5c\u3002',
    ].join('\n');
  }

  const ordered: DesignStageId[] = ['project', 'cad', 'visualization', 'presentation', 'handoff'];
  return [
    header,
    ...ordered.map((entryId) => {
      const stage = parseObject(stages[entryId]);
      return `- ${STAGE_LABELS[entryId]}\uff1a${statusLabel(stage.status)}\uff0c\u9a8c\u8bc1=${verificationLabel(stage.verificationStatus)}`;
    }),
    `- \u4e0b\u4e00\u9636\u6bb5\uff1a${nextLabel}`,
    '\u4ee5\u4e0a\u7ed3\u8bba\u6765\u81ea\u5f53\u524d\u6301\u4e45\u9879\u76ee\u8d26\u672c\uff0c\u672c\u6b21\u6ca1\u6709\u6267\u884c\u65b0\u5de5\u4f5c\u3002',
  ].join('\n');
}
