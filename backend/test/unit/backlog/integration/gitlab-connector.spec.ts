import { GitlabClient } from '../../../../src/backlog/integration/gitlab/gitlab-client';
import { GitlabConnector } from '../../../../src/backlog/integration/gitlab/gitlab-connector';
import { renderFileLinks } from '../../../../src/backlog/integration/gitlab/file-links-comment';
import { BacklogConfig } from '../../../../src/backlog/service/backlog-config';
import { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError } from '../../../../src/backlog/service/backlog-errors';
import { FakeGitlab } from '../../../helpers/fake-gitlab';

const lanes: BacklogConfig['lanes'] = [
  { id: 'todo', title: 'Todo', default: true, gitlab: { label: 'status::todo' } },
  { id: 'plan', title: 'Plan', gitlab: { label: 'status::plan' } },
  { id: 'review', title: 'Review', gitlab: { label: 'status::review' } },
  { id: 'done', title: 'Done', gitlab: { state: 'closed' } },
];

describe('GitlabConnector', () => {
  let gitlab: FakeGitlab;
  let connector: GitlabConnector;
  const config = (baseUrl: string): BacklogConfig => ({
    connector: 'gitlab',
    gitlab: { baseUrl, project: FakeGitlab.PROJECT, token: gitlab.token },
    pollSeconds: 60,
    doneDays: 14,
    dataDir: '/unused',
    lanes,
  });
  const connect = (baseUrl = gitlab.baseUrl, token = gitlab.token) =>
    new GitlabConnector(config(baseUrl), new GitlabClient(baseUrl, FakeGitlab.PROJECT, token));

  beforeEach(async () => {
    gitlab = new FakeGitlab();
    await gitlab.start();
    connector = connect();
  });
  afterEach(() => gitlab.stop());

  it('me() returns the username of the token', async () => {
    gitlab.user = 'alice';
    await expect(connector.me()).resolves.toBe('alice');
  });

  describe('lane resolution', () => {
    it('puts an issue without lane label into the default lane and ignores unknown labels', async () => {
      gitlab.addIssue({ labels: ['ADMIN'] });
      expect((await connector.list())[0].lane).toBe('todo');
    });

    it('uses the lane of the label', async () => {
      gitlab.addIssue({ labels: ['status::plan'] });
      expect((await connector.list())[0].lane).toBe('plan');
    });

    it('takes the later lane in config order for two lane labels', async () => {
      gitlab.addIssue({ labels: ['status::review', 'status::plan'] });
      expect((await connector.list())[0].lane).toBe('review');
    });

    it('puts a closed issue into done whatever labels it has', async () => {
      gitlab.addIssue({ labels: ['status::review'], state: 'closed' });
      expect((await connector.list())[0].lane).toBe('done');
    });
  });

  describe('list', () => {
    it('maps the issue fields', async () => {
      const iid = gitlab.addIssue({ title: 'T', description: null, assignees: ['bob'] });
      const [item] = await connector.list();
      expect(item).toMatchObject({ id: String(iid), title: 'T', description: '', assignees: ['bob'], url: gitlab.issues.get(iid)!.web_url, fileLinks: [] });
      expect(item.updatedAt).toBe(gitlab.issues.get(iid)!.updated_at);
    });

    it('lists open issues and closed ones updated within doneDays only', async () => {
      const fresh = new Date().toISOString();
      const old = new Date(Date.now() - 30 * 86400_000).toISOString();
      const open = gitlab.addIssue({ updatedAt: old });
      const closedNew = gitlab.addIssue({ state: 'closed', updatedAt: fresh });
      gitlab.addIssue({ state: 'closed', updatedAt: old });
      const ids = (await connector.list()).map((i) => i.id).sort();
      expect(ids).toEqual([String(open), String(closedNew)]);
    });

    it('pages through more than 100 issues', async () => {
      for (let i = 0; i < 250; i++) gitlab.addIssue();
      const items = await connector.list();
      expect(items).toHaveLength(250);
      expect(new Set(items.map((i) => i.id)).size).toBe(250);
    });

    it('reads the file links of issues that have comments', async () => {
      const iid = gitlab.addIssue();
      gitlab.addNote(iid, 'human');
      gitlab.addNote(iid, renderFileLinks([{ repo: 'g/p', path: 'a' }]));
      gitlab.addIssue();
      const items = await connector.list();
      expect(items.find((i) => i.id === String(iid))!.fileLinks).toEqual([{ repo: 'g/p', path: 'a' }]);
    });

    it('still lists when the token may not create labels', async () => {
      gitlab.forbidLabelCreate = true;
      gitlab.addIssue({ labels: ['status::plan'] });
      await expect(connector.list()).resolves.toHaveLength(1);
      gitlab.forbidLabelCreate = false;
      await connector.list();
      expect(gitlab.labels.has('status::todo')).toBe(true); // retried on a later round
    });

    it('creates the lane labels the project lacks, and only those', async () => {
      gitlab.labels.add('status::plan');
      await connector.list();
      const created = gitlab.writes.filter((w) => w.path.endsWith('/labels')).map((w) => w.body?.name);
      expect(created.sort()).toEqual(['status::review', 'status::todo']);
      await connector.list();
      expect(gitlab.writes).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('returns the item', async () => {
      const iid = gitlab.addIssue({ labels: ['status::plan'] });
      await expect(connector.get(String(iid))).resolves.toMatchObject({ id: String(iid), lane: 'plan' });
    });

    it('maps 404 to BacklogNotFoundError', async () => {
      await expect(connector.get('99')).rejects.toBeInstanceOf(BacklogNotFoundError);
    });
  });

  describe('moveToLane', () => {
    beforeEach(() => {
      for (const l of lanes) if (l.gitlab?.label) gitlab.labels.add(l.gitlab.label);
    });

    it('replaces only the lane labels and leaves other labels alone', async () => {
      const iid = gitlab.addIssue({ labels: ['ADMIN', 'status::todo'] });
      const item = await connector.moveToLane(String(iid), 'todo', 'plan');
      expect(item.lane).toBe('plan');
      expect(gitlab.issues.get(iid)!.labels.sort()).toEqual(['ADMIN', 'status::plan']);
      expect(gitlab.writes).toHaveLength(1);
      expect(gitlab.writes[0]).toMatchObject({ method: 'PUT', body: { add_labels: 'status::plan', remove_labels: 'status::todo' } });
      expect(gitlab.writes[0].body).not.toHaveProperty('state_event');
    });

    it('closes the issue and leaves no lane label when moving to done', async () => {
      const iid = gitlab.addIssue({ labels: ['ADMIN', 'status::review'] });
      const item = await connector.moveToLane(String(iid), 'review', 'done');
      expect(item.lane).toBe('done');
      expect(gitlab.issues.get(iid)).toMatchObject({ state: 'closed', labels: ['ADMIN'] });
      expect(gitlab.writes[0].body).toMatchObject({ state_event: 'close' });
    });

    it('reopens the issue when moving from done', async () => {
      const iid = gitlab.addIssue({ state: 'closed' });
      const item = await connector.moveToLane(String(iid), 'done', 'plan');
      expect(item.lane).toBe('plan');
      expect(gitlab.issues.get(iid)).toMatchObject({ state: 'opened', labels: ['status::plan'] });
      expect(gitlab.writes[0].body).toMatchObject({ state_event: 'reopen' });
    });

    it('still resolves with the moved item when the follow-up notes read fails', async () => {
      const iid = gitlab.addIssue({ labels: ['status::todo'] });
      gitlab.addNote(iid, 'human');
      gitlab.failNotesReads = true;
      const item = await connector.moveToLane(String(iid), 'todo', 'plan');
      expect(item).toMatchObject({ id: String(iid), lane: 'plan', fileLinks: [] });
      expect(gitlab.issues.get(iid)!.labels).toEqual(['status::plan']);
    });

    it('rejects a stale from with BacklogConflictError and writes nothing', async () => {
      const iid = gitlab.addIssue({ labels: ['status::review'] });
      await expect(connector.moveToLane(String(iid), 'todo', 'plan')).rejects.toBeInstanceOf(BacklogConflictError);
      expect(gitlab.writes).toEqual([]);
      expect(gitlab.issues.get(iid)!.labels).toEqual(['status::review']);
    });

    it('rejects a missing issue as not found', async () => {
      await expect(connector.moveToLane('42', 'todo', 'plan')).rejects.toBeInstanceOf(BacklogNotFoundError);
    });

    it('does not write when from equals to', async () => {
      const iid = gitlab.addIssue({ labels: ['status::plan'] });
      await expect(connector.moveToLane(String(iid), 'plan', 'plan')).resolves.toMatchObject({ lane: 'plan' });
      expect(gitlab.writes).toEqual([]);
    });
  });

  describe('file links', () => {
    it('creates the owned note once, then updates it, and leaves other notes alone', async () => {
      const iid = gitlab.addIssue();
      const human = gitlab.addNote(iid, 'human note');
      const id = String(iid);
      await connector.setFileLinks(id, [{ repo: 'g/p', path: 'a.ts', ref: 'main' }]);
      await connector.setFileLinks(id, [{ repo: 'g/p', path: 'b.ts' }]);
      const writes = gitlab.writes.map((w) => w.method);
      expect(writes).toEqual(['POST', 'PUT']);
      expect(gitlab.notes.get(iid)).toHaveLength(2);
      expect(gitlab.notes.get(iid)![0]).toEqual(human);
      await expect(connector.getFileLinks(id)).resolves.toEqual([{ repo: 'g/p', path: 'b.ts' }]);
      await expect(connector.get(id)).resolves.toMatchObject({ fileLinks: [{ repo: 'g/p', path: 'b.ts' }] });
    });

    it('returns no links when there is no owned note, and ignores a quoting human note', async () => {
      const iid = gitlab.addIssue();
      gitlab.addNote(iid, `> ${renderFileLinks([{ repo: 'x', path: 'y' }])}`);
      await expect(connector.getFileLinks(String(iid))).resolves.toEqual([]);
    });

    it('ignores a newer forged marker note by another user and leaves it untouched', async () => {
      const iid = gitlab.addIssue();
      const id = String(iid);
      await connector.setFileLinks(id, [{ repo: 'g/p', path: 'real' }]);
      const forged = gitlab.addNote(iid, renderFileLinks([{ repo: 'evil', path: 'x' }]), false, 'mallory');
      const forgedBody = forged.body;
      await expect(connector.getFileLinks(id)).resolves.toEqual([{ repo: 'g/p', path: 'real' }]);
      await connector.setFileLinks(id, [{ repo: 'g/p', path: 'real2' }]);
      expect(forged.body).toBe(forgedBody);
      await expect(connector.getFileLinks(id)).resolves.toEqual([{ repo: 'g/p', path: 'real2' }]);
      expect(gitlab.writes.map((w) => w.method)).toEqual(['POST', 'PUT']);
      expect(gitlab.notes.get(iid)).toHaveLength(2);
    });

    it('creates its own note when only a forged one exists', async () => {
      const iid = gitlab.addIssue();
      gitlab.addNote(iid, renderFileLinks([{ repo: 'evil', path: 'x' }]), false, 'mallory');
      await expect(connector.getFileLinks(String(iid))).resolves.toEqual([]);
      await connector.setFileLinks(String(iid), [{ repo: 'g/p', path: 'a' }]);
      expect(gitlab.notes.get(iid)).toHaveLength(2);
      await expect(connector.getFileLinks(String(iid))).resolves.toEqual([{ repo: 'g/p', path: 'a' }]);
    });

    it('does not create two notes for concurrent writes', async () => {
      const iid = gitlab.addIssue();
      await Promise.all([
        connector.setFileLinks(String(iid), [{ repo: 'g/p', path: 'a' }]),
        connector.setFileLinks(String(iid), [{ repo: 'g/p', path: 'b' }]),
      ]);
      expect(gitlab.notes.get(iid)).toHaveLength(1);
    });

    it('maps a missing issue to not found', async () => {
      await expect(connector.getFileLinks('9')).rejects.toBeInstanceOf(BacklogNotFoundError);
    });
  });

  describe('failures', () => {
    it('maps 401 to BacklogUnreachableError without the token', async () => {
      const bad = connect(gitlab.baseUrl, 'leaky-token-value');
      const error = await bad.list().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BacklogUnreachableError);
      expect(JSON.stringify([(error as Error).message, (error as Error).stack])).not.toContain('leaky-token-value');
      expect((error as Error).message).not.toContain(gitlab.baseUrl);
    });

    it('maps a connection failure to BacklogUnreachableError without token or host', async () => {
      const url = gitlab.baseUrl;
      await gitlab.stop();
      const error = await connect(url).get('1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BacklogUnreachableError);
      expect((error as Error).message).not.toContain(gitlab.token);
      expect((error as Error).message).not.toContain('127.0.0.1');
      gitlab = new FakeGitlab();
      await gitlab.start();
    });

    it('maps a 500 to BacklogUnreachableError', async () => {
      gitlab.forceStatus = 500;
      await expect(connector.me()).rejects.toBeInstanceOf(BacklogUnreachableError);
    });

    it('is safe for concurrent callers', async () => {
      const a = gitlab.addIssue({ labels: ['status::todo'] });
      const b = gitlab.addIssue({ labels: ['status::plan'] });
      const [x, y] = await Promise.all([connector.moveToLane(String(a), 'todo', 'plan'), connector.moveToLane(String(b), 'plan', 'review')]);
      expect([x.lane, y.lane]).toEqual(['plan', 'review']);
    });
  });
});
