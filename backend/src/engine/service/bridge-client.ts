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
  [key: string]: unknown;
}

export type BridgeEventType = 'state' | 'message' | 'tool' | 'plan' | 'question' | 'answer' | 'gate' | 'error';

export interface BridgeEvent {
  seq: number;
  ts: string;
  task: string;
  session: string | null;
  agent: string;
  type: BridgeEventType;
  data: Record<string, unknown>;
}

export interface AnswerInput {
  text: string;
  question?: string;
  grant?: string[];
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
  prompt(text: string): Promise<BridgeStatus>;
  answer(input: AnswerInput): Promise<BridgeStatus>;
  cancel(): Promise<BridgeStatus>;
  stop(): Promise<BridgeStatus>;
  status(): Promise<BridgeStatus>;
  // `view` 'status' keeps only state, question, answer, error and final messages (same seq numbers, with gaps).
  events(since: number, limit?: number, view?: 'full' | 'status'): Promise<BridgeEvent[]>;
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
