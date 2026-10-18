import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskView } from '../../src/views/TaskView';
import { NewTaskDialog } from '../../src/views/NewTaskDialog';
import { FactsPanel } from '../../src/views/FactsPanel';
import * as api from '../../src/api/tasks-api';
import { ApiError } from '../../src/api/http';
import { makeTask } from '../fixtures/tasks';
import { FakeEventSource } from '../api/fake-event-source';

jest.mock('../../src/api/tasks-api');
const m = (f: unknown) => f as jest.Mock;

const question = {
  id: 'q1',
  source: 'ask' as const,
  text: 'Which db?',
  options: ['pg', 'sqlite'],
  recommendation: 'pg',
  asked: '2026-10-17T10:00:00Z',
};
const waiting = () => makeTask({ state: 'waiting', section: 'needs-you', questions: [question] });
const idle = (o = {}) => makeTask({ state: 'idle', section: 'in-review', ...o });
const done = () => idle({ closed: true, section: 'done' });
const view = (t = makeTask(), onDeleted = jest.fn()) => render(<TaskView task={t} onDeleted={onDeleted} />);

beforeEach(() => {
  jest.resetAllMocks();
  FakeEventSource.install();
});

describe('TaskView header', () => {
  it('working: Cancel turn, no Close; cancel pending and error', async () => {
    let reject!: (e: Error) => void;
    m(api.cancel).mockReturnValue(new Promise((_, r) => (reject = r)));
    view();
    expect(screen.queryByText('Close task')).toBeNull();
    fireEvent.click(screen.getByText('Cancel turn'));
    await waitFor(() => expect((screen.getByText('Cancel turn') as HTMLButtonElement).disabled).toBe(true));
    reject(new ApiError(409, 'task is closed'));
    expect((await screen.findByRole('alert')).textContent).toBe('task is closed');
    expect(api.cancel).toHaveBeenCalledWith('T-1');
  });
  it('close: pending, error', async () => {
    m(api.close).mockRejectedValue(new ApiError(500, 'boom'));
    view(idle());
    expect(screen.queryByText('Cancel turn')).toBeNull();
    fireEvent.click(screen.getByText('Close task'));
    expect((await screen.findByRole('alert')).textContent).toBe('boom');
  });
  it('closed task has no Close, shows Delete only after confirm; delete clears selection', async () => {
    m(api.deleteTask).mockResolvedValue(undefined);
    const onDeleted = jest.fn();
    view(done(), onDeleted);
    expect(screen.queryByText('Close task')).toBeNull();
    fireEvent.click(screen.getByText('Delete forever'));
    expect(api.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Yes, delete'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(api.deleteTask).toHaveBeenCalledWith('T-1');
  });
  it('delete error keeps selection and shows message', async () => {
    m(api.deleteTask).mockRejectedValue(new ApiError(409, 'still running'));
    const onDeleted = jest.fn();
    view(done(), onDeleted);
    fireEvent.click(screen.getByText('Delete forever'));
    fireEvent.click(screen.getByText('Yes, delete'));
    expect((await screen.findByRole('alert')).textContent).toBe('still running');
    expect(onDeleted).not.toHaveBeenCalled();
  });
  it('stopped not closed: Close and Delete; no Delete when open', () => {
    view(makeTask({ state: 'stopped', section: 'done' }));
    expect(screen.getByText('Close task')).toBeTruthy();
    expect(screen.getByText('Delete forever')).toBeTruthy();
  });
  it('no Delete for in-review', () => {
    view(idle());
    expect(screen.queryByText('Delete forever')).toBeNull();
  });
});

describe('TaskView body', () => {
  it('collapses and expands prompt and last response, falls back to summary', () => {
    const long = 'line\n'.repeat(10);
    const { unmount } = view(idle({ prompt: long, lastMessage: long }));
    fireEvent.click(screen.getByText('show all'));
    expect(screen.getByText('show less')).toBeTruthy();
    fireEvent.click(screen.getByText('show more'));
    expect(
      screen.getByText('show less', {
        selector: 'section[aria-label="Last response"] button',
      }),
    ).toBeTruthy();
    unmount();
    view(idle({ summary: 'the summary' }));
    expect(screen.getByText('the summary')).toBeTruthy();
  });
  it('answers a question by option and by text, with pending and error', async () => {
    m(api.answer).mockResolvedValueOnce(waiting()).mockRejectedValueOnce(new ApiError(409, 'no open question'));
    view(waiting());
    expect(screen.getByText('pg (recommended)')).toBeTruthy();
    fireEvent.click(screen.getByText('sqlite'));
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith('T-1', {
        text: 'sqlite',
        question: 'q1',
      }),
    );
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'mysql' },
    });
    fireEvent.click(screen.getByText('Answer'));
    await waitFor(() =>
      expect(api.answer).toHaveBeenLastCalledWith('T-1', {
        text: 'mysql',
        question: 'q1',
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe('no open question');
  });
  it('sends a follow-up with Enter, disables while pending, clears on success', async () => {
    let resolve!: () => void;
    m(api.sendPrompt).mockReturnValue(new Promise<void>((r) => (resolve = r)));
    view(idle());
    const box = screen.getByLabelText('Follow-up') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'more' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(box.disabled).toBe(true));
    expect(api.sendPrompt).toHaveBeenCalledWith('T-1', 'more');
    resolve();
    await waitFor(() => expect(box.value).toBe(''));
    expect(box.disabled).toBe(false);
  });
  it('follow-up error is shown and text kept', async () => {
    m(api.sendPrompt).mockRejectedValue(new ApiError(409, 'closed'));
    view(idle());
    const box = screen.getByLabelText('Follow-up') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect((await screen.findByRole('alert')).textContent).toBe('closed');
    expect(box.value).toBe('x');
  });
  it('reply box is disabled for closed and stopped', () => {
    const { unmount } = view(done());
    expect((screen.getByLabelText('Follow-up') as HTMLTextAreaElement).disabled).toBe(true);
    unmount();
    view(makeTask({ state: 'stopped', section: 'done' }));
    expect((screen.getByLabelText('Follow-up') as HTMLTextAreaElement).disabled).toBe(true);
  });
  it('placeholder says stopped for a stopped task', () => {
    view(makeTask({ state: 'stopped', section: 'done' }));
    expect(screen.getByPlaceholderText('This task is stopped')).toBeTruthy();
  });
  it('question cards are disabled on a stopped task', () => {
    view(makeTask({ state: 'stopped', section: 'done', questions: [question] }));
    expect((screen.getByText(/pg/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Your answer') as HTMLInputElement).disabled).toBe(true);
  });
  it('answer pending and error are scoped to the question being answered', async () => {
    const q2 = {
      ...question,
      id: 'q2',
      text: 'Which cache?',
      options: ['redis'],
      recommendation: null,
    };
    let reject!: (e: Error) => void;
    m(api.answer).mockReturnValue(new Promise((_, r) => (reject = r)));
    view(
      makeTask({
        state: 'waiting',
        section: 'needs-you',
        questions: [question, q2],
      }),
    );
    fireEvent.click(screen.getByText(/pg/));
    await waitFor(() => expect((screen.getByText('redis') as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByText(/pg/) as HTMLButtonElement).disabled).toBe(true);
    reject(new ApiError(409, 'no open question'));
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
  });
  it('reports the task returned by an action', async () => {
    const t = idle({ closed: true, section: 'done' });
    m(api.close).mockResolvedValue(t);
    const onTask = jest.fn();
    render(<TaskView task={idle()} onDeleted={jest.fn()} onTask={onTask} />);
    fireEvent.click(screen.getByText('Close task'));
    await waitFor(() => expect(onTask).toHaveBeenCalledWith(t));
  });
  it('toggles the full run', () => {
    view(idle());
    expect(screen.queryByTestId('full-run')).toBeNull();
    fireEvent.click(screen.getByText('View full run ▸'));
    expect(screen.getByTestId('full-run')).toBeTruthy();
  });
  it('shows placeholder without a task', () => {
    render(<TaskView task={null} onDeleted={jest.fn()} />);
    expect(screen.getByText('Select a task')).toBeTruthy();
  });
});

describe('FactsPanel', () => {
  it('lists the facts', () => {
    render(<FactsPanel task={idle({ model: 'opus' })} />);
    for (const k of ['State', 'Repository', 'Branch', 'Task id', 'Model', 'Started', 'Last activity'])
      expect(screen.getByText(k)).toBeTruthy();
    expect(screen.getByText('agentic/T-1')).toBeTruthy();
    expect(screen.getByText('opus')).toBeTruthy();
  });

  it('shows the cost, or a dash without one', () => {
    const { unmount } = render(<FactsPanel task={idle()} />);
    expect(screen.getByText('Cost').nextElementSibling?.textContent).toBe('—');
    unmount();
    const cost = { input: 1500, output: 20, cacheRead: 0, cacheWrite: 0, usd: { estimate: 1.84 }, sessions: 1, snapshotAt: 'x', readAt: 'y' };
    render(<FactsPanel task={idle({ cost })} />);
    expect(screen.getByText('$1.84 (estimate)')).toBeTruthy();
    expect(screen.getByText('in 1.5k · out 20 · cache 0 read / 0 write')).toBeTruthy();
  });
});

describe('NewTaskDialog', () => {
  const repos = [
    { name: 'a', url: 'u', default: false },
    { name: 'b', url: 'u', default: true },
  ];
  it('focuses the first field, defaults repository, starts and reports the task', async () => {
    const t = makeTask({ id: 'T-new' });
    m(api.startTask).mockResolvedValue(t);
    const onStarted = jest.fn();
    render(<NewTaskDialog repositories={repos} onClose={jest.fn()} onStarted={onStarted} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    expect((screen.getByLabelText('Repository') as HTMLSelectElement).value).toBe('b');
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'go' },
    });
    fireEvent.click(screen.getByText('Start task'));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(t));
    expect(api.startTask).toHaveBeenCalledWith({
      prompt: 'go',
      repository: 'b',
    });
  });
  it('defaults the repository to the active filter when set', () => {
    render(<NewTaskDialog repositories={repos} defaultRepository="a" onClose={jest.fn()} onStarted={jest.fn()} />);
    expect((screen.getByLabelText('Repository') as HTMLSelectElement).value).toBe('a');
  });
  it('shows the 409 error and stays open; Escape closes', async () => {
    m(api.startTask).mockRejectedValue(new ApiError(409, 'max running'));
    const onClose = jest.fn();
    const onStarted = jest.fn();
    render(<NewTaskDialog repositories={repos} onClose={onClose} onStarted={onStarted} />);
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'go' },
    });
    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByLabelText('Model (optional)'), {
      target: { value: 'opus' },
    });
    fireEvent.click(screen.getByText('Start task'));
    expect((await screen.findByRole('alert')).textContent).toBe('max running');
    expect(api.startTask).toHaveBeenCalledWith({
      prompt: 'go',
      repository: 'a',
      model: 'opus',
    });
    expect(onStarted).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('Escape closes from anywhere (document) and focus returns to the opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = jest.fn();
    const { unmount } = render(<NewTaskDialog repositories={repos} onClose={onClose} onStarted={jest.fn()} />);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('TaskView full run', () => {
  it('opens the stream only while the run is shown and closes it when hidden', () => {
    view();
    expect(FakeEventSource.instances).toHaveLength(0);
    fireEvent.click(screen.getByText('View full run ▸'));
    expect(FakeEventSource.instances).toHaveLength(1);
    fireEvent.click(screen.getByText('Hide full run ▾'));
    expect(FakeEventSource.last.closed).toBe(true);
  });
});
