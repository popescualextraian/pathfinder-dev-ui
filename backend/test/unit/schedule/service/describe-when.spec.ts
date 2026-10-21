import { describeWhen } from '../../../../src/schedule/service/describe-when';

describe('describeWhen', () => {
  it.each([
    [{ cron: '0 2 * * *' }, 'daily at 02:00'],
    [{ cron: '30 14 * * 1-5' }, 'weekdays at 14:30'],
    [{ cron: '0 9 * * 1' }, 'Mondays at 09:00'],
    [{ cron: '0 9 * * 0' }, 'Sundays at 09:00'],
    [{ cron: '0 9 * * 7' }, 'Sundays at 09:00'],
    [{ cron: '*/15 * * * *' }, '*/15 * * * *'],
    [{ cron: '0 2 1 * *' }, '0 2 1 * *'],
    [{ at: '2026-10-22T22:00' }, 'once on 22 Oct 22:00'],
    [{ at: '2026-01-05T07:05' }, 'once on 5 Jan 07:05'],
  ])('%j -> %s', (when, text) => {
    expect(describeWhen(when)).toBe(text);
  });
});
