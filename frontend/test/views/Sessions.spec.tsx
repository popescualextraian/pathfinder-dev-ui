import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskView } from '../../src/views/TaskView';
import { AddSessionDialog } from '../../src/views/AddSessionDialog';
import { TaskCard } from '../../src/views/TaskCard';
import * as api from '../../src/api/tasks-api';
import { ApiError } from '../../src/api/http';
import { makeSession, makeTask } from '../fixtures/tasks';
import { FakeEventSource } from '../api/fake-event-source';
import type { Task } from '../../src/api/models';

jest.mock('../../src/api/tasks-api');
const m = (f: unknown) => f as jest.Mock;

const q = (session: string) => ({
  id: `q-${session}`,
  source: 'ask' as const,
  session,
  text: `Question for ${session}?`,
  options: ['yes'],
  recommendation: null,
  asked: '2026-10-17T10:00:00Z',
});

const two = (over: Partial<Task> = {}) =>
  makeTask({
    state: 'idle',
    section: 'in-review',
    sessions: [
      makeSession({ name: 'main', state: 'idle', lastMessage: 'main says hi' }),
      makeSession({ name: 'second', state: 'idle', lastMessage: 'second says hi', createdAt: '2026-10-17T11:00:00Z' }),
    ],
    ...over,
  });

function Harness({ task, onTask }: { task: Task; onTask?: (t: Task) => void }) {
  const [session, setSession] = useState<string | null>(null);
  return <TaskView task={task} session={session} onSelectSession={setSession} onDeleted={jest.fn()} onTask={onTask} />;
}

beforeEach(() => {
  jest.resetAllMocks();
  FakeEventSource.install();
});

