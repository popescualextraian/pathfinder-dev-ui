import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskList } from '../../src/views/TaskList';
import { TaskCard } from '../../src/views/TaskCard';
import { formatAge, formatAgo } from '../../src/views/format-age';
import { App } from '../../src/App';
import * as tasksApi from '../../src/api/tasks-api';
import * as reposApi from '../../src/api/repositories-api';
import { FakeEventSource } from '../api/fake-event-source';
import { makeTask } from '../fixtures/tasks';

jest.mock('../../src/api/tasks-api');
jest.mock('../../src/api/repositories-api');
jest.mock('../../src/state/use-system-info', () => ({
  useSystemInfo: () => ({ status: 'loading' }),
}));

const tasks = [
  makeTask({
    id: 'T-w',
    title: 'Waiting one',
    state: 'waiting',
    section: 'needs-you',
    questions: [
      {
        id: 'q',
        source: 'ask',
        session: 'main',
        text: 'Which DB?',
        options: [],
        recommendation: null,
        asked: '',
      },
    ],
    lastMessage: 'ignored',
  }),
  makeTask({
    id: 'T-r',
    title: 'Running one',
    state: 'running',
    section: 'working',
    lastMessage: 'Working on it',
  }),
  makeTask({
    id: 'T-i',
    title: 'Idle one',
    state: 'idle',
    section: 'in-review',
    summary: 'All done here',
  }),
  makeTask({
    id: 'T-c',
    title: 'Closed one',
    state: 'idle',
    section: 'done',
    closed: true,
  }),
  makeTask({
    id: 'T-s',
    title: 'Stopped one',
    state: 'stopped',
    section: 'done',
  }),
];

describe('TaskList sections', () => {
  it.each([
    ['Needs you', 'Waiting one'],
    ['Working', 'Running one'],
    ['In review', 'Idle one'],
  ])('shows %s section with its card', (section, title) => {
    render(<TaskList tasks={tasks} selectedId={null} onSelect={() => undefined} />);
    const s = screen.getByRole('region', { name: section });
    expect(within(s).getByText(title)).toBeTruthy();
    expect(within(s).getAllByRole('button')).toHaveLength(1);
  });

  it('collapses Done behind a show button and expands it', () => {
    render(<TaskList tasks={tasks} selectedId={null} onSelect={() => undefined} />);
    expect(screen.queryByText('Closed one')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /▸ 2 closed tasks/ }));
    expect(screen.getByText('Closed one')).toBeTruthy();
    expect(screen.getByText('Stopped one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByText('Closed one')).toBeNull();
  });

  it('shows empty and error notes and hides empty sections', () => {
    const { rerender } = render(<TaskList tasks={[]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByText('No tasks yet.')).toBeTruthy();
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<TaskList tasks={[]} selectedId={null} onSelect={() => undefined} error="boom" />);
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });
});

