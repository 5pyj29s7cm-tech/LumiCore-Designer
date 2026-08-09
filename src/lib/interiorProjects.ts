export type InteriorProjectType = 'residential' | 'office' | 'retail' | 'hospitality' | 'other';
export type InteriorProjectStatus = 'brief' | 'planning' | 'design' | 'visualization' | 'handoff' | 'archived';
export type InteriorAssetCategory = 'floor-plan' | 'cad' | 'site-photo' | 'material' | 'reference' | 'other';

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

export async function listInteriorProjects(): Promise<InteriorProject[]> {
  const data = await request<{ projects: InteriorProject[] }>('/api/org/interior/projects');
  return Array.isArray(data.projects) ? data.projects : [];
}

export function createInteriorProject(draft: InteriorProjectDraft): Promise<InteriorProject> {
  return request<InteriorProject>('/api/org/interior/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: draft.name,
      projectType: draft.projectType,
      brief: draft.brief,
    }),
  });
}

export function updateInteriorProject(projectId: string, draft: InteriorProjectDraft): Promise<InteriorProject> {
  return request<InteriorProject>(`/api/org/interior/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  });
}

export async function listInteriorProjectAssets(projectId: string): Promise<InteriorProjectAsset[]> {
  const data = await request<{ assets: InteriorProjectAsset[] }>(
    `/api/org/interior/projects/${encodeURIComponent(projectId)}/assets`,
  );
  return Array.isArray(data.assets) ? data.assets : [];
}

export function updateInteriorProjectAsset(
  projectId: string,
  assetId: string,
  category: InteriorAssetCategory,
): Promise<InteriorProjectAsset> {
  return request<InteriorProjectAsset>(
    `/api/org/interior/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: 'PUT', body: JSON.stringify({ category }) },
  );
}

export function removeInteriorProjectAsset(projectId: string, assetId: string): Promise<void> {
  return request(
    `/api/org/interior/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  );
}

export function interiorProjectAssetUrl(asset: Pick<InteriorProjectAsset, 'fileId'>, inline = true): string {
  const query = inline ? '?domain=work&inline=1' : '?domain=work';
  return `/api/files/download/${encodeURIComponent(asset.fileId)}${query}`;
}
