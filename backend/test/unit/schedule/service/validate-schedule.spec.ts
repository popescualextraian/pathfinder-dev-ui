import { validateSchedule } from '../../../../src/schedule/service/validate-schedule';

const options = { repositories: ['app', 'lib'], zone: 'Europe/Bucharest', now: new Date('2026-10-21T10:00:00Z') };
const good = { title: 'Nightly', prompt: 'Update deps', repository: 'app', when: { cron: '0 2 * * 1-5' } };

const failure = (input: unknown) => {
  const result = validateSchedule(input, options);
  if ('value' in result) throw new Error('expected an error');
  return result.error;
};

describe('validateSchedule', () => {
  it('accepts a minimal schedule and fills defaults', () => {
    const result = validateSchedule(good, options);
    expect(result).toEqual({ value: { title: 'Nightly', prompt: 'Update deps', repository: 'app', when: { cron: '0 2 * * 1-5' }, timeoutMinutes: 120, enabled: true } });
  });

  it('keeps optional ref, model, timeout and enabled', () => {
    const result = validateSchedule({ ...good, ref: ' main ', model: 'sonnet', timeoutMinutes: 60, enabled: false }, options);
    expect(result).toMatchObject({ value: { ref: 'main', model: 'sonnet', timeoutMinutes: 60, enabled: false } });
  });

  it.each([
    ['not an object', 'x', 'schedule'],
    ['title missing', { ...good, title: ' ' }, 'title'],
    ['title not a string', { ...good, title: 3 }, 'title'],
    ['prompt missing', { ...good, prompt: '' }, 'prompt'],
    ['repository unknown', { ...good, repository: 'nope' }, 'repository'],
    ['repository missing', { ...good, repository: undefined }, 'repository'],
    ['ref not a string', { ...good, ref: 3 }, 'ref'],
    ['model not a string', { ...good, model: 3 }, 'model'],
    ['title too long', { ...good, title: 'x'.repeat(201) }, 'title'],
    ['prompt too long', { ...good, prompt: 'x'.repeat(20_001) }, 'prompt'],
    ['ref starting with a dash', { ...good, ref: '-main' }, 'ref'],
    ['ref with a space', { ...good, ref: 'my branch' }, 'ref'],
    ['ref too long', { ...good, ref: 'a'.repeat(201) }, 'ref'],
    ['model with a space', { ...good, model: 'bad model' }, 'model'],
    ['model too long', { ...good, model: 'a'.repeat(101) }, 'model'],
    ['cron that never fires', { ...good, when: { cron: '0 0 31 2 *' } }, 'when.cron'],
    ['when missing', { ...good, when: undefined }, 'when'],
    ['when with both', { ...good, when: { cron: '0 2 * * *', at: '2026-10-22T22:00' } }, 'when'],
    ['cron with six fields', { ...good, when: { cron: '0 0 2 * * *' } }, 'when.cron'],
    ['cron nickname', { ...good, when: { cron: '@daily' } }, 'when.cron'],
    ['cron unparsable', { ...good, when: { cron: '61 2 * * *' } }, 'when.cron'],
    ['at malformed', { ...good, when: { at: 'tomorrow' } }, 'when.at'],
    ['at invalid date', { ...good, when: { at: '2026-02-30T10:00' } }, 'when.at'],
    ['at in the past', { ...good, when: { at: '2026-10-21T12:00' } }, 'when.at'],
    ['at later than a year', { ...good, when: { at: '2027-10-22T12:00' } }, 'when.at'],
    ['timeout zero', { ...good, timeoutMinutes: 0 }, 'timeoutMinutes'],
    ['timeout too long', { ...good, timeoutMinutes: 1441 }, 'timeoutMinutes'],
    ['timeout fraction', { ...good, timeoutMinutes: 1.5 }, 'timeoutMinutes'],
    ['enabled not boolean', { ...good, enabled: 'yes' }, 'enabled'],
  ])('refuses %s with field %s', (_name, input, field) => {
    expect(failure(input).field).toBe(field);
    expect(failure(input).message).not.toBe('');
  });

  it('accepts the limits of the task API: title 200, prompt 20000, ref 200, model 100 and their characters', () => {
    expect(validateSchedule({
      ...good, title: 'x'.repeat(200), prompt: 'x'.repeat(20_000), ref: `release/1.2_x-${'a'.repeat(186)}`, model: `claude-opus-4[1m]:x/${'a'.repeat(80)}`,
    }, options)).toHaveProperty('value');
  });

  it('reports the first error in field order', () => {
    expect(failure({ ...good, title: '', prompt: '' }).field).toBe('title');
  });

  it('judges at in the zone: 12:59 local (09:59Z) is future only before now', () => {
    // now is 13:00 local (10:00Z)
    expect(failure({ ...good, when: { at: '2026-10-21T12:59' } }).field).toBe('when.at');
    expect(validateSchedule({ ...good, when: { at: '2026-10-21T13:01' } }, options)).toHaveProperty('value');
  });

  it('accepts at just under a year ahead', () => {
    expect(validateSchedule({ ...good, when: { at: '2027-10-21T12:00' } }, options)).toHaveProperty('value');
  });
});
