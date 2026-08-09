import { randomUUID } from 'crypto';
import { readDB, writeDB } from '../../db_layer';

export const INTERIOR_PROJECT_TYPES = [
  'residential',
  'office',
  'retail',
  'hospitality',
  'other',
] as const;

export const INTERIOR_PROJECT_STATUSES = [
  'brief',
  'planning',
  'design',
  'visualization',
  'handoff',
  'archived',
] as const;

export type InteriorProjectType = typeof INTERIOR_PROJECT_TYPES[number];
export type InteriorProjectStatus = typeof INTERIOR_PROJECT_STATUSES[number];

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

export interface CreateInteriorProjectInput {
  name: unknown;
  projectType?: unknown;
  brief?: unknown;
}

export interface UpdateInteriorProjectInput {
  name?: unknown;
  projectType?: unknown;
  status?: unknown;
  brief?: unknown;
}

export class InteriorProjectValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InteriorProjectValidationError';
  }
}

const EMPTY_BRIEF: InteriorProjectBrief = {
  location: '',
  area: '',
  occupants: '',
  budget: '',
  style: '',
  requirements: '',
  constraints: '',
};

const BRIEF_LIMITS: Record<keyof InteriorProjectBrief, number> = {
  location: 240,
  area: 120,
  occupants: 240,
  budget: 240,
  style: 600,
  requirements: 6000,
  constraints: 6000,
};

function projectRows(db: any): InteriorProject[] {
  if (!Array.isArray(db.interiorProjects)) db.interiorProjects = [];
  return db.interiorProjects as InteriorProject[];
}

function textField(value: unknown, field: string, maxLength: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new InteriorProjectValidationError(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new InteriorProjectValidationError(`${field} must be a string`);
  }
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (required && !normalized) {
    throw new InteriorProjectValidationError(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new InteriorProjectValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function enumField<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
  fallback?: T[number],
): T[number] {
  if ((value === undefined || value === null || value === '') && fallback) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new InteriorProjectValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function briefInput(value: unknown, current: InteriorProjectBrief = EMPTY_BRIEF): InteriorProjectBrief {
  if (value === undefined) return { ...current };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InteriorProjectValidationError('brief must be an object');
  }
  const input = value as Record<string, unknown>;
  const next = { ...current };
  for (const field of Object.keys(BRIEF_LIMITS) as Array<keyof InteriorProjectBrief>) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      next[field] = textField(input[field], `brief.${field}`, BRIEF_LIMITS[field]);
    }
  }
  return next;
}

export function listInteriorProjects(
  orgId: string,
  options: { includeArchived?: boolean } = {},
): InteriorProject[] {
  const rows = projectRows(readDB())
    .filter(project => project.orgId === orgId)
    .filter(project => options.includeArchived || project.status !== 'archived')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return rows.map(project => ({ ...project, brief: { ...project.brief } }));
}

export function getInteriorProject(orgId: string, projectId: string): InteriorProject | null {
  const project = projectRows(readDB()).find(item => item.orgId === orgId && item.id === projectId);
  return project ? { ...project, brief: { ...project.brief } } : null;
}

export function createInteriorProject(
  orgId: string,
  ownerUserId: string,
  input: CreateInteriorProjectInput,
): InteriorProject {
  const db = readDB();
  const timestamp = new Date().toISOString();
  const project: InteriorProject = {
    id: randomUUID(),
    orgId,
    ownerUserId,
    name: textField(input?.name, 'name', 120, true),
    projectType: enumField(input?.projectType, 'projectType', INTERIOR_PROJECT_TYPES, 'other'),
    status: 'brief',
    brief: briefInput(input?.brief),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  projectRows(db).push(project);
  writeDB(db);
  return { ...project, brief: { ...project.brief } };
}

export function updateInteriorProject(
  orgId: string,
  projectId: string,
  input: UpdateInteriorProjectInput,
): InteriorProject | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InteriorProjectValidationError('request body must be an object');
  }
  const db = readDB();
  const project = projectRows(db).find(item => item.orgId === orgId && item.id === projectId);
  if (!project) return null;

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    project.name = textField(input.name, 'name', 120, true);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'projectType')) {
    project.projectType = enumField(input.projectType, 'projectType', INTERIOR_PROJECT_TYPES);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    project.status = enumField(input.status, 'status', INTERIOR_PROJECT_STATUSES);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'brief')) {
    project.brief = briefInput(input.brief, project.brief);
  }
  project.updatedAt = new Date().toISOString();
  writeDB(db);
  return { ...project, brief: { ...project.brief } };
}
