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
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

function projectRoute(domain: InteriorProjectDomain): string {
  return domain === 'work' ? '/api/org/interior/projects' : '/api/personal/interior/projects';
}

export async function listInteriorProjects(domain: InteriorProjectDomain): Promise<InteriorProject[]> {
  const data = await request<{ projects: InteriorProject[] }>(projectRoute(domain));
  return Array.isArray(data.projects) ? data.projects : [];
}

export async function getActiveInteriorProject(domain: InteriorProjectDomain): Promise<InteriorProject | null> {
  const data = await request<{ project: InteriorProject | null }>(`${projectRoute(domain)}/active`);
  return data.project || null;
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
): Promise<InteriorProjectWorkflowState> {
  const data = await request<{ workflow: InteriorProjectWorkflowState }>(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/workflow`,
  );
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

export async function listInteriorProjectAssets(domain: InteriorProjectDomain, projectId: string): Promise<InteriorProjectAsset[]> {
  const data = await request<{ assets: InteriorProjectAsset[] }>(
    `${projectRoute(domain)}/${encodeURIComponent(projectId)}/assets`,
  );
  return Array.isArray(data.assets) ? data.assets : [];
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
