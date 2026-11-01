import { apiJson } from '../services/apiClient';
import { withRequestDeadline } from './requestDeadline';

export type InteriorProjectType = 'residential' | 'office' | 'retail' | 'hospitality' | 'other';
export type InteriorProjectStatus = 'brief' | 'planning' | 'design' | 'visualization' | 'handoff' | 'archived';
export type InteriorAssetCategory = 'floor-plan' | 'cad' | 'site-photo' | 'material' | 'reference' | 'other';
export type InteriorProjectDomain = 'personal' | 'work';
export type InteriorDesignStageId = 'project' | 'cad' | 'visualization' | 'presentation' | 'handoff';
export type InteriorDesignStageStatus = 'not_started' | 'in_progress' | 'waiting_confirmation' | 'blocked' | 'completed';

export interface InteriorProjectWorkflowArtifactRef {
  label: string;
  type: string;
  path: string;
  fileName: string;
  status: string;
  taskId: string;
  recordedAt: string;
}

export interface InteriorProjectWorkflowStageState {
  entryId: InteriorDesignStageId;
  status: InteriorDesignStageStatus;
  currentTaskId: string;
  taskIds: string[];
  conversationTaskId: string;
  parentTaskId: string;
  sourceTaskIds: string[];
  receiptIds: string[];
  artifacts: InteriorProjectWorkflowArtifactRef[];
  verificationId: string;
  verificationStatus: string;
  blocker: string;
  attempts: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
}

export interface InteriorProjectWorkflowState {
  schemaVersion: 1;
  rootConversationId: string;
  rootTaskId: string;
  activeStage: InteriorDesignStageId | '';
  stages: Record<InteriorDesignStageId, InteriorProjectWorkflowStageState>;
  createdAt: string;
  updatedAt: string;
}

export interface InteriorProjectBrief {
  location: string;
  area: string;
  occupants: string;
  budget: string;
  style: string;
  requirements: string;
  constraints: string;
}

export interface InteriorProject {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  projectType: InteriorProjectType;
  status: InteriorProjectStatus;
  brief: InteriorProjectBrief;
  workflow?: InteriorProjectWorkflowState;
  createdAt: string;
  updatedAt: string;
}

export interface InteriorProjectDraft {
  name: string;
  projectType: InteriorProjectType;
  status: InteriorProjectStatus;
  brief: InteriorProjectBrief;
}

export interface InteriorProjectAsset {
  id: string;
  orgId: string;
  projectId: string;
  fileId: string;
  displayName: string;
  mimeType: string;
  rawSize: number;
  category: InteriorAssetCategory;
  uploadedBy: string;
  status: 'active' | 'removed';
  extractionStatus: string;
  orgArticleId: string;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return withRequestDeadline(signal => apiJson<T>(url, { ...init, signal,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  }), init?.signal || undefined, 15_000);
}

function projectRoute(domain: InteriorProjectDomain): string {
  return domain === 'work' ? '/api/org/interior/projects' : '/api/personal/interior/projects';
}

export async function listInteriorProjects(domain: InteriorProjectDomain, signal?: AbortSignal): Promise<InteriorProject[]> {
  const data = await request<{ projects: InteriorProject[] }>(projectRoute(domain), { signal });
  if (!Array.isArray(data.projects)) throw new Error('Invalid project list response');
  return data.projects;
}

export async function getActiveInteriorProject(domain: InteriorProjectDomain, signal?: AbortSignal): Promise<InteriorProject | null> {
  const data = await request<{ project: InteriorProject | null }>(`${projectRoute(domain)}/active`, { signal });
  if (data.project !== null && (!data.project || typeof data.project.id !== 'string')) throw new Error('Invalid active project response');
  return data.project;
}

export async function setActiveInteriorProject(
  domain: InteriorProjectDomain,
  projectId: string | null,
): Promise<InteriorProject | null> {
  const data = await request<{ project: InteriorProject | null }>(`${projectRoute(domain)}/active`, {
    method: 'PUT',
    body: JSON.stringify({ projectId }),
  });
  return data.project || null;
}

export async function getInteriorProjectWorkflow(
  domain: InteriorProjectDomain,
  projectId: string,
  signal?: AbortSignal,
): Promise<InteriorProjectWorkflowState> {
  const data = await request<{ workflow: InteriorProjectWorkflowState }>(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/workflow`, { signal },
  );
  if (!data.workflow || !['project', 'cad', 'visualization', 'presentation', 'handoff'].every(id => typeof data.workflow.stages?.[id]?.status === 'string')) throw new Error('Invalid project stage response');
  return data.workflow;
}

export function createInteriorProject(domain: InteriorProjectDomain, draft: InteriorProjectDraft): Promise<InteriorProject> {
  return request<InteriorProject>(projectRoute(domain), {
    method: 'POST',
    body: JSON.stringify({
      name: draft.name,
      projectType: draft.projectType,
      brief: draft.brief,
    }),
  });
}

export function updateInteriorProject(domain: InteriorProjectDomain, projectId: string, draft: InteriorProjectDraft): Promise<InteriorProject> {
  return request<InteriorProject>(`${projectRoute(domain)}/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  });
}

export async function listInteriorProjectAssets(domain: InteriorProjectDomain, projectId: string, signal?: AbortSignal): Promise<InteriorProjectAsset[]> {
  const data = await request<{ assets: InteriorProjectAsset[] }>(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/assets`, { signal },
  );
  if (!Array.isArray(data.assets)) throw new Error('Invalid project sources response');
  return data.assets;
}

export function updateInteriorProjectAsset(
  domain: InteriorProjectDomain,
  projectId: string,
  assetId: string,
  category: InteriorAssetCategory,
): Promise<InteriorProjectAsset> {
  return request<InteriorProjectAsset>(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: 'PUT', body: JSON.stringify({ category }) },
  );
}

export function removeInteriorProjectAsset(domain: InteriorProjectDomain, projectId: string, assetId: string): Promise<void> {
  return request(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  );
}

export function interiorProjectAssetUrl(domain: InteriorProjectDomain, asset: Pick<InteriorProjectAsset, 'fileId'>, inline = true): string {
  const query = inline ? `?domain=${domain}&inline=1` : `?domain=${domain}`;
  return `/api/files/download/${encodeURIComponent(asset.fileId)}${query}`;
}
