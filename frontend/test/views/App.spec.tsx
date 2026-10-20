import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/App';
import * as backlogApi from '../../src/api/backlog-api';
import * as backlogStream from '../../src/api/backlog-stream';
import * as repositoriesApi from '../../src/api/repositories-api';
import * as systemApi from '../../src/api/system-api';
import * as tasksApi from '../../src/api/tasks-api';
import * as statusStream from '../../src/api/task-status-stream';
import * as workflowsApi from '../../src/api/workflows-api';
import * as runsStream from '../../src/api/workflow-runs-stream';
import { makeTask } from '../fixtures/tasks';
import { makeRun, makeWorkflow } from '../fixtures/workflows';

jest.mock('../../src/api/backlog-api');
jest.mock('../../src/api/backlog-stream');
jest.mock('../../src/api/repositories-api');
jest.mock('../../src/api/system-api');
jest.mock('../../src/api/tasks-api');
jest.mock('../../src/api/task-status-stream');
jest.mock('../../src/api/workflows-api');
jest.mock('../../src/api/workflow-runs-stream');
const m = (f: unknown) => f as jest.Mock;

const item = {
  id: '7',
  title: 'Fix it',
  description: '',
  lane: 'plan',
  assignees: [],
  url: 'https://x/7',
  fileLinks: [],
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.resetAllMocks();
  m(repositoriesApi.listRepositories).mockResolvedValue([]);
  m(systemApi.fetchSystemInfo).mockReturnValue(new Promise(() => undefined));
  m(tasksApi.listTasks).mockResolvedValue([makeTask()]);
  m(tasksApi.getTask).mockResolvedValue(makeTask());
  m(statusStream.openTaskStatusStream).mockReturnValue(() => undefined);
  m(backlogApi.getLanes).mockResolvedValue({ me: 'me', lanes: [{ id: 'plan', title: 'Plan' }, { id: 'doing', title: 'Doing' }] });
  m(backlogApi.getItems).mockResolvedValue([item]);
  m(backlogStream.openBacklogStream).mockReturnValue(() => undefined);
  m(runsStream.openWorkflowRunsStream).mockReturnValue(() => undefined);
  m(workflowsApi.listRuns).mockResolvedValue([makeRun({ state: 'done' })]);
});

describe('App workflows wiring', () => {
  it('workflows off: no workflow controls on the board, no runs requested', async () => {
    window.location.hash = '#/backlog';
    m(workflowsApi.listWorkflows).mockResolvedValue(null);
    render(<App />);
    await screen.findByTestId('backlog-card-7');
    expect(screen.queryByRole('button', { name: 'Start workflow on #7' })).toBeNull();
    expect(workflowsApi.listRuns).not.toHaveBeenCalled();
    expect(runsStream.openWorkflowRunsStream).not.toHaveBeenCalled();
  });

  it('workflows on: the card offers a workflow and shows its run', async () => {
    window.location.hash = '#/backlog?item=7';
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [makeWorkflow()], refused: [], writable: true });
    render(<App />);
    const card = await screen.findByTestId('backlog-card-7');
    await waitFor(() => expect(within(card).getByTestId('workflow-run-line')).toBeTruthy());
    expect(within(card).getByRole('button', { name: 'Start workflow on #7' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Item detail' })).toBeTruthy();
  });

  it('task view shows the run line of the selected task', async () => {
    window.location.hash = '#/tasks/T-1';
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [makeWorkflow()], refused: [], writable: true });
    render(<App />);
    expect((await screen.findByTestId('task-workflow-line')).textContent).toContain('step Plan');
  });
});

describe('App workflows not loaded', () => {
  it('refuses a drag while it is not yet known whether workflows are on', async () => {
    window.location.hash = '#/backlog';
    m(workflowsApi.listWorkflows).mockReturnValue(new Promise(() => undefined));
    render(<App />);
    const card = await screen.findByTestId('backlog-card-7');
    const data: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('region', { name: 'Doing' }), { dataTransfer: dt });
    expect(backlogApi.moveItem).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Workflow state is not loaded yet');
    expect(screen.queryByRole('button', { name: 'Start workflow on #7' })).toBeNull();
  });

  it.each([
    ['while runs load', () => new Promise(() => undefined)],
    ['when runs fail to load', () => Promise.reject(new Error('runs down'))],
  ])('refuses a drag %s', async (_, runs) => {
    window.location.hash = '#/backlog';
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [makeWorkflow()], refused: [], writable: true });
    m(workflowsApi.listRuns).mockImplementation(runs);
    render(<App />);
    const card = await screen.findByTestId('backlog-card-7');
    await waitFor(() => expect(workflowsApi.listRuns).toHaveBeenCalled());
    await act(async () => undefined);
    const data: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('region', { name: 'Doing' }), { dataTransfer: dt });
    expect(backlogApi.moveItem).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Workflow state is not loaded yet');
  });
});

describe('App workflows screen', () => {
  const def = { id: 'wf', title: 'My flow', doneStage: 'plan', steps: [{ id: 's', title: 'S', gate: 'human' as const, sessions: ['main'] }] };

  it('workflows off: no Workflows entry', async () => {
    window.location.hash = '#/backlog';
    m(workflowsApi.listWorkflows).mockResolvedValue(null);
    render(<App />);
    await screen.findByTestId('backlog-card-7');
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
  });

  it('workflows on: the entry shows the list, New workflow opens the editor, Cancel returns', async () => {
    window.location.hash = '#/backlog';
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [def], refused: [], writable: true });
    m(workflowsApi.validateWorkflow).mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }));
    expect((await screen.findByTestId('workflow-row-wf')).textContent).toContain('My flow');
    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
    await screen.findByLabelText('Workflow title');
    expect(window.location.hash).toBe('#/workflows/new');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByTestId('workflow-row-wf');
    expect(window.location.hash).toBe('#/workflows');
  });
});
