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
