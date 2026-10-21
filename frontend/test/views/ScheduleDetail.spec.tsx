import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ScheduleDetail } from '../../src/views/ScheduleDetail';
import { makeRecord, makeResult } from '../fixtures/schedules';

const NOW = Date.parse('2026-10-21T23:25:00Z');

function setup(over: Partial<React.ComponentProps<typeof ScheduleDetail>> = {}) {
  const props = {
    schedule: makeRecord({
      ref: 'develop',
      model: 'sonnet',
      results: [
        makeResult({ firedAt: '2026-10-21T23:00:00.000Z', outcome: 'running', trigger: 'manual', taskId: 'T-10', branch: 'agentic/T-10' }),
        makeResult({
          firedAt: '2026-10-20T23:00:00.000Z',
          endedAt: '2026-10-21T00:05:00.000Z',
          summary: 'Updated 3 packages.\nOpened PR #4.',
        }),
        makeResult({ firedAt: '2026-10-19T23:00:00.000Z', outcome: 'skipped', reason: 'the running cap is reached', taskId: undefined, branch: undefined }),
      ],
    }),
    pending: false,
    actionError: null,
    onBack: jest.fn(),
    onEdit: jest.fn(),
    onRun: jest.fn().mockResolvedValue(null),
    onToggle: jest.fn().mockResolvedValue(true),
    onDelete: jest.fn().mockResolvedValue(true),
    now: NOW,
    ...over,
  };
  render(<ScheduleDetail {...props} />);
  return props;
}

describe('ScheduleDetail', () => {
  it('shows the settings read-only, with the grants, and Edit', () => {
    const p = setup();
    expect(screen.getByRole('heading', { name: 'Nightly deps' })).toBeInTheDocument();
    const settings = screen.getByRole('region', { name: 'Settings' });
    expect(settings).toHaveTextContent('repo-a');
    expect(settings).toHaveTextContent('develop');
    expect(settings).toHaveTextContent('sonnet');
    expect(settings).toHaveTextContent('weekdays at 02:00');
    expect(settings).toHaveTextContent('Thu 22 Oct 02:00 (UTC)');
    expect(settings).toHaveTextContent('120 min');
    expect(within(settings).getByText('Grants').nextSibling).toHaveTextContent('push, open-pr');
    expect(within(settings).getByText(/Update the dependencies\./)).toBeInTheDocument();
    expect(within(settings).queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(p.onEdit).toHaveBeenCalled();
  });

  it('lists results newest first: time, trigger, outcome, duration, task link and branch, summary', () => {
    setup();
    const items = within(screen.getByRole('list', { name: 'Results' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Wed 21 Oct 23:00');
    expect(items[0]).toHaveTextContent('Run now');
    expect(items[0]).toHaveTextContent('running');
    expect(items[0]).toHaveTextContent('working for 25 min, time limit at 01:00');
    expect(within(items[0]).getByRole('link', { name: 'T-10' })).toHaveAttribute('href', '#/tasks/T-10');
    expect(items[0]).toHaveTextContent('agentic/T-10');
    expect(items[1]).toHaveTextContent('By schedule');
    expect(items[1]).toHaveTextContent('took 1 h 5 min');
    const summary = within(items[1]).getByText(/Updated 3 packages/);
    expect(summary.textContent).toBe('Updated 3 packages.\nOpened PR #4.');
    expect(items[2]).toHaveTextContent('skipped');
    expect(items[2]).toHaveTextContent('the running cap is reached');
  });

  it('no results yet', () => {
    setup({ schedule: makeRecord() });
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
  });

  it('runs now, toggles and goes back', async () => {
    const p = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    });
    expect(p.onRun).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }));
    expect(p.onToggle).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: /All schedules/ }));
    expect(p.onBack).toHaveBeenCalled();
  });

  it('deletes only after a confirm', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete schedule "Nightly deps"?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });
    expect(p.onDelete).toHaveBeenCalled();
  });

  it('shows the action error', () => {
    setup({ actionError: 'boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
