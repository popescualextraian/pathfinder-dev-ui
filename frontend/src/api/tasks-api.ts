import type { AddSessionRequest, AnswerRequest, SessionView, StartTaskRequest, Task, TaskApp } from './models';
import { postJson, request } from './http';

export { ApiError } from './http';

const taskUrl = (id: string) => `/api/tasks/${encodeURIComponent(id)}`;

export const listTasks = () => request<Task[]>('/api/tasks');
export const getTask = (id: string) => request<Task>(taskUrl(id));
export const startTask = (body: StartTaskRequest) => postJson<Task>('/api/tasks', body);
export const sendPrompt = (id: string, text: string, session?: string) =>
  postJson<Task>(`${taskUrl(id)}/prompt`, session ? { text, session } : { text });
export const listSessions = (id: string) => request<SessionView[]>(`${taskUrl(id)}/sessions`);
export const addSession = (id: string, body: AddSessionRequest) => postJson<Task>(`${taskUrl(id)}/sessions`, body);
export const answer = (id: string, body: AnswerRequest) => postJson<Task>(`${taskUrl(id)}/answer`, body);
export const cancel = (id: string, session?: string) =>
  postJson<Task>(`${taskUrl(id)}/cancel`, session ? { session } : undefined);
export const close = (id: string) => postJson<Task>(`${taskUrl(id)}/close`);
export const deleteTask = (id: string) => request<void>(taskUrl(id), { method: 'DELETE' });

const appUrl = (id: string, name: string) => `${taskUrl(id)}/apps/${encodeURIComponent(name)}`;

export const listApps = (id: string) => request<TaskApp[]>(`${taskUrl(id)}/apps`);
// Start and restart may take minutes while the app prepares: fetch has no timeout of its own.
export const startApp = (id: string, name: string) => postJson<TaskApp>(`${appUrl(id, name)}/start`);
export const stopApp = (id: string, name: string) => postJson<TaskApp>(`${appUrl(id, name)}/stop`);
export const restartApp = (id: string, name: string) => postJson<TaskApp>(`${appUrl(id, name)}/restart`);
export const appLogs = (id: string, name: string, lines = 200) =>
  request<{ lines: string[] }>(`${appUrl(id, name)}/logs?lines=${lines}`);
