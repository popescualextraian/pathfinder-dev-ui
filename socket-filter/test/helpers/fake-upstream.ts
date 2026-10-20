// A small Docker Engine API emulator on a Unix socket, standing in for /var/run/docker.sock in tests.
// It records every request it receives, so tests can assert what reached "Docker" and what did not.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface FakeContainer {
  id: string;
  name: string;
  labels: Record<string, string>;
  running: boolean;
  /** Files readable through the archive API, by absolute path. */
  files: Record<string, Buffer>;
  body?: unknown;
}

export type Override = (req: RecordedRequest, res: ServerResponse) => boolean;

/** A tar archive holding one regular file (what the daemon streams from GET /containers/{id}/archive). */
export function tarOf(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 99), 0, 'ascii');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const pad = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, pad, Buffer.alloc(1024)]);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function noContent(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

export class FakeUpstream {
  readonly dir = mkdtempSync(join(tmpdir(), 'fake-docker-'));
  readonly socketPath = join(this.dir, 'docker.sock');
  readonly requests: RecordedRequest[] = [];
  readonly containers = new Map<string, FakeContainer>();
  readonly volumes = new Map<string, { Name: string; Labels: Record<string, string> }>();
  override: Override | undefined;
  /** Bytes per write when streaming an archive (to exercise streaming through the filter). */
  archiveChunk = 7000;
  private server: Server | undefined;

  async start(): Promise<this> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.socketPath, resolve));
    return this;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    rmSync(this.dir, { recursive: true, force: true });
  }

  addContainer(name: string, patch: Partial<FakeContainer> = {}): FakeContainer {
    const container: FakeContainer = { id: randomBytes(32).toString('hex'), name, labels: {}, running: false, files: {}, ...patch };
    this.containers.set(name, container);
    return container;
  }

  /** Requests other than the given method/path pairs (e.g. to check nothing else reached upstream). */
  paths(): string[] {
    return this.requests.map((r) => `${r.method} ${r.url}`);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded: RecordedRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) };
      this.requests.push(recorded);
      if (this.override?.(recorded, res)) return;
      this.emulate(recorded, res);
    });
  }

  private emulate(req: RecordedRequest, res: ServerResponse): void {
    const url = new URL(req.url, 'http://docker');
    const path = url.pathname.replace(/^\/v1\.\d+/, '');
    const key = `${req.method} ${path}`;
    if (key === 'GET /_ping' || key === 'HEAD /_ping') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'api-version': '1.47', 'content-length': 2 });
      return void res.end(req.method === 'HEAD' ? undefined : 'OK');
    }
    if (key === 'GET /version') return json(res, 200, { ApiVersion: '1.47', Version: 'fake' });
    if (key === 'POST /volumes/create') {
      const body = JSON.parse(req.body.toString('utf8') || '{}');
      const volume = { Name: body.Name, Labels: body.Labels ?? {}, Driver: 'local' };
      this.volumes.set(body.Name, volume);
      return json(res, 201, volume);
    }
    if (key === 'POST /containers/create') {
      const name = url.searchParams.get('name') ?? '';
      if (this.containers.has(name)) return json(res, 409, { message: 'Conflict' });
      const body = JSON.parse(req.body.toString('utf8') || '{}');
      const container = this.addContainer(name, { labels: body.Labels ?? {}, body });
      return json(res, 201, { Id: container.id, Warnings: [] });
    }
    if (key === 'GET /containers/json') {
      const filters = JSON.parse(url.searchParams.get('filters') ?? '{}');
      const list = (v: unknown): string[] => (Array.isArray(v) ? v : v ? Object.keys(v as object) : []);
      const labels = list(filters.label);
      const status = list(filters.status);
      const all = url.searchParams.get('all') === 'true' || url.searchParams.get('all') === '1';
      const matches = [...this.containers.values()].filter((c) =>
        labels.every((l) => {
          const [k, v] = l.split('=');
          return v === undefined ? k in c.labels : c.labels[k] === v;
        }) &&
        (status.length ? status.includes(c.running ? 'running' : 'exited') : all || c.running));
      return json(res, 200, matches.map((c) => ({ Id: c.id, Names: [`/${c.name}`], Labels: c.labels, State: c.running ? 'running' : 'exited' })));
    }
    const volume = /^\/volumes\/([^/]+)$/.exec(path);
    if (volume) {
      const v = this.volumes.get(decodeURIComponent(volume[1]));
      if (!v) return json(res, 404, { message: 'get volume: no such volume' });
      if (req.method === 'GET') return json(res, 200, v);
      if (req.method === 'DELETE') {
        this.volumes.delete(v.Name);
        return noContent(res, 204);
      }
    }
    const m = /^\/containers\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    if (m) {
      const ref = decodeURIComponent(m[1]);
      const container = this.containers.get(ref) ?? [...this.containers.values()].find((c) => c.id === ref);
      if (!container) return json(res, 404, { message: `No such container: ${ref}` });
      const action = `${req.method} ${m[2] ?? ''}`;
      switch (action) {
        case 'GET json':
          return json(res, 200, { Id: container.id, Name: `/${container.name}`, State: { Running: container.running, Status: container.running ? 'running' : 'exited' }, Config: { Labels: container.labels } });
        case 'POST start':
          if (container.running) return noContent(res, 304);
          container.running = true;
          return noContent(res, 204);
        case 'POST stop':
          if (!container.running) return noContent(res, 304);
          container.running = false;
          return noContent(res, 204);
        case 'DELETE ':
          this.containers.delete(container.name);
          return noContent(res, 204);
        case 'GET archive':
        case 'HEAD archive': {
          const file = url.searchParams.get('path') ?? '';
          const content = container.files[file];
          if (!content) return json(res, 404, { message: 'Could not find the file in container' });
          const stat = Buffer.from(JSON.stringify({ name: file.split('/').pop(), size: content.length, mode: 420 })).toString('base64');
          res.writeHead(200, { 'content-type': 'application/x-tar', 'x-docker-container-path-stat': stat });
          if (req.method === 'HEAD') return void res.end();
          return this.stream(res, tarOf(file.split('/').pop() ?? 'file', content));
        }
      }
    }
    json(res, 404, { message: 'page not found' });
  }

  /** Writes the bytes in small chunks with pauses, chunked transfer encoding. */
  stream(res: ServerResponse, bytes: Buffer): void {
    let offset = 0;
    const next = (): void => {
      if (offset >= bytes.length) return void res.end();
      res.write(bytes.subarray(offset, offset + this.archiveChunk));
      offset += this.archiveChunk;
      setImmediate(next);
    };
    next();
  }
}
