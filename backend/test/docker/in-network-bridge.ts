import Docker from 'dockerode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  AnswerInput, BridgeError, BridgeEvent, BridgeStatus, BridgeUnreachableError,
} from '../../src/repository/tasks/bridge/bridge-client';

// The docker suite's way to reach task bridges: from INSIDE the test network, by container name,
// as the UI does in production. Docker Desktop (WSL2, macOS) cannot route from the host to
// container IP addresses, so the test process itself cannot. Instead a long-lived helper container
// (from ENGINE_IMAGE, which surely has node) sits on the test network, and every bridge request is
// one `node -e <bridge-request.cjs> <request JSON>` exec in it.

export const HELPER_SCRIPT = readFileSync(join(__dirname, 'bridge-request.cjs'), 'utf8');

// The bridge's own launcher (agentic-bridge) puts /opt/node/22/bin first; do the same, and fall
// back to whatever node is on PATH.
export function nodeCommand(args: string): string {
  return `PATH="/opt/node/22/bin:$PATH"; export PATH; exec node -e ${args}`;
}

export interface HelperRequest {
  baseUrl: string;
  path: string;
  method: string;
  token: string;
  body?: unknown;
  timeoutMs?: number;
}

export type HelperReply = { status: number; body: string } | { error: string };

// Runs one helper request somewhere (helper container, or locally in unit tests); returns stdout.
export type RunHelper = (request: HelperRequest) => Promise<string>;

// Splits Docker's multiplexed exec output (no TTY): frames of [type, 0, 0, 0, size uint32 BE] + data,
// type 1 stdout, 2 stderr. A truncated last frame is dropped.
export function demux(raw: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let at = 0;
  while (at + 8 <= raw.length) {
    const type = raw[at];
    const size = raw.readUInt32BE(at + 4);
    if (at + 8 + size > raw.length) break;
    const data = raw.subarray(at + 8, at + 8 + size);
    (type === 2 ? err : out).push(data);
    at += 8 + size;
  }
  return { stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
}

// The helper prints one JSON line. Anything else means the helper itself broke (no node, bad
// script): a plain Error with stderr, so the suite fails clearly instead of waiting on "unreachable".
export function parseHelperReply(stdout: string, stderr: string): HelperReply {
  const line = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  let parsed: unknown;
  try {
    parsed = line === undefined ? undefined : JSON.parse(line);
  } catch {
    parsed = undefined;
  }
  const reply = parsed as Partial<{ status: unknown; body: unknown; error: unknown }> | undefined;
  if (reply && typeof reply.error === 'string') return { error: reply.error };
  if (reply && typeof reply.status === 'number' && typeof reply.body === 'string') return { status: reply.status, body: reply.body };
  throw new Error(`Bridge helper gave no usable reply; stdout: ${stdout.slice(0, 500)} stderr: ${stderr.slice(0, 500)}`);
}

const CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 503: 'starting',
};

// Same error mapping as BridgeClient: transport failure is unreachable, non-2xx is BridgeError.
export function replyBody(reply: HelperReply): string {
  if ('error' in reply) throw new BridgeUnreachableError(reply.error);
  if (reply.status >= 200 && reply.status < 300) return reply.body;
  try {
    const error = (JSON.parse(reply.body) as { error?: { code?: unknown; message?: unknown } }).error;
    if (typeof error?.code === 'string' && typeof error.message === 'string') {
      throw new BridgeError(reply.status, error.code, error.message);
    }
  } catch (error) {
    if (error instanceof BridgeError) throw error;
  }
  throw new BridgeError(reply.status, CODES[reply.status] ?? 'internal', `Bridge answered HTTP ${reply.status}`);
}

function parseJson<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new BridgeUnreachableError('invalid response');
  }
}

// The BridgeClient surface TasksService uses, over the helper. No live event stream.
export class InNetworkBridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly run: RunHelper,
  ) {}

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
    return parseJson(() => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as BridgeEvent));
  }

  // eslint-disable-next-line require-yield
  async *eventStream(since: number): AsyncGenerator<BridgeEvent> {
    throw new Error(`The live event stream (since ${since}) is not supported in the docker suite`);
  }

  private async json(method: string, path: string, body?: unknown): Promise<BridgeStatus> {
    const text = await this.send(method, path, body);
    return parseJson(() => JSON.parse(text) as BridgeStatus);
  }

  private async send(method: string, path: string, body?: unknown): Promise<string> {
    const request: HelperRequest = { baseUrl: this.baseUrl, path, method, token: this.token };
    if (body !== undefined) request.body = body;
    const stdout = await this.run(request);
    return replyBody(parseHelperReply(stdout, ''));
  }
}

type ExecContainer = Pick<Docker.Container, 'exec'>;

// The long-lived helper container and the exec of one request in it.
export class HelperContainer {
  constructor(
    private readonly container: ExecContainer,
    private readonly execTimeoutMs = 30_000,
  ) {}

  // Creates and starts the helper on `network`. The image's entrypoint (task setup) is bypassed:
  // the container only keeps an idle node alive.
  static async create(docker: Docker, options: { image: string; network: string; name: string }): Promise<HelperContainer> {
    const container = await docker.createContainer({
      Image: options.image,
      name: options.name,
      Entrypoint: ['/bin/sh', '-c'],
      Cmd: [nodeCommand(`'setInterval(() => {}, 1 << 30)'`)],
      Labels: { 'agentic-ui.kind': 'test' },
      HostConfig: { NetworkMode: options.network },
    });
    await container.start();
    return new HelperContainer(container);
  }

  // Runs the helper script for `request`; returns stdout. Throws (plain Error) when the helper's
  // output is unusable, with its stderr.
  async exec(request: HelperRequest): Promise<string> {
    const exec = await this.container.exec({
      Cmd: ['/bin/sh', '-c', nodeCommand('"$0" "$1"'), HELPER_SCRIPT, JSON.stringify(request)],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: false, Detach: false, Tty: false })) as Readable;
    const { stdout, stderr } = demux(await collect(stream, this.execTimeoutMs));
    if (!stdout.trim()) {
      const code = await exec.inspect().then((info) => info.ExitCode, () => undefined);
      throw new Error(`Bridge helper printed nothing (exit code ${String(code)}); stderr: ${stderr.slice(0, 500)}`);
    }
    return stdout;
  }

  // Polls until node runs in the helper and the script answers (any reply, here: nothing listens).
  async waitUntilReady(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const stdout = await this.exec({ baseUrl: 'http://127.0.0.1:9', path: '/', method: 'GET', token: 'x', timeoutMs: 2000 });
        parseHelperReply(stdout, '');
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// Reads the whole exec stream; done on 'end' or 'close' (a hijacked socket may only close).
function collect(stream: Readable, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const finish = () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error(`Bridge helper exec did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once('end', finish);
    stream.once('close', finish);
    stream.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
