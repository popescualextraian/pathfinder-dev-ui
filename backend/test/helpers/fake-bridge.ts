import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { BridgeEvent, BridgeQuestion, BridgeState } from '../../src/engine/service/bridge-client';

// A small stateful stand-in for ONE task bridge (HTTP + WebSocket, API v1), started on a free
// loopback port. Enough behaviour for the REST e2e tests; not a copy of the real bridge.
export class FakeBridge {
  state: BridgeState = 'idle';
  questions: BridgeQuestion[] = [];
  events: BridgeEvent[] = [];
  requests: { method: string; url: string; auth?: string; body: unknown }[] = [];
  // When set, the next request (to `route`, e.g. 'POST /prompt', if given) answers with this error (once).
  failNext?: { status: number; code: string; message: string; route?: string };
  // Sessions besides main, in creation order; main is implicit.
  sessionNames: string[] = [];
  url = '';

  private server!: Server;
  private wss!: WebSocketServer;
  private live = new Set<WebSocket>();

  constructor(private readonly taskId = 'T-fake') {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const since = Number(new URL(req.url ?? '', 'http://x').searchParams.get('since') ?? 0);
        this.events.filter((e) => e.seq > since).forEach((e) => ws.send(JSON.stringify(e)));
        this.live.add(ws);
        ws.on('close', () => this.live.delete(ws));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.live.forEach((ws) => ws.terminate());
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get liveClients(): number {
    return this.live.size;
  }

  // Appends an event and pushes it to live WebSocket clients.
  // `name`: the session the event belongs to; none for a task-level event.
  emit(type: BridgeEvent['type'], data: Record<string, unknown> = {}, name?: string): BridgeEvent {
    const event: BridgeEvent = {
      seq: this.events.length + 1, ts: new Date().toISOString(), task: this.taskId, session: null, agent: 'fake', type, data,
    };
    if (name !== undefined) event.name = name;
    this.events.push(event);
    this.live.forEach((ws) => ws.send(JSON.stringify(event)));
    return event;
  }

  ask(id: string, text: string, asked: string): void {
    this.questions.push({ id, source: 'ask', text, options: [], recommendation: null, asked });
    this.state = 'waiting';
    this.emit('question', { id, source: 'ask', text, options: [], recommendation: null });
    this.emit('state', { state: 'waiting', reason: `question ${id}` });
  }

  private sessionList() {
    return ['main', ...this.sessionNames].map((name) => ({
      name, session: null, model: null, state: this.state, reason: '', summary: '', inbox: 0, fork_of: null, created: '2026-10-17T10:00:00Z', updated: '2026-10-17T10:00:00Z',
    }));
  }

  private status() {
    return {
      task: this.taskId, state: this.state, reason: '', branch: `agentic/${this.taskId}`, summary: 'fake summary',
      sessions: this.sessionList(), seq: this.events.length, allowed_actions: ['push'], questions: this.questions,
    };
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const body: Record<string, unknown> = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url ?? '/', 'http://x');
      this.requests.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body });
      const send = (status: number, payload: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      const fail = (status: number, code: string, message: string) => send(status, { error: { code, message } });
      const route = `${req.method} ${url.pathname}`;
      if (this.failNext && (this.failNext.route === undefined || this.failNext.route === route)) {
        const f = this.failNext;
        this.failNext = undefined;
        return fail(f.status, f.code, f.message);
      }
      switch (route) {
        case 'GET /status':
          return send(200, this.status());
        case 'GET /sessions':
          return send(200, this.sessionList());
        case 'POST /sessions': {
          const name = String(body.name ?? '');
          if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) return fail(400, 'bad_request', `Bad session name ${name}`);
          if (name === 'main' || this.sessionNames.includes(name)) return fail(409, 'conflict', `Session ${name} exists`);
          if (body.fork !== undefined && body.fork !== 'main' && !this.sessionNames.includes(String(body.fork))) {
            return fail(404, 'not_found', `Unknown session ${String(body.fork)}`);
          }
          this.sessionNames.push(name);
          if (body.text !== undefined) this.emit('message', { text: body.text }, name);
          return send(201, this.sessionList().find((s) => s.name === name));
        }
        case 'POST /prompt':
          if (this.state === 'stopped' || this.state === 'starting') return fail(409, 'conflict', `Cannot prompt in state ${this.state}`);
          this.state = 'running';
          this.emit('message', { text: body.text }, body.session === undefined ? undefined : String(body.session));
          return send(202, this.status());
        case 'POST /answer': {
          if (this.questions.length === 0) return fail(409, 'conflict', 'No open question');
          const index = this.questions.findIndex((q) => q.id === body.question);
          if (index < 0) return fail(404, 'not_found', `Unknown question ${String(body.question)}`);
          this.questions.splice(index, 1);
          this.state = this.questions.length > 0 ? 'waiting' : 'running';
          this.emit('answer', { question: body.question, text: body.text });
          return send(202, this.status());
        }
        case 'POST /cancel':
          if (this.state !== 'running') return fail(409, 'conflict', 'No turn to cancel');
          this.state = 'idle';
          this.emit('state', { state: 'idle' });
          return send(202, this.status());
        case 'POST /stop':
          this.state = 'stopped';
          this.emit('state', { state: 'stopped' });
          return send(202, this.status());
        case 'GET /events': {
          const since = Number(url.searchParams.get('since') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 1000);
          const status = url.searchParams.get('view') === 'status';
          const session = url.searchParams.get('session');
          // The status view keeps state, question, answer, error and final messages, with the full seq numbers.
          const keep = (e: BridgeEvent) => !status || ['state', 'question', 'answer', 'error'].includes(e.type) || (e.type === 'message' && e.data.final === true);
          const chosen = this.events.filter((e) => e.seq > since && keep(e) && (session === null || e.name === session)).slice(0, limit);
          return send(200, chosen.map((e) => JSON.stringify(e)).join('\n') + '\n', 'application/x-ndjson');
        }
        default:
          return fail(404, 'not_found', 'No such route');
      }
    });
  }
}
