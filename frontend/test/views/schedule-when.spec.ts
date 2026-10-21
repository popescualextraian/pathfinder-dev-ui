import {
  DEFAULT_WHEN_FORM, describeWhen, formToWhen, formatDuration, formatClock, formatTime, whenToForm,
} from '../../src/views/schedule-when';

describe('describeWhen', () => {
  it('says presets in words and a custom cron as it is', () => {
    expect(describeWhen({ cron: '0 2 * * *' })).toBe('daily at 02:00');
    expect(describeWhen({ cron: '30 7 * * 1-5' })).toBe('weekdays at 07:30');
    expect(describeWhen({ cron: '0 9 * * 1' })).toBe('Mondays at 09:00');
    expect(describeWhen({ cron: '0 9 * * 0' })).toBe('Sundays at 09:00');
    expect(describeWhen({ cron: '*/5 * * * *' })).toBe('*/5 * * * *');
    expect(describeWhen({ at: '2026-10-22T22:00' })).toBe('once on 22 Oct 22:00');
  });
});

describe('whenToForm / formToWhen', () => {
  it('reads a preset cron back into its preset', () => {
    expect(whenToForm({ cron: '0 2 * * *' })).toMatchObject({ mode: 'repeat', preset: 'daily', time: '02:00' });
    expect(whenToForm({ cron: '5 7 * * 1-5' })).toMatchObject({ mode: 'repeat', preset: 'weekdays', time: '07:05' });
    expect(whenToForm({ cron: '0 9 * * 3' })).toMatchObject({ mode: 'repeat', preset: 'weekly', day: 3, time: '09:00' });
    expect(whenToForm({ cron: '0 9 * * 7' })).toMatchObject({ preset: 'weekly', day: 0 });
    expect(whenToForm({ cron: '0 9 1 * *' })).toMatchObject({ mode: 'repeat', preset: 'custom', cron: '0 9 1 * *' });
    expect(whenToForm({ at: '2026-10-22T22:00' })).toMatchObject({ mode: 'once', date: '2026-10-22', time: '22:00' });
    expect(whenToForm(undefined)).toEqual(DEFAULT_WHEN_FORM);
  });

  it('writes the cron line of a preset', () => {
    const f = { ...DEFAULT_WHEN_FORM, mode: 'repeat' as const, time: '02:30' };
    expect(formToWhen({ ...f, preset: 'daily' })).toEqual({ cron: '30 2 * * *' });
    expect(formToWhen({ ...f, preset: 'weekdays' })).toEqual({ cron: '30 2 * * 1-5' });
    expect(formToWhen({ ...f, preset: 'weekly', day: 5 })).toEqual({ cron: '30 2 * * 5' });
    expect(formToWhen({ ...f, preset: 'custom', cron: ' 0 0 1 * * ' })).toEqual({ cron: '0 0 1 * *' });
    expect(formToWhen({ ...f, preset: 'custom', cron: ' ' })).toBeNull();
    expect(formToWhen({ ...f, preset: 'daily', time: '' })).toBeNull();
    expect(formToWhen({ ...f, mode: 'once', date: '2026-10-22', time: '22:00' })).toEqual({ at: '2026-10-22T22:00' });
    expect(formToWhen({ ...f, mode: 'once', date: '', time: '22:00' })).toBeNull();
  });

  it('round-trips presets', () => {
    for (const cron of ['0 2 * * *', '15 23 * * 1-5', '0 9 * * 6']) expect(formToWhen(whenToForm({ cron }))).toEqual({ cron });
  });
});

describe('formatTime / formatClock / formatDuration', () => {
  it('shows a time in the zone', () => {
    expect(formatTime('2026-10-22T02:00:00+03:00', 'Europe/Helsinki')).toBe('Thu 22 Oct 02:00');
    expect(formatTime('2026-10-21T23:00:00.000Z', 'Europe/Helsinki')).toBe('Thu 22 Oct 02:00');
    expect(formatTime('2026-10-21T23:00:00.000Z', 'UTC')).toBe('Wed 21 Oct 23:00');
    expect(formatClock(Date.parse('2026-10-21T23:05:00Z'), 'UTC')).toBe('23:05');
    // A bad zone falls back to the browser's.
    expect(formatTime('2026-10-21T23:00:00.000Z', 'Nowhere/Bad')).toMatch(/Oct \d\d:\d\d$/);
  });

  it('says how long', () => {
    expect(formatDuration(30_000)).toBe('under a minute');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
  });
});
