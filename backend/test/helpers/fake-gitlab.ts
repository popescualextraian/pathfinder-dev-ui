import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeIssue {
  iid: number;
  title: string;
  description: string | null;
  labels: string[];
  state: 'opened' | 'closed';
  assignees: Array<{ username: string }>;
  web_url: string;
  updated_at: string;
  user_notes_count: number;
}

export interface FakeNote {
  id: number;
  body: string;
  system: boolean;
  author: { username: string };
}

export interface RecordedRequest {
  method: string;
  path: string; // decoded path below /api/v4, without the query
  query: Record<string, string>;
  body?: Record<string, unknown>;
}

type Send = (status: number, payload: unknown, headers?: Record<string, string>) => void;

// Small in-memory GitLab (REST v4 subset), served on a random local port.
export class FakeGitlab {
  static readonly PROJECT = 'group/project';
  user = 'tester';
  issues = new Map<number, FakeIssue>();
  labels = new Set<string>();
  // Users known to GET /users, by username (the token's user is always known).
  users = new Map<string, number>([['tester', 1]]);
  notes = new Map<number, FakeNote[]>();
  requests: RecordedRequest[] = [];
  // Set to make every authenticated request fail with this status (for example 500).
  forceStatus?: number;
  // Set to make POST /labels answer 403.
  forbidLabelCreate = false;
  // Set to make GET notes answer 500.
  failNotesReads = false;
  baseUrl = '';
  private nextIid = 1;
  private nextNote = 1;
  private clock = Date.now() - 60_000;
  private server: Server = createServer((req, res) => void this.handle(req, res));

  constructor(readonly token = 'secret-token') {}

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get writes(): RecordedRequest[] {
    return this.requests.filter((r) => r.method !== 'GET');
  }

  addIssue(init: { title?: string; description?: string | null; labels?: string[]; state?: 'opened' | 'closed'; assignees?: string[]; updatedAt?: string } = {}): number {
    const iid = this.nextIid++;
    this.issues.set(iid, {
      iid,
      title: init.title ?? `Issue ${iid}`,
      description: init.description === undefined ? `Description ${iid}` : init.description,
      labels: init.labels ?? [],
      state: init.state ?? 'opened',
      assignees: (init.assignees ?? []).map((username) => ({ username })),
      web_url: `${this.baseUrl}/${FakeGitlab.PROJECT}/-/issues/${iid}`,
      updated_at: init.updatedAt ?? this.tick(),
      user_notes_count: 0,
    });
    return iid;
  }

  addNote(iid: number, body: string, system = false, author = this.user): FakeNote {
    const note = { id: this.nextNote++, body, system, author: { username: author } };
    this.notes.set(iid, [...(this.notes.get(iid) ?? []), note]);
    const issue = this.issues.get(iid);
    if (issue) issue.user_notes_count = this.notes.get(iid)!.filter((n) => !n.system).length;
    return note;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const method = req.method ?? 'GET';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const path = decodeURIComponent(url.pathname).replace('/api/v4', '');
    this.requests.push({ method, path, query: Object.fromEntries(url.searchParams), body });

    const send: Send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    if (req.headers['private-token'] !== this.token) return send(401, { message: '401 Unauthorized' });
    if (this.forceStatus) return send(this.forceStatus, { message: 'forced' });

    if (method === 'GET' && path === '/user') return send(200, { username: this.user });
    if (method === 'GET' && path === '/users') {
      const name = url.searchParams.get('username') ?? '';
      const id = this.users.get(name);
      return send(200, id === undefined ? [] : [{ id, username: name }]);
    }
    const base = `/projects/${FakeGitlab.PROJECT}`;
    if (!path.startsWith(`${base}/`)) return send(404, { message: '404 Project Not Found' });
    this.route(method, path.slice(base.length), url.searchParams, body, send);
  }

  private route(method: string, sub: string, q: URLSearchParams, body: Record<string, unknown> | undefined, send: Send): void {
    if (sub === '/labels') {
      if (method === 'GET') return this.page(send, q, [...this.labels].map((name) => ({ name })));
      if (method === 'POST') {
        if (this.forbidLabelCreate) return send(403, { message: '403 Forbidden' });
        const name = String(body?.name ?? '');
        if (this.labels.has(name)) return send(409, { message: 'Label already exists' });
        this.labels.add(name);
        return send(201, { name });
      }
    }
    if (sub === '/issues' && method === 'POST') {
      const labels = String(body?.labels ?? '').split(',').filter(Boolean);
      for (const l of labels) this.labels.add(l);
      const iid = this.addIssue({ title: String(body?.title ?? ''), description: body?.description === undefined ? '' : String(body.description), labels });
      return send(201, this.issues.get(iid));
    }
    if (sub === '/issues' && method === 'GET') {
      const state = q.get('state') ?? 'all';
      const after = q.get('updated_after');
      return this.page(send, q, [...this.issues.values()].filter((i) => (state === 'all' || i.state === state) && (!after || i.updated_at >= after)));
    }
    const m = /^\/issues\/(\d+)(\/notes(?:\/(\d+))?)?$/.exec(sub);
    const issue = m ? this.issues.get(Number(m[1])) : undefined;
    if (!m || !issue) return send(404, { message: '404 Not found' });
    const notes = this.notes.get(issue.iid) ?? [];
    if (!m[2]) {
      if (method === 'GET') return send(200, issue);
      if (method === 'PUT') {
        const add = String(body?.add_labels ?? '').split(',').filter(Boolean);
        const remove = String(body?.remove_labels ?? '').split(',').filter(Boolean);
        issue.labels = [...issue.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !issue.labels.includes(l))];
        for (const l of add) this.labels.add(l);
        if (typeof body?.title === 'string') issue.title = body.title;
        if (typeof body?.description === 'string') issue.description = body.description;
        if (Array.isArray(body?.assignee_ids)) {
          const names = new Map([...this.users].map(([n, id]) => [id, n]));
          issue.assignees = (body.assignee_ids as number[]).flatMap((id) => (names.has(id) ? [{ username: names.get(id)! }] : []));
        }
        if (body?.state_event === 'close') issue.state = 'closed';
        if (body?.state_event === 'reopen') issue.state = 'opened';
        issue.updated_at = this.tick();
        return send(200, issue);
      }
    } else if (!m[3]) {
      if (method === 'GET' && this.failNotesReads) return send(500, { message: 'boom' });
      if (method === 'GET') return this.page(send, q, [...notes].reverse()); // newest first, like GitLab
      if (method === 'POST') return send(201, this.addNote(issue.iid, String(body?.body ?? '')));
    } else if (method === 'PUT') {
      const note = notes.find((n) => n.id === Number(m[3]));
      if (!note) return send(404, { message: '404 Not found' });
      note.body = String(body?.body ?? '');
      return send(200, note);
    }
    return send(404, { message: '404 Not found' });
  }

  private page(send: Send, q: URLSearchParams, all: unknown[]): void {
    const perPage = Math.min(Number(q.get('per_page') ?? 20), 100);
    const page = Number(q.get('page') ?? 1);
    const next = page * perPage < all.length ? String(page + 1) : '';
    send(200, all.slice((page - 1) * perPage, page * perPage), { 'x-next-page': next });
  }
}
