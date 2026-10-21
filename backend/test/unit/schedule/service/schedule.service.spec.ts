import { ScheduleConfig } from '../../../../src/commons/schedule-config';
import { ScheduleInvalidError, ScheduleNotFoundError, ScheduleRecord, ScheduleService } from '../../../../src/schedule';
import { ScheduleLocks } from '../../../../src/schedule/service/schedule-locks';
import { FakeClock, MemoryScheduleRepository } from '../../../helpers/fake-schedule';

const CONFIG: ScheduleConfig = { dataDir: '/unused', timezone: 'Europe/Bucharest', tickSeconds: 30 };
const NOW = '2026-10-21T10:00:00.000Z'; // 13:00 in Bucharest (+03:00)

const body = (patch: Record<string, unknown> = {}) => ({
  title: 'Nightly deps', prompt: 'Update the deps', repository: 'repo', when: { cron: '0 2 * * 1-5' }, ...patch,
});

function make() {
  const repo = new MemoryScheduleRepository();
  const clock = new FakeClock(Date.parse(NOW));
  const service = new ScheduleService(repo, { names: () => ['repo', 'other'] }, CONFIG, new ScheduleLocks(), clock);
  return { repo, clock, service };
}

async function invalid(promise: Promise<unknown> | (() => unknown)): Promise<ScheduleInvalidError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduleInvalidError);
    return error as ScheduleInvalidError;
  }
  throw new Error('expected ScheduleInvalidError');
}

