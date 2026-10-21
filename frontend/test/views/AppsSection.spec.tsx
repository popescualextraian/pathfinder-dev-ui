import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppsSection } from '../../src/views/AppsSection';
import { TaskView } from '../../src/views/TaskView';
import * as api from '../../src/api/tasks-api';
import { ApiError } from '../../src/api/http';
import type { TaskApp } from '../../src/api/models';
import { makeTask } from '../fixtures/tasks';
import { FakeEventSource } from '../api/fake-event-source';

jest.mock('../../src/api/tasks-api');
const m = (f: unknown) => f as jest.Mock;

const app = (over: Partial<TaskApp> = {}): TaskApp => ({
  name: 'web',
  state: 'running',
  ports: [3000],
  url: '/',
  link: 'http://localhost:49153/',
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  FakeEventSource.install();
});

describe('AppsSection', () => {
  it('renders nothing for a task without apps', async () => {
    m(api.listApps).mockResolvedValue([]);
    const { container } = render(<AppsSection taskId="T-1" taskState="running" />);
    await waitFor(() => expect(api.listApps).toHaveBeenCalledWith('T-1'));
    expect(container.textContent).toBe('');
  });

  it('shows a running app: state, safe link, Logs, Restart, Stop', async () => {
    m(api.listApps).mockResolvedValue([app()]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('web')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.textContent).toBe('localhost:49153');
    expect(link.getAttribute('href')).toBe('http://localhost:49153/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(screen.getByText('Logs')).toBeTruthy();
    expect(screen.getByText('Restart')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Start')).toBeNull();
  });

  it('shows a stopped app with Start and no link text when there is no link', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'stopped', link: null })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('Start')).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows a failed app with its exit code', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'failed', exit_code: 2 })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('failed')).toBeTruthy();
    expect(screen.getByText(/exit code 2/)).toBeTruthy();
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('start is busy while it runs, then the app is updated', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'stopped', link: null })]);
    let resolve!: (a: TaskApp) => void;
    m(api.startApp).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AppsSection taskId="T-1" taskState="running" />);
    fireEvent.click(await screen.findByText('Start'));
    expect(api.startApp).toHaveBeenCalledWith('T-1', 'web');
    await waitFor(() => expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true));
    await act(async () => resolve(app()));
    expect(await screen.findByText('Stop')).toBeTruthy();
  });

  it('stop and restart call the API', async () => {
    m(api.listApps).mockResolvedValue([app()]);
    m(api.stopApp).mockResolvedValue(app({ state: 'stopped' }));
    m(api.restartApp).mockResolvedValue(app());
    render(<AppsSection taskId="T-1" taskState="running" />);
    fireEvent.click(await screen.findByText('Restart'));
    await waitFor(() => expect(api.restartApp).toHaveBeenCalledWith('T-1', 'web'));
    fireEvent.click(await screen.findByText('Stop'));
    await waitFor(() => expect(api.stopApp).toHaveBeenCalledWith('T-1', 'web'));
  });

  it('an action error shows as an alert', async () => {
    m(api.listApps).mockResolvedValue([app()]);
    m(api.stopApp).mockRejectedValue(new ApiError(409, 'Task T-1 is not running'));
    render(<AppsSection taskId="T-1" taskState="running" />);
    fireEvent.click(await screen.findByText('Stop'));
    expect((await screen.findByRole('alert')).textContent).toBe('Task T-1 is not running');
  });

  it('Logs shows the lines as text in a monospaced block, and hides again', async () => {
    m(api.listApps).mockResolvedValue([app()]);
    m(api.appLogs).mockResolvedValue({ lines: ['listening', 'GET / 200'] });
    render(<AppsSection taskId="T-1" taskState="running" />);
    fireEvent.click(await screen.findByText('Logs'));
    const pre = await screen.findByText(/listening/);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('listening\nGET / 200');
    expect(api.appLogs).toHaveBeenCalledWith('T-1', 'web', 200);
    fireEvent.click(screen.getByText('Logs'));
    expect(screen.queryByText(/listening/)).toBeNull();
  });

  it('an app event refreshes the list', async () => {
    m(api.listApps).mockResolvedValueOnce([app()]).mockResolvedValue([app({ state: 'failed', exit_code: 1 })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    await screen.findByText('running');
    expect(FakeEventSource.last.url).toContain('/api/tasks/T-1/events/stream');
    act(() => {
      FakeEventSource.last.emit('message', { seq: 1, type: 'message', data: {} });
    });
    expect(api.listApps).toHaveBeenCalledTimes(1);
    act(() => {
      FakeEventSource.last.emit('message', { seq: 2, type: 'app', data: { name: 'web', state: 'failed' } });
    });
    expect(await screen.findByText('failed')).toBeTruthy();
  });

  it('the local launcher message shows, other 409s stay quiet, other errors alert', async () => {
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Apps need the Docker launcher'));
    const { unmount } = render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('Apps need the Docker launcher')).toBeTruthy();
    unmount();
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Task T-1 is not running; its apps are not available'));
    const quiet = render(<AppsSection taskId="T-1" taskState="suspended" />);
    await waitFor(() => expect(api.listApps).toHaveBeenCalledTimes(2));
    expect(quiet.container.textContent).toBe('');
    quiet.unmount();
    m(api.listApps).mockRejectedValue(new ApiError(502, 'bridge down'));
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect((await screen.findByRole('alert')).textContent).toBe('bridge down');
  });

  it('TaskView includes the section', async () => {
    m(api.listApps).mockResolvedValue([app()]);
    render(<TaskView task={makeTask()} onDeleted={jest.fn()} />);
    expect(await screen.findByText('web')).toBeTruthy();
  });
});