describe('TaskCard', () => {
  it('labels a workflow generator task on its card and not others', () => {
    const { rerender } = render(<TaskCard task={makeTask({ kind: 'workflow-generator' })} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText('Workflow generator')).toBeTruthy();
    rerender(<TaskCard task={makeTask()} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText('Workflow generator')).toBeNull();
  });

  it('shows title, pill text, line, branch, age; selecting calls onSelect', () => {
    const onSelect = jest.fn();
    const now = Date.parse('2026-10-17T10:12:00Z');
    render(<TaskCard task={tasks[0]} selected={false} onSelect={onSelect} now={now} />);
    expect(screen.getByText('waiting')).toBeTruthy();
    expect(screen.getByText('Which DB?')).toBeTruthy();
    expect(screen.getByText('agentic/T-1')).toBeTruthy();
    expect(screen.getByText('12 min')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('T-w');
  });

  it('falls back to last message, summary, then empty; marks selected', () => {
    const { rerender } = render(<TaskCard task={tasks[1]} selected onSelect={jest.fn()} />);
    expect(screen.getByText('Working on it')).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true');
    rerender(<TaskCard task={tasks[2]} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText('All done here')).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-current')).toBeNull();
  });

  it('a scheduled task: a clock chip with the schedule title linking to it, outside the select button', () => {
    const onSelect = jest.fn();
    render(<TaskCard task={makeTask({ scheduleId: 'nightly', scheduleTitle: 'Nightly deps' })} selected={false} onSelect={onSelect} />);
    const chip = screen.getByRole('link', { name: /Nightly deps/ });
    expect(chip.getAttribute('href')).toBe('#/schedules/nightly');
    expect(chip.textContent).toContain('⏰');
    expect(screen.getByRole('button').contains(chip)).toBe(false);
    chip.addEventListener('click', (e) => e.preventDefault()); // keep the test's address
    fireEvent.click(chip);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a finished scheduled task shows the first line of its summary', () => {
    render(
      <TaskCard
        task={makeTask({ scheduleId: 's', scheduleTitle: 'S', state: 'stopped', section: 'done', lastMessage: 'last', summaryLine: 'Updated 3 packages.' })}
        selected={false}
        onSelect={jest.fn()}
      />,
    );
    expect(screen.getByText('Updated 3 packages.')).toBeTruthy();
    expect(screen.queryByText('last')).toBeNull();
  });

  it('an ordinary task has no schedule chip', () => {
    render(<TaskCard task={makeTask()} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('labels closed tasks', () => {
    render(<TaskCard task={tasks[3]} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText('closed')).toBeTruthy();
  });
});

describe('formatAge', () => {
  it('formats units', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(formatAge('2026-10-17T11:59:50Z', now)).toBe('now');
    expect(formatAgo('2026-10-17T11:59:50Z', now)).toBe('just now');
    expect(formatAgo('2026-10-17T11:30:00Z', now)).toBe('30 min ago');
    expect(formatAge('2026-10-17T10:00:00Z', now)).toBe('2 h');
    expect(formatAge('2026-10-14T12:00:00Z', now)).toBe('3 d');
  });
});

describe('App: sidebar, filter and stream', () => {
  beforeEach(() => {
    FakeEventSource.install();
    window.location.hash = '';
    (tasksApi.getTask as jest.Mock).mockResolvedValue(makeTask({ id: 'T-r', title: 'Running one' }));
    (reposApi.listRepositories as jest.Mock).mockResolvedValue([
      { name: 'repo-a', url: 'a', default: true },
      { name: 'repo-b', url: 'b', default: false },
    ]);
    (tasksApi.listTasks as jest.Mock).mockResolvedValue([
      ...tasks,
      makeTask({
        id: 'T-b',
        title: 'In B',
        repository: 'repo-b',
        createdAt: '2026-10-17T09:00:00Z',
      }),
    ]);
  });

  it('counts open tasks per repository and filters via the URL', async () => {
    render(<App />);
    await screen.findByText('Running one');
    const all = screen.getByRole('button', { name: /All repositories/ });
    expect(within(all).getByText('5')).toBeTruthy(); // 6 tasks, 1 closed
    expect(within(screen.getByRole('button', { name: /repo-a/ })).getByText('4')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /repo-b/ })).getByText('1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /repo-b/ }));
    expect(window.location.hash).toBe('#/repo/repo-b');
    await waitFor(() => expect(screen.queryByText('Running one')).toBeNull());
    expect(screen.getByText('In B')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /All repositories/ }));
    await screen.findByText('Running one');
    expect(window.location.hash).toBe('#/');
  });

  it('selecting a card sets the URL', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('Running one'));
    expect(window.location.hash).toBe('#/tasks/T-r');
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Working' }))
          .getByText('Running one')
          .closest('button')
          ?.getAttribute('aria-current'),
      ).toBe('true'),
    );
  });

  it('moves a card between sections on a stream event', async () => {
    render(<App />);
    await screen.findByText('Running one');
    expect(within(screen.getByRole('region', { name: 'Working' })).getByText('Running one')).toBeTruthy();
    act(() =>
      FakeEventSource.last.emit('task', {
        ...tasks[1],
        state: 'waiting',
        section: 'needs-you',
      }),
    );
    expect(within(screen.getByRole('region', { name: 'Needs you' })).getByText('Running one')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Working' })).queryByText('Running one')).toBeNull();
    act(() => FakeEventSource.last.emit('removed', { id: 'T-r' }));
    expect(screen.queryByText('Running one')).toBeNull();
  });
});