describe('ScheduleService', () => {
  describe('create', () => {
    it('validates, gives the id from the title, computes nextRunAt in the zone and saves it without results', async () => {
      const { service, repo } = make();
      const created = await service.create(body({ ref: 'main', model: 'sonnet' }));
      expect(created).toEqual({
        id: 'nightly-deps', title: 'Nightly deps', prompt: 'Update the deps', repository: 'repo', ref: 'main', model: 'sonnet',
        when: { cron: '0 2 * * 1-5' }, timeoutMinutes: 120, enabled: true, nextRunAt: '2026-10-22T02:00:00+03:00',
        createdAt: NOW, updatedAt: NOW, results: [],
      });
      expect(await repo.get('nightly-deps')).toEqual(created);
    });

    it('gives unique ids to schedules with one title, also when created at once', async () => {
      const { service } = make();
      const ids = (await Promise.all([service.create(body()), service.create(body()), service.create(body())])).map((s) => s.id);
      expect(ids.sort()).toEqual(['nightly-deps', 'nightly-deps-2', 'nightly-deps-3']);
    });

    it('a disabled schedule has no next time; a one-off has its own time', async () => {
      const { service } = make();
      expect((await service.create(body({ enabled: false }))).nextRunAt).toBeNull();
      expect((await service.create(body({ when: { at: '2026-10-22T22:00' } }))).nextRunAt).toBe('2026-10-22T22:00:00+03:00');
    });

    it('refuses invalid input with the field', async () => {
      const { service, repo } = make();
      expect(await invalid(service.create(body({ title: ' ' })))).toMatchObject({ field: 'title' });
      expect(await invalid(service.create(body({ repository: 'unknown' })))).toMatchObject({ field: 'repository' });
      expect(await invalid(service.create(body({ when: { cron: 'nope' } })))).toMatchObject({ field: 'when.cron' });
      expect(await invalid(service.create(body({ when: { at: '2026-10-21T12:00' } })))).toMatchObject({ field: 'when.at', message: 'at must be in the future' });
      expect(await invalid(service.create(body({ timeoutMinutes: 0 })))).toMatchObject({ field: 'timeoutMinutes' });
      expect(repo.records.size).toBe(0);
    });
  });

  describe('replace', () => {
    async function withResults() {
      const made = make();
      const created = await made.service.create(body());
      const stored = (await made.repo.get(created.id))!;
      stored.results = [{ firedAt: NOW, trigger: 'manual', outcome: 'running', taskId: 'T-1' }];
      await made.repo.save(stored);
      made.clock.advance(3600_000);
      return { ...made, created };
    }

    it('replaces what the user wrote, keeps id, createdAt and results, recomputes nextRunAt from now', async () => {
      const { service, created } = await withResults();
      const replaced = await service.replace(created.id, body({ title: 'Renamed', when: { cron: '30 14 * * *' } }));
      expect(replaced).toMatchObject({
        id: 'nightly-deps', title: 'Renamed', when: { cron: '30 14 * * *' }, nextRunAt: '2026-10-21T14:30:00+03:00',
        createdAt: NOW, updatedAt: '2026-10-21T11:00:00.000Z', results: [{ taskId: 'T-1' }],
      });
      expect(replaced.ref).toBeUndefined();
    });

    it('disabling clears nextRunAt, enabling computes it from now', async () => {
      const { service, created, clock } = await withResults();
      expect((await service.replace(created.id, body({ enabled: false }))).nextRunAt).toBeNull();
      clock.set('2026-10-23T00:30:00.000Z'); // 03:30 Friday in Bucharest
      expect((await service.replace(created.id, body({ enabled: true }))).nextRunAt).toBe('2026-10-26T02:00:00+02:00');
    });

    it('keeps a fired one-off editable while disabled with its time unchanged, but not enabled again in the past', async () => {
      const { service, repo, clock } = make();
      const once = await service.create(body({ title: 'Once', when: { at: '2026-10-21T14:00' } }));
      await repo.save({ ...(await repo.get(once.id))!, enabled: false, nextRunAt: null });
      clock.set('2026-10-21T12:00:00.000Z');
      const renamed = await service.replace(once.id, body({ title: 'Once again', when: { at: '2026-10-21T14:00' }, enabled: false }));
      expect(renamed).toMatchObject({ title: 'Once again', enabled: false, nextRunAt: null });
      expect(await invalid(service.replace(once.id, body({ when: { at: '2026-10-21T14:00' }, enabled: true })))).toMatchObject({ field: 'when.at' });
      expect(await invalid(service.replace(once.id, body({ when: { at: '2026-10-21T13:00' }, enabled: false })))).toMatchObject({ field: 'when.at' });
      expect(await invalid(service.replace(once.id, body({ title: '', when: { at: '2026-10-21T14:00' }, enabled: false })))).toMatchObject({ field: 'title' });
    });

    it('refuses invalid input and an unknown id', async () => {
      const { service, created } = await withResults();
      expect(await invalid(service.replace(created.id, body({ prompt: '' })))).toMatchObject({ field: 'prompt' });
      await expect(service.replace('nope', body())).rejects.toBeInstanceOf(ScheduleNotFoundError);
    });
  });

  it('get gives the schedule with its results; unknown is ScheduleNotFoundError', async () => {
    const { service } = make();
    const created = await service.create(body());
    expect(await service.get(created.id)).toEqual(created);
    await expect(service.get('nope')).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('list gives each schedule with its newest result and without the results', async () => {
    const { service, repo } = make();
    const a = await service.create(body({ title: 'A' }));
    await service.create(body({ title: 'B' }));
    const stored = (await repo.get(a.id))! as ScheduleRecord;
    stored.results = [
      { firedAt: '2026-10-21T10:05:00.000Z', trigger: 'manual', outcome: 'running', taskId: 'T-2' },
      { firedAt: '2026-10-21T10:00:00.000Z', trigger: 'time', outcome: 'done', taskId: 'T-1' },
    ];
    await repo.save(stored);
    const list = await service.list();
    expect(list.map((s) => s.id)).toEqual(['a', 'b']);
    expect(list[0].lastResult).toEqual(stored.results[0]);
    expect(list[0]).not.toHaveProperty('results');
    expect(list[1]).not.toHaveProperty('lastResult');
  });

  it('delete removes the schedule; unknown is ScheduleNotFoundError', async () => {
    const { service, repo } = make();
    const created = await service.create(body());
    await service.delete(created.id);
    expect(repo.records.size).toBe(0);
    await expect(service.delete(created.id)).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('preview gives the next three times in the zone, or the field error', async () => {
    const { service } = make();
    expect(service.preview({ cron: '0 2 * * *' })).toEqual({
      zone: 'Europe/Bucharest', next: ['2026-10-22T02:00:00+03:00', '2026-10-23T02:00:00+03:00', '2026-10-24T02:00:00+03:00'],
    });
    expect(service.preview({ at: '2026-10-22T22:00' })).toEqual({ zone: 'Europe/Bucharest', next: ['2026-10-22T22:00:00+03:00'] });
    expect(await invalid(() => service.preview({ cron: '* *' }))).toMatchObject({ field: 'when.cron' });
    expect(await invalid(() => service.preview(undefined))).toMatchObject({ field: 'when' });
    expect(service.zone).toBe('Europe/Bucharest');
  });
});