describe('session tabs', () => {
  it('lists tabs in order and switches the shown response', () => {
    render(<Harness task={two()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([expect.stringContaining('main'), expect.stringContaining('second')]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('main says hi')).toBeTruthy();
    fireEvent.click(tabs[1]);
    expect(screen.getByTestId('session-tab-second').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('second says hi')).toBeTruthy();
    expect(screen.queryByText('main says hi')).toBeNull();
  });
  it('falls back to main for an unknown session', () => {
    render(<TaskView task={two()} session="nope" onSelectSession={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.getByTestId('session-tab-main').getAttribute('aria-selected')).toBe('true');
  });
  it('clicking main selects null', () => {
    const onSelect = jest.fn();
    render(<TaskView task={two()} session="second" onSelectSession={onSelect} onDeleted={jest.fn()} />);
    fireEvent.click(screen.getByTestId('session-tab-main'));
    expect(onSelect).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByTestId('session-tab-second'));
    expect(onSelect).toHaveBeenLastCalledWith('second');
  });
  it('marks a tab with an open question and shows only that session questions', () => {
    const t = two({
      state: 'waiting',
      section: 'needs-you',
      questions: [q('second')],
      sessions: [
        makeSession({ name: 'main', state: 'idle' }),
        makeSession({ name: 'second', state: 'waiting', questions: 1 }),
      ],
    });
    render(<Harness task={t} />);
    expect(within(screen.getByTestId('session-tab-second')).getByLabelText('open question')).toBeTruthy();
    expect(within(screen.getByTestId('session-tab-main')).queryByLabelText('open question')).toBeNull();
    expect(screen.queryByText('Question for second?')).toBeNull();
    fireEvent.click(screen.getByTestId('session-tab-second'));
    expect(screen.getByText('Question for second?')).toBeTruthy();
  });
  it('reply and answer go to the selected session', async () => {
    m(api.sendPrompt).mockResolvedValue(two());
    m(api.answer).mockResolvedValue(two());
    const t = two({ questions: [q('second')] });
    render(<Harness task={t} />);
    fireEvent.click(screen.getByTestId('session-tab-second'));
    fireEvent.change(screen.getByLabelText('Follow-up'), { target: { value: 'go on' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(api.sendPrompt).toHaveBeenCalledWith('T-1', 'go on', 'second'));
    fireEvent.click(screen.getByText('yes'));
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith('T-1', { text: 'yes', question: 'q-second', session: 'second' }),
    );
  });
  it('cancel goes to the selected session and shows only when it runs', async () => {
    m(api.cancel).mockResolvedValue(two());
    const t = two({
      sessions: [makeSession({ name: 'main', state: 'idle' }), makeSession({ name: 'second', state: 'running' })],
    });
    render(<Harness task={t} />);
    expect(screen.queryByText('Cancel turn')).toBeNull();
    fireEvent.click(screen.getByTestId('session-tab-second'));
    fireEvent.click(screen.getByText('Cancel turn'));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('T-1', 'second'));
  });
  it('full run streams the selected session', () => {
    render(<Harness task={two()} />);
    fireEvent.click(screen.getByTestId('session-tab-second'));
    fireEvent.click(screen.getByText('View full run ▸'));
    expect(FakeEventSource.last.url).toContain('session=second');
  });
  it('+ Session is disabled for stopped and closed tasks', () => {
    const { unmount } = render(<Harness task={two()} />);
    expect((screen.getByText('+ Session') as HTMLButtonElement).disabled).toBe(false);
    unmount();
    const { unmount: u2 } = render(<Harness task={two({ state: 'stopped', section: 'done' })} />);
    expect((screen.getByText('+ Session') as HTMLButtonElement).disabled).toBe(true);
    u2();
    render(<Harness task={two({ closed: true, section: 'done' })} />);
    expect((screen.getByText('+ Session') as HTMLButtonElement).disabled).toBe(true);
  });
  it('creating a session selects it', async () => {
    const created = two({
      sessions: [...two().sessions, makeSession({ name: 'third', state: 'running', lastMessage: 'third hi' })],
    });
    m(api.addSession).mockResolvedValue(created);
    const Wrap = () => {
      const [t, setT] = useState(two());
      return <Harness task={t} onTask={setT} />;
    };
    render(<Wrap />);
    fireEvent.click(screen.getByText('+ Session'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'third' } });
    fireEvent.click(screen.getByText('Create session'));
    await waitFor(() => expect(screen.getByTestId('session-tab-third').getAttribute('aria-selected')).toBe('true'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('AddSessionDialog', () => {
  const sessions = [
    makeSession({ name: 'main', state: 'idle' }),
    makeSession({ name: 'busy', state: 'running' }),
    makeSession({ name: 'ask', state: 'waiting' }),
  ];
  const open = (onAdded = jest.fn(), onClose = jest.fn()) =>
    render(<AddSessionDialog taskId="T-1" sessions={sessions} onClose={onClose} onAdded={onAdded} />);

  it('requires a valid name', () => {
    open();
    const create = screen.getByText('Create session') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad Name' } });
    expect(create.disabled).toBe(true);
    expect(screen.getByText(/lowercase letters/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ok-name_1' } });
    expect(create.disabled).toBe(false);
  });
  it('only idle sessions can be fork sources', () => {
    open();
    const opt = (n: string) => screen.getByRole('option', { name: new RegExp(`^${n}`) }) as HTMLOptionElement;
    expect(opt('main').disabled).toBe(false);
    expect(opt('busy').disabled).toBe(true);
    expect(opt('ask').disabled).toBe(true);
  });
  it('sends name, model, forkFrom and prompt', async () => {
    const t = two();
    m(api.addSession).mockResolvedValue(t);
    const onAdded = jest.fn();
    open(onAdded);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'alt' } });
    fireEvent.change(screen.getByLabelText('Model (optional)'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Copy conversation from'), { target: { value: 'main' } });
    fireEvent.change(screen.getByLabelText('First prompt (optional)'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Create session'));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(t, 'alt'));
    expect(api.addSession).toHaveBeenCalledWith('T-1', { name: 'alt', model: 'opus', forkFrom: 'main', prompt: 'hello' });
  });
  it('sends only the name when nothing else is set', async () => {
    m(api.addSession).mockResolvedValue(two());
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'alt' } });
    fireEvent.click(screen.getByText('Create session'));
    await waitFor(() => expect(api.addSession).toHaveBeenCalledWith('T-1', { name: 'alt' }));
  });
  it('shows API errors and stays open', async () => {
    m(api.addSession).mockRejectedValue(new ApiError(409, 'session name taken'));
    const onAdded = jest.fn();
    open(onAdded);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'main' } });
    fireEvent.click(screen.getByText('Create session'));
    expect((await screen.findByRole('alert')).textContent).toBe('session name taken');
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('Escape closes', () => {
    const onClose = jest.fn();
    open(jest.fn(), onClose);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('TaskCard sessions', () => {
  it('shows the session count only when more than one, and the asking session', () => {
    const { unmount } = render(<TaskCard task={makeTask()} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText(/sessions/)).toBeNull();
    unmount();
    render(<TaskCard task={two()} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText('2 sessions')).toBeTruthy();
  });
  it('names the asking session', () => {
    render(
      <TaskCard
        task={two({ state: 'waiting', section: 'needs-you', questions: [q('second')] })}
        selected={false}
        onSelect={jest.fn()}
      />,
    );
    expect(screen.getByTestId('card-asking').textContent).toContain('second');
  });
});
