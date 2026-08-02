export type User = {
  id: string;
  email: string;
  displayName: string;
  instanceRole: 'user' | 'instance_admin';
  theme: 'system' | 'light' | 'dark';
};
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string;
  role: 'owner' | 'admin' | 'member';
  version: number;
};
export type WorkflowState = {
  id: string;
  name: string;
  color: string;
  entityType: 'task' | 'flow';
  taskSemantic?: string | null;
  flowSemantic?: string | null;
  position: number;
  version: number;
  isInitial: boolean;
  archivedAt?: string | null;
};
export type Project = {
  id: string;
  name: string;
  issueKey: string;
  description: string;
  status: string;
  priority: string;
  health: string;
  currentFocus: string;
  version: number;
  updatedAt: string;
};
export type Repository = {
  id: string;
  provider: string;
  providerRepositoryId: string | null;
  owner: string;
  name: string;
  fullName: string;
  remoteUrl: string;
  defaultBranch: string;
  visibility: 'private' | 'internal' | 'public';
  archived: boolean;
  version: number;
};
export type Flow = {
  id: string;
  name: string;
  purpose: string;
  priority: string;
  health: string;
  workflowStateId: string;
  currentFocus: string;
  nextRecommendedAction: string;
  version: number;
  updatedAt: string;
};
export type Task = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  objective: string;
  constraints: string[];
  riskLevel: string;
  expectedArtifacts: string[];
  targetRepositoryId: string | null;
  targetBranch: string;
  includedPaths: string[];
  excludedPaths: string[];
  contextPolicy: Record<string, unknown>;
  memoryMode: string;
  requiredApprovals: string[];
  coordinatingMembershipId: string | null;
  projectId: string;
  workflowStateId: string;
  priority: string;
  dueDate: string | null;
  version: number;
  updatedAt: string;
  humanReviewRequired: boolean;
  reviewStatus: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

let csrfToken = '';
export function setCsrfToken(value: string) {
  csrfToken = value;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: any,
  ) {
    super(payload?.detail ?? payload?.message ?? 'Request failed');
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isMutation = !['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase());
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (isMutation && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function mutation(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, version?: number): RequestInit {
  return {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: version ? { 'If-Match': String(version) } : undefined,
  };
}
