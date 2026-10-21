import { SCHEDULE_ID, proposeScheduleId } from '../../../../src/schedule/service/schedule-id';

describe('proposeScheduleId', () => {
  it('slugs the title', () => {
    expect(proposeScheduleId('Nightly deps update!', [])).toBe('nightly-deps-update');
    expect(proposeScheduleId('Příliš žluťoučký', [])).toMatch(SCHEDULE_ID);
  });
  it('makes it unique with -2, -3', () => {
    expect(proposeScheduleId('Nightly', ['nightly'])).toBe('nightly-2');
    expect(proposeScheduleId('Nightly', ['nightly', 'nightly-2'])).toBe('nightly-3');
  });
  it('caps at 40 characters, also with a suffix', () => {
    const title = 'a'.repeat(60);
    expect(proposeScheduleId(title, [])).toHaveLength(40);
    const second = proposeScheduleId(title, ['a'.repeat(40)]);
    expect(second).toHaveLength(40);
    expect(second.endsWith('-2')).toBe(true);
  });
  it('falls back to schedule-N', () => {
    expect(proposeScheduleId('???', [])).toBe('schedule-1');
    expect(proposeScheduleId('', ['schedule-1'])).toBe('schedule-2');
  });
});
