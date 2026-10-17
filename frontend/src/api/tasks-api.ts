import type { AnswerRequest, StartTaskRequest, Task } from './models';
import { postJson, request } from './http';

export { ApiError } from './http';

const taskUrl = (id: string) => `/api/tasks/${encodeURIComponent(id)}`;

export const listTasks = () => request<Task[]>('/api/tasks');
export const getTask = (id: string) => request<Task>(taskUrl(id));
export const startTask = (body: StartTaskRequest) => postJson<Task>('/api/tasks', body);
export const sendPrompt = (id: string, text: string) => postJson<Task>(`${taskUrl(id)}/prompt`, { text });
export const answer = (id: string, body: AnswerRequest) => postJson<Task>(`${taskUrl(id)}/answer`, body);
export const cancel = (id: string) => postJson<Task>(`${taskUrl(id)}/cancel`);
export const close = (id: string) => postJson<Task>(`${taskUrl(id)}/close`);
export const deleteTask = (id: string) => request<void>(taskUrl(id), { method: 'DELETE' });
