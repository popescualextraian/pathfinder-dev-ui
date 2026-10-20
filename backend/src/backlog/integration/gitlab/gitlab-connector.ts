import { BacklogConfig, LaneConfig } from '../../service/backlog-config';
import { BacklogConnector, FileLink, Item } from '../../service/backlog-connector';
import { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError } from '../../service/backlog-errors';
import { isFileLinksComment, parseFileLinks, renderFileLinks } from './file-links-comment';
import { GitlabClient } from './gitlab-client';

interface GitlabIssue {
  iid: number;
  title: string;
  description?: string | null;
  labels: string[];
  state: string;
  assignees?: Array<{ username: string }>;
  web_url: string;
  updated_at: string;
  user_notes_count?: number;
}

interface GitlabNote {
  id: number;
  body: string;
  system?: boolean;
}

const DAY_MS = 86_400_000;
const NOTE_READERS = 5;
const LABEL_COLOR = '#428bca';

// All GitLab knowledge (labels, iid, issue states, notes) stays in this class. It keeps no per-request state:
// the only shared state is the memoised "labels exist" check and the per-issue write queue.
export class GitlabConnector implements BacklogConnector {
  private labelsReady?: Promise<void>;
  private readonly linkWrites = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: BacklogConfig,
    private readonly client: GitlabClient,
  ) {}

  async me(): Promise<string> {
    return (await this.client.get<{ username: string }>('/user')).username;
  }

  async list(): Promise<Item[]> {
    await this.ensureLabels();
    const since = new Date(Date.now() - this.config.doneDays * DAY_MS).toISOString();
    const [open, closed] = await Promise.all([
      this.client.get<GitlabIssue[]>('/issues', { state: 'opened', per_page: '100' }),
      this.client.get<GitlabIssue[]>('/issues', { state: 'closed', updated_after: since, per_page: '100' }),
    ]);
    const seen = new Set<number>();
    const issues = [...open, ...closed].filter((i) => !seen.has(i.iid) && seen.add(i.iid));
    return this.mapLimited(issues, NOTE_READERS, (issue) => this.toItem(issue));
  }

  async get(id: string): Promise<Item> {
    return this.toItem(await this.issue(id));
  }

  async moveToLane(id: string, from: string, to: string): Promise<Item> {
    const target = this.lane(to);
    const issue = await this.issue(id);
    if (this.resolveLane(issue) !== from) throw new BacklogConflictError();
    if (from === to) return this.toItem(issue);
    await this.ensureLabels();
    const configured = this.config.lanes.flatMap((l) => (l.gitlab?.label ? [l.gitlab.label] : []));
    const toClosed = target.gitlab?.state === 'closed';
    const add = !toClosed && target.gitlab?.label ? [target.gitlab.label] : [];
    const remove = configured.filter((l) => issue.labels.includes(l) && !add.includes(l));
    const body: Record<string, string> = {};
    if (add.length > 0) body.add_labels = add.join(',');
    if (remove.length > 0) body.remove_labels = remove.join(',');
    if (toClosed && issue.state !== 'closed') body.state_event = 'close';
    if (!toClosed && issue.state === 'closed') body.state_event = 'reopen';
    return this.toItem(await this.client.send<GitlabIssue>('PUT', `/issues/${this.iid(id)}`, body));
  }

  async getFileLinks(id: string): Promise<FileLink[]> {
    await this.issue(id); // a missing issue is "not found", not "no links"
    const note = await this.ownedNote(id);
    return (note && parseFileLinks(note.body)) || [];
  }

  async setFileLinks(id: string, links: FileLink[]): Promise<FileLink[]> {
    // Writes to one issue are queued, so two callers cannot both create the owned note.
    const run = (this.linkWrites.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await this.issue(id);
      const body = renderFileLinks(links);
      const note = await this.ownedNote(id);
      if (note) await this.client.send('PUT', `/issues/${this.iid(id)}/notes/${note.id}`, { body });
      else await this.client.send('POST', `/issues/${this.iid(id)}/notes`, { body });
      return links;
    });
    this.linkWrites.set(id, run);
    try {
      return await run;
    } finally {
      if (this.linkWrites.get(id) === run) this.linkWrites.delete(id);
    }
  }

  private lane(id: string): LaneConfig {
    const lane = this.config.lanes.find((l) => l.id === id);
    if (!lane) throw new Error(`Unknown lane ${id}`);
    return lane;
  }

  // Closed means the lane mapped to state closed; otherwise the last configured lane whose label the issue carries, else the default lane.
  private resolveLane(issue: GitlabIssue): string {
    const lanes = this.config.lanes;
    if (issue.state === 'closed') {
      const done = lanes.find((l) => l.gitlab?.state === 'closed');
      if (done) return done.id;
    }
    const labelled = lanes.filter((l) => l.gitlab?.state !== 'closed' && l.gitlab?.label && issue.labels.includes(l.gitlab.label));
    return (labelled.at(-1) ?? lanes.find((l) => l.default) ?? lanes[0]).id;
  }

  private iid(id: string): string {
    if (!/^\d+$/.test(id)) throw new BacklogNotFoundError();
    return id;
  }

  private issue(id: string): Promise<GitlabIssue> {
    return this.client.get<GitlabIssue>(`/issues/${this.iid(id)}`);
  }

  private async toItem(issue: GitlabIssue): Promise<Item> {
    const id = String(issue.iid);
    const note = issue.user_notes_count === 0 ? undefined : await this.ownedNote(id);
    return {
      id,
      title: issue.title,
      description: issue.description ?? '',
      lane: this.resolveLane(issue),
      assignees: (issue.assignees ?? []).map((a) => a.username),
      url: issue.web_url,
      fileLinks: (note && parseFileLinks(note.body)) || [],
      updatedAt: issue.updated_at,
    };
  }

  private async ownedNote(id: string): Promise<GitlabNote | undefined> {
    const notes = await this.client.get<GitlabNote[]>(`/issues/${this.iid(id)}/notes`, { per_page: '100' });
    return notes.find((n) => !n.system && isFileLinksComment(n.body));
  }

  // Creates the configured lane labels the project lacks; remembered once it succeeded.
  private ensureLabels(): Promise<void> {
    this.labelsReady ??= this.createMissingLabels().catch((error: unknown) => {
      this.labelsReady = undefined;
      throw error;
    });
    return this.labelsReady;
  }

  private async createMissingLabels(): Promise<void> {
    const existing = new Set((await this.client.get<Array<{ name: string }>>('/labels', { per_page: '100' })).map((l) => l.name));
    for (const lane of this.config.lanes) {
      const name = lane.gitlab?.label;
      if (!name || existing.has(name)) continue;
      try {
        await this.client.send('POST', '/labels', { name, color: LABEL_COLOR });
      } catch (error) {
        // Created by someone else in the meantime (409) is fine; an unreachable source is not.
        if (error instanceof BacklogUnreachableError) throw error;
      }
    }
  }

  private async mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
}
