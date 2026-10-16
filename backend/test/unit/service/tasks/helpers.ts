import { BridgeStatus } from '../../../../src/repository/tasks/bridge/bridge-client';
import { TaskRecord } from '../../../../src/repository/tasks/task-record.repository';
import { TaskLauncher } from '../../../../src/repository/tasks/launcher/task-launcher';
import { EngineConfig } from '../../../../src/commons/engine-config';

export const TASK_TOKEN = 'task-token-' + 'a'.repeat(32);
export const AGENT_TOKEN = 'agent-token-' + 'b'.repeat(32);

export const config = {
  repoUrl: 'https://github.com/acme/default.git',
  allowedRepoHosts: ['github.com'],
  maxRunning: 2,
} as EngineConfig;

export function status(over: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    task: 'T-20260101-abcd', state: 'idle', reason: '', branch: 'agentic/T-20260101-abcd', summary: '',
    seq: 1, allowed_actions: ['push'], questions: [], ...over,
  };
}

export function record(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'T-20260101-abcd', prompt: 'do it', repoUrl: config.repoUrl, branch: 'agentic/T-20260101-abcd',
    containerName: 'agentic-ui-task-T-20260101-abcd', bridgeUrl: 'http://agentic-ui-task-T-20260101-abcd:8765',
    taskToken: TASK_TOKEN, agentToken: AGENT_TOKEN, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', lastState: 'idle', ...over,
  };
}

// In-memory stand-in for the record repository.
export function fakeRecords(initial: TaskRecord[] = []) {
  const map = new Map(initial.map((r) => [r.id, { ...r }]));
  return {
    map,
    create: jest.fn(async (r: TaskRecord) => { map.set(r.id, { ...r }); return r; }),
    get: jest.fn(async (id: string) => map.get(id)),
    list: jest.fn(async () => [...map.values()]),
    update: jest.fn(async (id: string, patch: Partial<TaskRecord>) => {
      const next = { ...map.get(id)!, ...patch };
      map.set(id, next);
      return next;
    }),
    delete: jest.fn(async (id: string) => { map.delete(id); }),
  };
}

export function fakeLauncher(over: Partial<Record<keyof TaskLauncher, unknown>> = {}) {
  const base = {
    launch: jest.fn(async () => ({ bridgeUrl: 'http://bridge:8765' })),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    inspect: jest.fn(async () => ({ exists: true, running: true, bridgeUrl: 'http://bridge:8765' })),
    countRunning: jest.fn(async () => 0),
  };
  return Object.assign(base, over);
}

export function fakeBridge(over: Record<string, unknown> = {}) {
  const base = {
    prompt: jest.fn(async () => status({ state: 'running' })),
    answer: jest.fn(async () => status({ state: 'running' })),
    cancel: jest.fn(async () => status()),
    stop: jest.fn(async () => status({ state: 'stopped' })),
    status: jest.fn(async () => status()),
    events: jest.fn(async () => []),
    eventStream: jest.fn(),
  };
  return Object.assign(base, over);
}
