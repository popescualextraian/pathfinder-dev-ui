// The filter server: HTTP/1.1 on a Unix socket, every request decided by the rule function, allowed
// requests forwarded to the real Docker socket with rebuilt framing and headers, responses streamed back.
import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import {
  Agent,
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
  createServer,
  request,
} from 'node:http';
import { Duplex, pipeline } from 'node:stream';
import { FilterConfig } from './config';
import { CheckLabel, Forward, MAX_BODY_BYTES, decide, inspectShowsKind } from './rules';

export type Log = (line: string) => void;

export interface FilterServer {
  close(): Promise<void>;
}

export interface Limits {
  maxConnections: number;
  /** Time a client has to send its whole request (headers and body). Responses are not limited. */
  requestTimeoutMs: number;
}

export const DEFAULT_LIMITS: Limits = { maxConnections: 64, requestTimeoutMs: 30000 };

const MAX_INSPECT_BYTES = 4 * 1024 * 1024;

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// For the log: the path without the query (the query of a container create carries Env), printable ASCII only.
function logPath(url: string): string {
  return url.split('?')[0].replace(/[^\x21-\x7e]/g, '?').slice(0, 200);
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = String(headers.connection ?? '').toLowerCase().split(',').map((t) => t.trim());
  const out: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(key) && !named.includes(key)) out[key] = value;
  }
  return out;
}

function forbiddenRaw(reason: string): string {
  const body = JSON.stringify({ message: `docker-filter: ${reason}` });
  return `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
}

function prepareSocketPath(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSocket()) throw new Error('docker-filter: FILTER_LISTEN exists and is not a socket');
  unlinkSync(path);
}

export async function startFilterServer(
  config: FilterConfig,
  log: Log = (line) => console.log(line),
  limitOverrides: Partial<Limits> = {},
): Promise<FilterServer> {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const agent = new Agent({ keepAlive: true });

  function refuse(req: IncomingMessage, res: ServerResponse, reason: string, close = false): void {
    log(`docker-filter: refused ${req.method} ${logPath(req.url ?? '')}: ${reason}`);
    const body = JSON.stringify({ message: `docker-filter: ${reason}` });
    res.writeHead(403, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...(close ? { connection: 'close' } : {}),
    });
    res.end(body);
  }

  function failUpstream(res: ServerResponse): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = JSON.stringify({ message: 'docker-filter: upstream unavailable' });
    res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }

  function upstreamHeaders(method: string, body: Buffer | undefined): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = { host: 'docker' };
    if (body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = body.length;
    } else if (method !== 'GET' && method !== 'HEAD') {
      headers['content-length'] = 0;
    }
    return headers;
  }

  function forward(target: Forward, req: IncomingMessage, res: ServerResponse): void {
    if (config.debug) log(`docker-filter: allowed ${req.method} ${logPath(req.url ?? '')}`);
    const up = request(
      { socketPath: config.upstream, agent, method: target.method, path: target.path, headers: upstreamHeaders(target.method, target.body) },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, responseHeaders(upRes.headers));
        pipeline(upRes, res, () => undefined);
      },
    );
    // Never let a hijacked upstream connection through.
    up.on('upgrade', (_res, socket: Duplex) => {
      socket.destroy();
      res.destroy();
    });
    up.on('error', () => failUpstream(res));
    res.on('close', () => {
      if (!res.writableFinished) up.destroy();
    });
    up.end(target.body);
  }

  function inspect(path: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const up = request({ socketPath: config.upstream, agent, method: 'GET', path, headers: { host: 'docker' } }, (upRes) => {
        const chunks: Buffer[] = [];
        let size = 0;
        upRes.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_INSPECT_BYTES) {
            up.destroy(new Error('inspect too large'));
            return;
          }
          chunks.push(c);
        });
        upRes.on('end', () => resolve({ status: upRes.statusCode ?? 502, headers: upRes.headers, body: Buffer.concat(chunks) }));
        upRes.on('error', reject);
      });
      up.on('error', reject);
      up.end();
    });
  }

  async function checkLabel(decision: CheckLabel, req: IncomingMessage, res: ServerResponse): Promise<void> {
    let answer;
    try {
      answer = await inspect(decision.inspectPath);
    } catch {
      failUpstream(res);
      return;
    }
    if (answer.status !== 200) {
      // A missing container (404) and other daemon errors pass through as they are.
      res.writeHead(answer.status, { ...responseHeaders(answer.headers), 'content-length': answer.body.length });
      res.end(answer.body);
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(answer.body.toString('utf8'));
    } catch {
      body = undefined;
    }
    if (!inspectShowsKind(decision.resource, decision.name, body, config)) {
      refuse(req, res, `${decision.resource} is not a task ${decision.resource} (kind label or name mismatch)`);
      return;
    }
    forward(decision.forward, req, res);
  }

  // Reads the request body up to the limit; undefined when over it (the request is then refused and the
  // connection closed, as the rest of the body is not read).
  function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    return new Promise((resolve, reject) => {
      const declared = req.headers['content-length'];
      if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
        resolve(undefined);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const onData = (c: Buffer): void => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          req.off('data', onData);
          req.off('end', onEnd);
          req.pause();
          resolve(undefined);
          return;
        }
        chunks.push(c);
      };
      const onEnd = (): void => resolve(Buffer.concat(chunks));
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', reject);
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    if (body === undefined) {
      res.on('finish', () => req.socket.destroySoon());
      refuse(req, res, 'request body too large', true);
      return;
    }
    const decision = decide({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body }, config);
    if (decision.action === 'refuse') refuse(req, res, decision.reason);
    else if (decision.action === 'forward') forward(decision, req, res);
    else await checkLabel(decision, req, res);
  }

  // Node checks the request timeouts only every connectionsCheckingInterval (default 30 s).
  const checkEvery = Math.max(50, Math.min(5000, Math.floor(limits.requestTimeoutMs / 2)));
  const server = createServer({ connectionsCheckingInterval: checkEvery }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) refuse(req, res, 'internal error', true);
      else res.destroy();
    });
  });

  server.maxConnections = limits.maxConnections;
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.requestTimeoutMs;

  // Upgrades (attach, exec start, session, ...) and CONNECT are hijacks of the connection: always refused.
  const refuseHijack = (req: IncomingMessage, socket: Duplex): void => {
    const reason = req.method === 'CONNECT' ? 'CONNECT not allowed' : 'connection upgrade not allowed';
    log(`docker-filter: refused ${req.method} ${logPath(req.url ?? '')}: ${reason}`);
    socket.end(forbiddenRaw(reason));
  };
  server.on('upgrade', refuseHijack);
  server.on('connect', refuseHijack);
  server.on('clientError', (error: NodeJS.ErrnoException, socket: Duplex) => {
    log(`docker-filter: refused a malformed request: ${String(error.code ?? 'parse error').replace(/[^\x21-\x7e]/g, '?')}`);
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });

  prepareSocketPath(config.listen);
  // The socket is created with 0660 from the start (no window with wider permissions).
  const umask = process.umask(0o117);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.listen, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } finally {
    process.umask(umask);
  }
  chmodSync(config.listen, 0o660);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        agent.destroy();
      }),
  };
}
