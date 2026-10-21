import '@testing-library/jest-dom';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import * as api from '../../src/api/schedules-api';
import { useRoute } from '../../src/state/use-route';
import { ScheduleForm } from '../../src/views/ScheduleForm';
import { makeRecord } from '../fixtures/schedules';

jest.mock('../../src/api/schedules-api');
const m = api as jest.Mocked<typeof api>;

const repos = [
  { name: 'repo-a', url: 'a', default: false },
  { name: 'repo-b', url: 'b', default: true },
];

function setup(over: Partial<React.ComponentProps<typeof ScheduleForm>> = {}) {
  const props = { repositories: repos, onSaved: jest.fn(), onCancel: jest.fn(), previewDelay: 0, ...over };
  render(<ScheduleForm {...props} />);
  return props;
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

beforeEach(() => {
  jest.resetAllMocks();
  window.location.hash = '#/schedules/new';
  m.previewSchedule.mockResolvedValue({ zone: 'Europe/Helsinki', next: ['2026-10-22T09:00:00+03:00', '2026-10-23T09:00:00+03:00'] });
});

describe('ScheduleForm', () => {
  it('new: defaults (default repository, daily at 09:00, 120 min), the notes, next runs with the zone', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'New schedule' })).toBeInTheDocument();
    expect(field('Repository').value).toBe('repo-b');
    expect(screen.getByRole('radio', { name: 'Repeat' })).toBeChecked();
    expect(field('Repeats').value).toBe('daily');
    expect(field('At').value).toBe('09:00');
    expect(field('Time limit (minutes)').value).toBe('120');
    expect(screen.getByText(/the agent is asked for its summary when the time is up/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody answers questions during a scheduled run/)).toBeInTheDocument();
    const next = await screen.findByTestId('schedule-next-runs');
    await waitFor(() => expect(next).toHaveTextContent('Thu 22 Oct 09:00'));
    expect(next).toHaveTextContent('Fri 23 Oct 09:00');
    expect(next).toHaveTextContent('Europe/Helsinki');
    expect(m.previewSchedule).toHaveBeenCalledWith({ cron: '0 9 * * *' });
  });

  it('presets write the cron line; custom starts from it; once asks for date and time', async () => {
    setup();
    fireEvent.change(field('Repeats'), { target: { value: 'weekly' } });
    fireEvent.change(field('On'), { target: { value: '3' } });
    fireEvent.change(field('At'), { target: { value: '02:30' } });
    await waitFor(() => expect(m.previewSchedule).toHaveBeenLastCalledWith({ cron: '30 2 * * 3' }));
    fireEvent.change(field('Repeats'), { target: { value: 'weekdays' } });
    await waitFor(() => expect(m.previewSchedule).toHaveBeenLastCalledWith({ cron: '30 2 * * 1-5' }));
    fireEvent.change(field('Repeats'), { target: { value: 'custom' } });
    expect(field('Cron line').value).toBe('30 2 * * 1-5');
    fireEvent.change(field('Cron line'), { target: { value: '0 0 1 * *' } });
    await waitFor(() => expect(m.previewSchedule).toHaveBeenLastCalledWith({ cron: '0 0 1 * *' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Once' }));
    fireEvent.change(field('Date'), { target: { value: '2026-10-22' } });
    fireEvent.change(field('At'), { target: { value: '22:00' } });
    await waitFor(() => expect(m.previewSchedule).toHaveBeenLastCalledWith({ at: '2026-10-22T22:00' }));
  });

  it('shows the preview error of a bad cron', async () => {
    m.previewSchedule.mockRejectedValue(new ApiError(400, 'when.cron: does not parse', { field: 'when.cron' }));
    setup();
    fireEvent.change(field('Repeats'), { target: { value: 'custom' } });
    fireEvent.change(field('Cron line'), { target: { value: 'nope' } });
    expect(await screen.findByText(/does not parse/)).toBeInTheDocument();
  });

  it('creates and reports the new id', async () => {
    m.createSchedule.mockResolvedValue(makeRecord({ id: 'nightly' }));
    const p = setup();
    fireEvent.change(field('Title'), { target: { value: 'Nightly deps' } });
    fireEvent.change(field('Ref (optional)'), { target: { value: 'develop' } });
    fireEvent.change(field('Model (optional)'), { target: { value: 'sonnet' } });
    fireEvent.change(field('Prompt'), { target: { value: 'Update deps' } });
    fireEvent.change(field('Time limit (minutes)'), { target: { value: '30' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(m.createSchedule).toHaveBeenCalledWith({
      title: 'Nightly deps', prompt: 'Update deps', repository: 'repo-b', ref: 'develop', model: 'sonnet',
      when: { cron: '0 9 * * *' }, timeoutMinutes: 30, enabled: true,
    });
    expect(p.onSaved).toHaveBeenCalledWith('nightly');
  });

  it('shows a save error at its field', async () => {
    m.createSchedule.mockRejectedValue(new ApiError(400, 'title is required', { field: 'title' }));
    setup();
    fireEvent.change(field('Prompt'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('title is required');
    expect(field('Title')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edit: reads the schedule back (weekdays preset), replaces it keeping enabled', async () => {
    m.replaceSchedule.mockResolvedValue(makeRecord());
    const schedule = makeRecord({ enabled: false, nextRunAt: null, ref: 'main' });
    const p = setup({ schedule });
    expect(screen.getByRole('heading', { name: 'Edit schedule' })).toBeInTheDocument();
    expect(field('Title').value).toBe('Nightly deps');
    expect(field('Repository').value).toBe('repo-a');
    expect(field('Ref (optional)').value).toBe('main');
    expect(field('Repeats').value).toBe('weekdays');
    expect(field('At').value).toBe('02:00');
    fireEvent.change(field('Title'), { target: { value: 'Renamed' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(m.replaceSchedule).toHaveBeenCalledWith('nightly', expect.objectContaining({ title: 'Renamed', enabled: false, ref: 'main', when: { cron: '0 2 * * 1-5' } }));
    expect(p.onSaved).toHaveBeenCalledWith('nightly');
  });

  it('edit: a finished (disabled) one-off moved to a new time is saved enabled; unchanged it stays disabled', async () => {
    m.replaceSchedule.mockResolvedValue(makeRecord());
    const schedule = makeRecord({ when: { at: '2026-10-20T22:00' }, enabled: false, nextRunAt: null });
    setup({ schedule });
    fireEvent.change(field('Title'), { target: { value: 'Renamed' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(m.replaceSchedule).toHaveBeenLastCalledWith('nightly', expect.objectContaining({ when: { at: '2026-10-20T22:00' }, enabled: false }));
    fireEvent.change(field('Date'), { target: { value: '2099-01-02' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(m.replaceSchedule).toHaveBeenLastCalledWith('nightly', expect.objectContaining({ when: { at: '2099-01-02T22:00' }, enabled: true }));
  });

  it('edit: a disabled repeating schedule stays disabled when its time changes', async () => {
    m.replaceSchedule.mockResolvedValue(makeRecord());
    setup({ schedule: makeRecord({ enabled: false, nextRunAt: null }) });
    fireEvent.change(field('At'), { target: { value: '03:00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(m.replaceSchedule).toHaveBeenLastCalledWith('nightly', expect.objectContaining({ enabled: false }));
  });

  it('edit: a custom cron opens as Custom', () => {
    setup({ schedule: makeRecord({ when: { cron: '0 9 1 * *' } }) });
    expect(field('Repeats').value).toBe('custom');
    expect(field('Cron line').value).toBe('0 9 1 * *');
  });

  it('Cancel without changes leaves at once; with changes asks first', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.change(field('Title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard your changes?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });

  it('leaving by another route with changes asks first', async () => {
    renderHook(() => useRoute());
    setup();
    fireEvent.change(field('Title'), { target: { value: 'x' } });
    await act(async () => {
      window.location.hash = '#/backlog';
    });
    expect(await screen.findByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/schedules/new');
  });
});