describe('AppsSection: preparing, exited, errors that stay, a suspended task', () => {
  const pill = (text: string) => screen.getByText(text).closest('[data-section]')?.getAttribute('data-section');

  it('an exited app shows like a failed one: needs-you, its exit code, Start', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'exited', exit_code: 3, since: 1792490400 })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('exited')).toBeTruthy();
    expect(pill('exited')).toBe('needs-you');
    expect(screen.getByText(/exit code 3/)).toBeTruthy();
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
  });

  it('a failed app shows needs-you; a null exit code shows none', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'failed', exit_code: null })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('failed')).toBeTruthy();
    expect(pill('failed')).toBe('needs-you');
    expect(screen.queryByText(/exit code/)).toBeNull();
  });

  it('a preparing app shows working, "preparing…" and Logs, but no Start, Restart or Stop', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'preparing', link: null })]);
    render(<AppsSection taskId="T-1" taskState="running" />);
    expect(await screen.findByText('preparing')).toBeTruthy();
    expect(pill('preparing')).toBe('working');
    expect(screen.getByText('preparing…')).toBeTruthy();
    expect(screen.getByText('Logs')).toBeTruthy();
    for (const label of ['Start', 'Restart', 'Stop']) expect(screen.queryByText(label)).toBeNull();
  });

  it('a failed action keeps its message through a refresh, until the next action', async () => {
    m(api.listApps).mockResolvedValue([app({ state: 'stopped', link: null })]);
    m(api.startApp).mockRejectedValueOnce(new ApiError(502, 'agentic-app: prepare of web failed (exit 1)'));
    render(<AppsSection taskId="T-1" taskState="running" />);
    fireEvent.click(await screen.findByText('Start'));
    expect((await screen.findByRole('alert')).textContent).toBe('agentic-app: prepare of web failed (exit 1)');
    act(() => {
      FakeEventSource.last.emit('message', { seq: 1, type: 'app', data: { name: 'web', action: 'failed' } });
    });
    await waitFor(() => expect(api.listApps).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByRole('alert').textContent).toBe('agentic-app: prepare of web failed (exit 1)');
    m(api.startApp).mockResolvedValue(app());
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a suspended task (409 not running) shows its app names from the record with Start, which wakes it', async () => {
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Task T-1 is not running; its apps are not available'));
    m(api.startApp).mockResolvedValue(app());
    render(<AppsSection taskId="T-1" taskState="suspended" appNames={['web', 'api']} />);
    expect(await screen.findByText('Task is suspended — Start wakes it')).toBeTruthy();
    expect(screen.getByText('web')).toBeTruthy();
    expect(screen.getByText('api')).toBeTruthy();
    const starts = screen.getAllByText('Start');
    expect(starts).toHaveLength(2);
    expect(screen.queryByText('Logs')).toBeNull();
    fireEvent.click(starts[0]);
    await waitFor(() => expect(api.startApp).toHaveBeenCalledWith('T-1', 'web'));
    expect(await screen.findByText('Stop')).toBeTruthy();
  });

  it('a suspended task without app names in its record shows nothing; a stopped task shows nothing', async () => {
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Task T-1 is not running; its apps are not available'));
    const none = render(<AppsSection taskId="T-1" taskState="suspended" appNames={[]} />);
    await waitFor(() => expect(api.listApps).toHaveBeenCalledTimes(1));
    expect(none.container.textContent).toBe('');
    none.unmount();
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Task T-1 is stopped; its apps are not available'));
    const stopped = render(<AppsSection taskId="T-1" taskState="stopped" appNames={['web']} />);
    await waitFor(() => expect(api.listApps).toHaveBeenCalledTimes(2));
    expect(stopped.container.textContent).toBe('');
  });

  it('TaskView passes the app names of the task', async () => {
    m(api.listApps).mockRejectedValue(new ApiError(409, 'Task T-1 is not running; its apps are not available'));
    render(<TaskView task={makeTask({ state: 'suspended', appNames: ['web'] })} onDeleted={jest.fn()} />);
    expect(await screen.findByText('Task is suspended — Start wakes it')).toBeTruthy();
  });
});
