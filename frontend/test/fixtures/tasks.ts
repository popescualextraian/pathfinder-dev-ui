import type { SessionView, Task } from '../../src/api/models';

export function makeSession(over: Partial<SessionView> = {}): SessionView {
  return { name: 'main', state: 'running', createdAt: '2026-10-17T10:00:00Z', questions: 0, ...over };
}

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 'T-1',
    title: 'Task one',
    prompt: 'do it',
    repository: 'repo-a',
    repoUrl: 'https://example.com/a.git',
    branch: 'agentic/T-1',
    state: 'running',
    section: 'working',
    questions: [],
    sessions: [makeSession()],
    createdAt: '2026-10-17T10:00:00Z',
    updatedAt: '2026-10-17T10:00:00Z',
    closed: false,
    ...over,
  };
}
