import { formatInZone, isValidZone, nextRunAt, previewNext, zonedToInstant } from '../../../../src/schedule/service/schedule-time';

const ZONE = 'Europe/Bucharest';

describe('schedule time', () => {
  it('validates IANA zones', () => {
    expect(isValidZone(ZONE)).toBe(true);
    expect(isValidZone('Mars/Base')).toBe(false);
  });

  it('formats an instant with the zone offset', () => {
    expect(formatInZone(new Date('2026-10-22T19:00:00Z'), ZONE)).toBe('2026-10-22T22:00:00+03:00');
    expect(formatInZone(new Date('2026-12-01T00:00:00Z'), ZONE)).toBe('2026-12-01T02:00:00+02:00');
    expect(formatInZone(new Date('2026-12-01T00:00:00Z'), 'UTC')).toBe('2026-12-01T00:00:00+00:00');
  });

  it('converts a local time to an instant', () => {
    expect(zonedToInstant('2026-10-22T22:00', ZONE).toISOString()).toBe('2026-10-22T19:00:00.000Z');
    expect(zonedToInstant('2026-12-01T02:00', ZONE).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('computes the next cron time in the zone', () => {
    expect(nextRunAt({ cron: '0 2 * * 1-5' }, ZONE, new Date('2026-10-22T12:00:00Z'))).toBe('2026-10-23T02:00:00+03:00');
  });

  it('keeps 02:00 local across the October DST change (last Sunday)', () => {
    const next = previewNext({ cron: '0 2 * * *' }, ZONE, new Date('2026-10-24T12:00:00Z'), 3);
    expect(next).toEqual(['2026-10-25T02:00:00+03:00', '2026-10-26T02:00:00+02:00', '2026-10-27T02:00:00+02:00']);
  });

  it('keeps 08:00 local across the March DST change', () => {
    const next = previewNext({ cron: '0 8 * * *' }, ZONE, new Date('2026-03-27T12:00:00Z'), 3);
    expect(next).toEqual(['2026-03-28T08:00:00+02:00', '2026-03-29T08:00:00+03:00', '2026-03-30T08:00:00+03:00']);
  });

  it('handles the end of the month', () => {
    const next = previewNext({ cron: '30 9 31 * *' }, 'UTC', new Date('2026-01-31T10:00:00Z'), 3);
    expect(next).toEqual(['2026-03-31T09:30:00+00:00', '2026-05-31T09:30:00+00:00', '2026-07-31T09:30:00+00:00']);
  });

  it('returns the at time itself, and null when it is past', () => {
    expect(nextRunAt({ at: '2026-10-22T22:00' }, ZONE, new Date('2026-10-21T00:00:00Z'))).toBe('2026-10-22T22:00:00+03:00');
    expect(previewNext({ at: '2026-10-22T22:00' }, ZONE, new Date('2026-10-21T00:00:00Z'))).toEqual(['2026-10-22T22:00:00+03:00']);
    expect(nextRunAt({ at: '2026-10-22T22:00' }, ZONE, new Date('2026-10-23T00:00:00Z'))).toBeNull();
  });

  it('previews three times by default', () => {
    expect(previewNext({ cron: '*/10 * * * *' }, 'UTC', new Date('2026-01-01T00:00:00Z'))).toHaveLength(3);
  });
});
