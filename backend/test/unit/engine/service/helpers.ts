import { BridgeStatus } from '../../../../src/engine/service/bridge-client';
import { TaskRecord } from '../../../../src/engine/repository/task-record.repository';
import { TaskLauncher } from '../../../../src/engine/service/task-launcher';
import { EngineConfig } from '../../../../src/commons/engine-config';

export const TASK_TOKEN = 'task-token-' + 'a'.repeat(32);
export const AGENT_TOKEN = 'agent-token-' + 'b'.repeat(32);

export const config = {
  repoUrl: 'https://github.com/acme/default.git',
  allowedRepoHosts: ['github.com', 'gitlab.com'],
  repositories: [
    { name: 'default', url: 'https://github.com/acme/default.git', default: true },
    { name: 'docs', url: 'https://gitlab.com/acme/docs.git', default: false },
  ],
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
    update: jest.fn(async (id: string, patchOrFn: Partial<TaskRecord> | ((r: TaskRecord) => Partial<TaskRecord> | undefined)) => {
      const current = map.get(id)!;
      const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn;
      if (patch === undefined) return current;
      const next = { ...current, ...patch };
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
    hasFiles: jest.fn(async (): Promise<Record<string, boolean>> => ({})),
    readFile: jest.fn(async (): Promise<string | null> => null),
    readLedger: jest.fn(async (): Promise<string | undefined> => undefined),
  };
  return Object.assign(base, over);
}

export function fakeBridge(over: Record<string, unknown> = {}) {
  const base = {
    prompt: jest.fn(async () => status({ state: 'running' })),
    answer: jest.fn(async () => status({ state: 'running' })),
    cancel: jest.fn(async () => status()),
    sessions: jest.fn(async () => []),
    addSession: jest.fn(async (i: { name: string }) => ({ name: i.name })),
    stop: jest.fn(async () => status({ state: 'stopped' })),
    status: jest.fn(async () => status()),
    events: jest.fn(async () => []),
    eventStream: jest.fn(),
  };
  return Object.assign(base, over);
}

// A valid cost-record/v1 line of a task (made-up numbers).
export function ledgerLine(task = 'T-20260101-abcd', input = 100, session = 's1'): string {
  return JSON.stringify({
    schema: 'cost-record/v1', ts: '2026-01-01T00:10:00Z', project: 'p', harness: 'claude-code', session,
    context: { kind: 'task', task }, models: [],
    totals: { input, output: 20, cache_read: 0, cache_write: 0, cost: { estimate: 0.5 } },
  });
}
