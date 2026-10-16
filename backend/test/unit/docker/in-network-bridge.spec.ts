import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { BridgeError, BridgeUnreachableError } from '../../../src/repository/tasks/bridge/bridge-client';
import {
  demux, HELPER_SCRIPT, HelperContainer, HelperRequest, InNetworkBridgeClient, nodeCommand, parseHelperReply, replyBody,
} from '../../docker/in-network-bridge';
import { FakeBridge } from '../../helpers/fake-bridge';

const TOKEN = 'made-up-task-token-cccccccc';

// One Docker stream frame: [stream type, 0, 0, 0, size (uint32 BE)] + payload.
function frame(type: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

// Runs the helper script with the local node, exactly as the helper container does with its own.
function runLocally(request: HelperRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', HELPER_SCRIPT, JSON.stringify(request)]);
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

describe('demux', () => {
  it('splits a multiplexed exec stream into stdout and stderr', () => {
    const raw = Buffer.concat([frame(1, '{"sta'), frame(2, 'warn\n'), frame(1, 'tus":200}\n')]);
    expect(demux(raw)).toEqual({ stdout: '{"status":200}\n', stderr: 'warn\n' });
  });

  it('copes with an empty stream and ignores a truncated last frame', () => {
    expect(demux(Buffer.alloc(0))).toEqual({ stdout: '', stderr: '' });
    const truncated = frame(1, 'abcdef').subarray(0, 10);
    expect(demux(Buffer.concat([frame(1, 'ok'), truncated]))).toEqual({ stdout: 'ok', stderr: '' });
  });
});

describe('parseHelperReply', () => {
  it('reads the last JSON line', () => {
    expect(parseHelperReply('noise\n{"status":200,"body":"{}"}\n', '')).toEqual({ status: 200, body: '{}' });
    expect(parseHelperReply('{"error":"ENOTFOUND"}', '')).toEqual({ error: 'ENOTFOUND' });
  });

  it.each([
    ['empty output', ''],
    ['not JSON', 'sh: node: not found'],
    ['JSON of the wrong shape', '{"x":1}'],
  ])('throws a plain Error (not a bridge error) with stderr for %s', (_name, stdout) => {
    let error: unknown;
    try {
      parseHelperReply(stdout, 'sh: 1: node: not found');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BridgeUnreachableError);
    expect(String((error as Error).message)).toMatch(/node: not found/);
  });
});

describe('replyBody', () => {
  it('returns the body of a 2xx reply', () => {
    expect(replyBody({ status: 202, body: 'x' })).toBe('x');
  });

  it('maps a transport error to BridgeUnreachableError', () => {
    expect(() => replyBody({ error: 'ECONNREFUSED' })).toThrow(BridgeUnreachableError);
  });

  it('maps an error body to BridgeError with code and message', () => {
    const body = JSON.stringify({ error: { code: 'conflict', message: 'busy' } });
    expect(() => replyBody({ status: 409, body })).toThrow(expect.objectContaining({ status: 409, code: 'conflict', message: 'busy' }));
  });

  it('maps a non-JSON error body to BridgeError with a generic code', () => {
    let error: unknown;
    try {
      replyBody({ status: 503, body: 'down' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ status: 503, code: 'starting' });
  });
});

describe('the helper script against a fake bridge', () => {
  let bridge: FakeBridge;
  let client: InNetworkBridgeClient;

  beforeEach(async () => {
    bridge = new FakeBridge();
    await bridge.start();
    client = new InNetworkBridgeClient(bridge.url, TOKEN, runLocally);
  });
  afterEach(() => bridge.stop());

  it('status sends the bearer token and returns the parsed status', async () => {
    const status = await client.status();
    expect(status.state).toBe('idle');
    expect(bridge.requests[0]).toMatchObject({ method: 'GET', url: '/status', auth: `Bearer ${TOKEN}` });
  });

  it('prompt, answer, cancel and stop post their bodies', async () => {
    expect((await client.prompt('hello')).state).toBe('running');
    expect(bridge.requests[0]).toMatchObject({ method: 'POST', url: '/prompt', body: { text: 'hello' } });
    bridge.ask('q-1', 'which?', '2026-10-16T10:00:00Z');
    await client.answer({ text: 'that', question: 'q-1' });
    expect(bridge.requests[1]).toMatchObject({ url: '/answer', body: { text: 'that', question: 'q-1' } });
    await client.cancel();
    expect(bridge.requests[2].url).toBe('/cancel');
    expect((await client.stop()).state).toBe('stopped');
  });

  it('events parses NDJSON after since', async () => {
    bridge.emit('message', { n: 1 });
    bridge.emit('message', { n: 2 });
    expect((await client.events(1)).map((e) => e.seq)).toEqual([2]);
    expect(bridge.requests[0].url).toBe('/events?since=1');
    expect(await client.events(5)).toEqual([]);
  });

  it('maps bridge errors to BridgeError', async () => {
    await expect(client.cancel()).rejects.toMatchObject({ status: 409, message: 'No turn to cancel' });
  });

  it('maps a closed port and an unknown host to BridgeUnreachableError', async () => {
    const dead = new InNetworkBridgeClient(await closedPortUrl(), TOKEN, runLocally);
    await expect(dead.status()).rejects.toBeInstanceOf(BridgeUnreachableError);
    const unknown = new InNetworkBridgeClient('http://no-such-task.invalid:8765', TOKEN, runLocally);
    await expect(unknown.status()).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  it('maps a non-JSON 200 status body to BridgeUnreachableError', async () => {
    const server = createServer((_req, res) => res.end('not json'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const odd = new InNetworkBridgeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN, runLocally);
    await expect(odd.status()).rejects.toBeInstanceOf(BridgeUnreachableError);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('does not support the live event stream', async () => {
    const run = async () => { for await (const e of client.eventStream(0)) void e; };
    await expect(run()).rejects.toThrow(/not supported/);
  });
});

describe('HelperContainer.exec', () => {
  function fakeContainer(chunks: Buffer[], options: { endWith?: 'end' | 'close' | 'never' } = {}) {
    const calls: unknown[] = [];
    const container = {
      exec: jest.fn(async (opts: unknown) => {
        calls.push(opts);
        return {
          start: jest.fn(async () => {
            if (options.endWith === 'never') {
              const stream = new PassThrough();
              chunks.forEach((c) => stream.write(c));
              return stream;
            }
            if (options.endWith === 'close') {
              const stream = new PassThrough();
              chunks.forEach((c) => stream.write(c));
              setTimeout(() => stream.destroy(), 5);
              return stream;
            }
            return Readable.from(chunks);
          }),
          inspect: jest.fn(async () => ({ ExitCode: 0 })),
        };
      }),
    };
    return { container, calls };
  }

  const request: HelperRequest = { baseUrl: 'http://agentic-ui-task-x:8765', path: '/status', method: 'GET', token: TOKEN };

  it('runs the script with node through sh and returns the demultiplexed stdout', async () => {
    const { container, calls } = fakeContainer([frame(1, '{"status":200,'), frame(1, '"body":"{}"}\n')]);
    const helper = new HelperContainer(container as never);
    expect(await helper.exec(request)).toBe('{"status":200,"body":"{}"}\n');
    expect(calls[0]).toMatchObject({
      Cmd: ['/bin/sh', '-c', nodeCommand('"$0" "$1"'), HELPER_SCRIPT, JSON.stringify(request)],
      AttachStdout: true,
      AttachStderr: true,
    });
  });

  it('also finishes when the stream closes without end', async () => {
    const { container } = fakeContainer([frame(1, 'x')], { endWith: 'close' });
    expect(await new HelperContainer(container as never).exec(request)).toBe('x');
  });

  it('gives up when the exec never finishes', async () => {
    const { container } = fakeContainer([frame(1, 'x')], { endWith: 'never' });
    await expect(new HelperContainer(container as never, 50).exec(request)).rejects.toThrow(/did not finish/);
  });

  it('the node command prefers the image node directory and runs node -e', () => {
    expect(nodeCommand('"$0"')).toBe('PATH="/opt/node/22/bin:$PATH"; export PATH; exec node -e "$0"');
  });
});
