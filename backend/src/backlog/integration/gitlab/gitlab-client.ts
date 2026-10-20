import { BacklogNotFoundError, BacklogUnreachableError } from '../../service/backlog-errors';

const TIMEOUT_MS = 30_000;
const MAX_PAGES = 1000;

// Thin GitLab REST v4 client for one project. The token is only ever sent as the PRIVATE-TOKEN header;
// errors carry fixed messages (no URL, host, project, token or upstream body). Holds no per-request state.
export class GitlabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly project: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  // `/user` is global; every other path is below the project. Arrays are read page by page (X-Next-Page).
  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const first = await this.request('GET', path, query);
    if (!Array.isArray(first.body)) return first.body as T;
    const all: unknown[] = [...first.body];
    let next = first.next;
    for (let i = 1; next && i < MAX_PAGES; i++) {
      const page = await this.request('GET', path, { ...query, page: next });
      if (!Array.isArray(page.body)) throw new BacklogUnreachableError('Backlog source returned an unexpected response');
      all.push(...page.body);
      next = page.next;
    }
    return all as T;
  }

  async send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
    return (await this.request(method, path, {}, body)).body as T;
  }

  private url(path: string, query: Record<string, string>): string {
    const root = `${this.baseUrl.replace(/\/+$/, '')}/api/v4`;
    const scoped = path === '/user' ? path : `/projects/${encodeURIComponent(this.project)}${path}`;
    const qs = new URLSearchParams(query).toString();
    return `${root}${scoped}${qs ? `?${qs}` : ''}`;
  }

  private async request(method: string, path: string, query: Record<string, string>, body?: unknown): Promise<{ body: unknown; next: string }> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url(path, query), {
        method,
        headers: { 'PRIVATE-TOKEN': this.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', // never forward the token to another location
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BacklogUnreachableError();
    }
    if (res.status === 404) throw new BacklogNotFoundError();
    if (res.status === 401 || res.status === 403) throw new BacklogUnreachableError('Backlog source rejected the credentials');
    if (res.status >= 500) throw new BacklogUnreachableError();
    if (!res.ok) throw new Error(`Backlog source refused the request (${res.status})`);
    try {
      return { body: await res.json(), next: res.headers.get('x-next-page') ?? '' };
    } catch {
      throw new BacklogUnreachableError('Backlog source returned an unexpected response');
    }
  }
}
