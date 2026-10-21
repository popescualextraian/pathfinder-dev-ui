import { setTimeout as sleep } from 'node:timers/promises';

// What the service needs of a task's bridge. An outer layer implements it (HTTP/WebSocket
// client of the bridge API v1); Nest modules wire it in through BRIDGE_CLIENT_FACTORY.

export type BridgeState =
  | 'starting' | 'running' | 'waiting' | 'idle' | 'suspended' | 'stopped' | 'failed' | 'interrupted';

export interface BridgeQuestion {
  id: string;
  source: 'permission' | 'ask';
  text: string;
  options: string[];
  recommendation: string | null;
  asked: string;
  // Name of the session that asked; absent in answers of older bridges (then main).
  session?: string;
}

export interface BridgeSession {
  name: string;
  session: string | null;
  model: string | null;
  state: BridgeState;
  reason: string;
  summary: string;
  inbox: number;
  fork_of: string | null;
  created: string;
  updated: string;
}

export interface AddSessionInput {
  name: string;
  model?: string;
  fork?: string;
  text?: string;
}

export interface BridgeStatus {
  task: string;
  state: BridgeState;
  reason: string;
  branch: string | null;
  summary: string;
  seq: number;
  allowed_actions: string[];
  questions: BridgeQuestion[];
  // Absent in answers of older bridges.
  sessions?: BridgeSession[];
  [key: string]: unknown;
}

export type BridgeEventType = 'state' | 'message' | 'tool' | 'plan' | 'question' | 'answer' | 'gate' | 'error' | 'app';

export interface BridgeEvent {
  seq: number;
  ts: string;
  task: string;
  session: string | null;
  // Name of the session the event belongs to; absent on task-level events.
  name?: string;
  agent: string;
  type: BridgeEventType;
  data: Record<string, unknown>;
}

export interface AnswerInput {
  text: string;
  question?: string;
  grant?: string[];
  session?: string;
}

// `preparing`: its prepare step runs; `exited`: the app ended on its own (exit_code set).
export type BridgeAppState = 'running' | 'preparing' | 'stopped' | 'exited' | 'failed';
export type AppAction = 'start' | 'stop' | 'restart';

// An app of the task container as the bridge reports it; `ports` are container ports, `since` unix seconds.
export interface BridgeApp {
  name: string;
  state: BridgeAppState;
  ports: number[];
  url: string;
  since: number | null;
  exit_code?: number | null;
}

export class BridgeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export class BridgeUnreachableError extends Error {
  constructor(reason: string) {
    super(`Bridge unreachable: ${reason}`);
    this.name = 'BridgeUnreachableError';
  }
}

export interface BridgeClient {
  // `session` names the target session; without it the bridge uses main.
  prompt(text: string, session?: string): Promise<BridgeStatus>;
  answer(input: AnswerInput): Promise<BridgeStatus>;
  cancel(session?: string): Promise<BridgeStatus>;
  sessions(): Promise<BridgeSession[]>;
  addSession(input: AddSessionInput): Promise<BridgeSession>;
  stop(): Promise<BridgeStatus>;
  status(): Promise<BridgeStatus>;
  // `view` 'status' keeps only state, question, answer, error and final messages (same seq numbers, with gaps).
  events(since: number, limit?: number, view?: 'full' | 'status', session?: string): Promise<BridgeEvent[]>;
  apps(): Promise<BridgeApp[]>;
  // start and restart may take minutes (the app's prepare step); stop is quick.
  appAction(name: string, action: AppAction): Promise<BridgeApp>;
  appLogs(name: string, lines: number): Promise<string[]>;
  // Backlog after `since`, then live events; ends when the bridge closes or the signal aborts.
  eventStream(since: number, signal?: AbortSignal): AsyncGenerator<BridgeEvent>;
}

// Injection token of the function that builds a BridgeClient for a task; tests replace it.
export const BRIDGE_CLIENT_FACTORY = Symbol('BRIDGE_CLIENT_FACTORY');

export type BridgeClientFactory = (record: { bridgeUrl?: string; taskToken: string }) => BridgeClient;

export interface WaitForStatusOptions {
  timeoutMs: number;
  intervalMs: number;
}

// Polls status() until the bridge answers. 503 starting and unreachable count as not yet; any other
// bridge error (for example 401) is returned at once.
export async function waitForStatus(client: Pick<BridgeClient, 'status'>, options: WaitForStatusOptions): Promise<BridgeStatus> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try {
      return await client.status();
    } catch (error) {
      const notYet = error instanceof BridgeUnreachableError || (error instanceof BridgeError && error.status === 503);
      if (!notYet) throw error;
      if (Date.now() + options.intervalMs >= deadline) {
        throw new Error(`Bridge did not answer within ${options.timeoutMs} ms`, { cause: error });
      }
    }
    await sleep(options.intervalMs);
  }
}
