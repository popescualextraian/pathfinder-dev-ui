import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ScheduleList } from '../../src/views/ScheduleList';
import { makeResult, makeSummary } from '../fixtures/schedules';

function setup(over: Partial<React.ComponentProps<typeof ScheduleList>> = {}) {
  const props = {
    schedules: [makeSummary({ lastResult: makeResult() })],
    loading: false,
    error: null,
    pending: false,
    actionError: null,
    onNew: jest.fn(),
    onEdit: jest.fn(),
    onRun: jest.fn().mockResolvedValue(makeResult({ outcome: 'running', taskId: 'T-10', trigger: 'manual' })),
    onToggle: jest.fn().mockResolvedValue(true),
    ...over,
  };
  render(<ScheduleList {...props} />);
  return props;
}

describe('ScheduleList', () => {
  it('shows a row: title linking to the detail, when in words, next run, last result with its task', () => {
    setup();
    const row = screen.getByTestId('schedule-row-nightly');
    expect(within(row).getByRole('link', { name: 'Nightly deps' })).toHaveAttribute('href', '#/schedules/nightly');
    expect(row).toHaveTextContent('weekdays at 02:00');
    expect(row).toHaveTextContent('Next Thu 22 Oct 02:00');
    expect(row).toHaveTextContent('done');
    expect(row).toHaveTextContent('Wed 21 Oct 23:00');
    expect(within(row).getByRole('link', { name: 'T-9' })).toHaveAttribute('href', '#/tasks/T-9');
    expect(screen.getByText(/Times in UTC/)).toBeInTheDocument();
  });

  it('a disabled schedule says so and has no next run; never run says so', () => {
    setup({ schedules: [makeSummary({ enabled: false, nextRunAt: null })] });
    const row = screen.getByTestId('schedule-row-nightly');
    expect(row).toHaveTextContent('Off');
    expect(row).toHaveTextContent('Not run yet');
    expect(within(row).getByRole('checkbox', { name: 'Enabled Nightly deps' })).not.toBeChecked();
  });

  it('toggles, edits and runs now, then tells what happened', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled Nightly deps' }));
    expect(p.onToggle).toHaveBeenCalledWith(p.schedules[0], false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nightly deps' }));
    expect(p.onEdit).toHaveBeenCalledWith('nightly');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Nightly deps now' }));
    });
    expect(p.onRun).toHaveBeenCalledWith('nightly');
    expect(screen.getByRole('status')).toHaveTextContent('Nightly deps started task T-10');
  });

  it('a skipped run now shows its reason', async () => {
    setup({ onRun: jest.fn().mockResolvedValue(makeResult({ outcome: 'skipped', reason: 'the previous run still runs', taskId: undefined })) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Nightly deps now' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Nightly deps skipped: the previous run still runs');
  });

  it('empty: a New schedule button', () => {
    const p = setup({ schedules: [] });
    expect(screen.getByText(/No schedules yet/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New schedule' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(p.onNew).toHaveBeenCalled();
  });

  it('shows load and action errors', () => {
    setup({ error: 'down', actionError: 'refused' });
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts.join(' ')).toContain('down');
    expect(alerts.join(' ')).toContain('refused');
  });

  it('disables the actions while one is pending', () => {
    setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Run Nightly deps now' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Enabled Nightly deps' })).toBeDisabled();
  });
});
