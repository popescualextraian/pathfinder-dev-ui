import type { StoredWorkflow, WorkflowDefinition, WorkflowList, WorkflowRun, WorkflowValidationError } from './models';
import { ApiError, postJson, request } from './http';

const runUrl = (id: string) => `/api/workflow-runs/${encodeURIComponent(id)}`;

/** Null when workflows are off (the backend has no routes: 404). */
export async function listWorkflows(): Promise<WorkflowList | null> {
  try {
    return await request<WorkflowList>('/api/workflows');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const listRuns = (itemId?: string) =>
  request<WorkflowRun[]>(
    itemId === undefined ? '/api/workflow-runs' : `/api/workflow-runs?itemId=${encodeURIComponent(itemId)}`,
  );
export const startRun = (itemId: string, workflowId: string) =>
  postJson<WorkflowRun>('/api/workflow-runs', { itemId, workflowId });
export const advanceRun = (id: string, force?: boolean) =>
  postJson<WorkflowRun>(`${runUrl(id)}/advance`, force === undefined ? undefined : { force });
export const stopRun = (id: string) => postJson<WorkflowRun>(`${runUrl(id)}/stop`);

const defUrl = (id: string) => `/api/workflows/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const readWorkflow = (id: string) => request<StoredWorkflow>(defUrl(id));
/** The first broken rule (the backend stops at the first), empty when the definition is fine. Writes nothing. */
export const validateWorkflow = async (definition: WorkflowDefinition) =>
  (await postJson<{ errors: WorkflowValidationError[] }>('/api/workflows/validate', { definition })).errors;
export const createWorkflow = (id: string, definition: WorkflowDefinition) =>
  postJson<StoredWorkflow>('/api/workflows', { id, definition });
export const updateWorkflow = (id: string, definition: WorkflowDefinition, version: string) =>
  request<StoredWorkflow>(defUrl(id), json('PUT', { definition, version }));
export const deleteWorkflow = (id: string, version: string) =>
  request<void>(`${defUrl(id)}?version=${encodeURIComponent(version)}`, { method: 'DELETE' });
export const deleteRefusedWorkflow = (file: string, version: string) =>
  request<void>(`/api/workflows/refused/${encodeURIComponent(file)}?version=${encodeURIComponent(version)}`, {
    method: 'DELETE',
  });
