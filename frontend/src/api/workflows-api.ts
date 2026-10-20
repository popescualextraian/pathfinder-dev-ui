import type { WorkflowList, WorkflowRun } from './models';
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
