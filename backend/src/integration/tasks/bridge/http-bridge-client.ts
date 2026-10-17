import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import WebSocket from 'ws';
import {
  AnswerInput, BridgeClient, BridgeError, BridgeEvent, BridgeStatus, BridgeUnreachableError,
} from '../../../service/tasks/bridge-client';

// Client of the bridge HTTP/WebSocket API v1. Uses node:http (not fetch) so the Host header can be
// set: the bridge only accepts loopback or the names in AGENTIC_BRIDGE_HOSTS.

export interface BridgeClientOptions {
  baseUrl: string;
  taskToken: string;
  // Defaults to the host (and port) of baseUrl, i.e. the container name.
  hostHeader?: string;
  // Per request; default 10 seconds.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpBridgeClient implements BridgeClient {
  private readonly url: URL;
  private readonly token: string;
  private readonly host: string;
  private readonly timeoutMs: number;

  constructor(options: BridgeClientOptions) {
    this.url = new URL(options.baseUrl);
    this.token = options.taskToken;
    this.host = options.hostHeader ?? this.url.host;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  prompt(text: string): Promise<BridgeStatus> {
    return this.json('POST', '/prompt', { text });
  }

  answer(input: AnswerInput): Promise<BridgeStatus> {
    const body: AnswerInput = { text: input.text };
    if (input.question !== undefined) body.question = input.question;
    if (input.grant !== undefined) body.grant = input.grant;
    return this.json('POST', '/answer', body);
  }

  cancel(): Promise<BridgeStatus> {
    return this.json('POST', '/cancel');
  }

  stop(): Promise<BridgeStatus> {
    return this.json('POST', '/stop');
  }

  status(): Promise<BridgeStatus> {
    return this.json('GET', '/status');
  }

  async events(since: number, limit?: number): Promise<BridgeEvent[]> {
    const query = `since=${since}${limit === undefined ? '' : `&limit=${limit}`}`;
    const text = await this.send('GET', `/events?${query}`);
    return parseJson<BridgeEvent[]>(() => text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as BridgeEvent));
  }

  // Backlog after `since`, then live events; ends when the bridge closes or the signal aborts.
  async *eventStream(since: number, signal?: AbortSignal): AsyncGenerator<BridgeEvent> {
    if (signal?.aborted) return;
    const wsUrl = new URL(`/events?since=${since}`, this.url);
    wsUrl.protocol = this.url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${this.token}`, Host: this.host },
      handshakeTimeout: this.timeoutMs,
    });

    const queue: BridgeEvent[] = [];
    let done = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      failure = error;
      notify();
    };

    ws.on('message', (data) => {
      try {
        queue.push(JSON.parse(data.toString()) as BridgeEvent);
        notify();
      } catch {
        ws.terminate();
        finish(new BridgeUnreachableError('invalid event frame'));
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      ws.terminate();
      finish(new BridgeError(status, codeFor(status), `Event stream refused with HTTP ${status}`));
    });
    // Before the connection opens an error means unreachable; afterwards close follows anyway.
    ws.on('error', (error) => finish(new BridgeUnreachableError(describe(error))));
    ws.on('close', () => finish());
    const onAbort = () => { ws.terminate(); finish(); };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (done) break;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      if (failure && !signal?.aborted) throw failure;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      ws.terminate();
    }
  }

  private async json(method: string, path: string, body?: unknown): Promise<BridgeStatus> {
    const text = await this.send(method, path, body);
    return parseJson<BridgeStatus>(() => JSON.parse(text) as BridgeStatus);
  }

  private send(method: string, path: string, body?: unknown): Promise<string> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const open = this.url.protocol === 'https:' ? httpsRequest : request;
    return new Promise((resolve, reject) => {
      const req = open(
        new URL(path, this.url),
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Host: this.host,
            Accept: 'application/json',
            ...(payload === undefined
              ? {}
              : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (error) => reject(new BridgeUnreachableError(describe(error))));
          res.on('aborted', () => reject(new BridgeUnreachableError('connection reset')));
          res.on('end', () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) resolve(text);
            else reject(errorFrom(status, text));
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('timeout')), this.timeoutMs);
      req.on('error', (error) => {
        clearTimeout(timer);
        reject(new BridgeUnreachableError(describe(error)));
      });
      req.end(payload);
    });
  }
}

// A bridge that answers with something that is not JSON is as good as unreachable (502, not 500).
function parseJson<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new BridgeUnreachableError('invalid response');
  }
}

function codeFor(status: number): string {
  const codes: Record<number, string> = {
    400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 503: 'starting',
  };
  return codes[status] ?? 'internal';
}

function errorFrom(status: number, text: string): BridgeError {
  try {
    const error = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;
    if (typeof error?.code === 'string' && typeof error.message === 'string') {
      return new BridgeError(status, error.code, error.message);
    }
  } catch {
    // not JSON: fall through to the generic error
  }
  return new BridgeError(status, codeFor(status), `Bridge answered HTTP ${status}`);
}

// Only the error code or a fixed word: messages of low-level errors could echo request details.
function describe(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  return code ?? error.message;
}
