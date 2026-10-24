import type {
  StoredWorkflow, TaskRunInput, WorkflowDefinition, WorkflowGenerationSummary, WorkflowGenerationView, WorkflowList, WorkflowRun,
  WorkflowValidationError,
} from './models';
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
/** A plain task on the item (a run of kind `task`). Empty optional fields are left out (the backend refuses ""). */
export const startTask = (itemId: string, input: TaskRunInput) =>
  postJson<WorkflowRun>('/api/workflow-runs/task', {
    itemId,
    prompt: input.prompt,
    ...(input.title && { title: input.title }),
    ...(input.model && { model: input.model }),
    ...(input.repository && { repository: input.repository }),
  });
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

const genUrl = (id: string) => `/api/workflows/generations/${encodeURIComponent(id)}`;

export const startGeneration = (description: string, model?: string) =>
  postJson<WorkflowGenerationView>('/api/workflows/generations', model ? { description, model } : { description });
/** Open generations (not saved or discarded), oldest first, without drafts. */
export const listGenerations = () => request<WorkflowGenerationSummary[]>('/api/workflows/generations');
export const getGeneration = (id: string) => request<WorkflowGenerationView>(genUrl(id));
export const requestGenerationChanges = (id: string, text: string) =>
  postJson<WorkflowGenerationView>(`${genUrl(id)}/changes`, { text });
export const discardGeneration = (id: string) => postJson<WorkflowGenerationView>(`${genUrl(id)}/discard`);
/** Marks the draft as saved (after the editor saved it) and closes the generator's task. */
export const markGenerationSaved = (id: string) => postJson<WorkflowGenerationView>(`${genUrl(id)}/saved`);
