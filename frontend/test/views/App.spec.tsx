import '@testing-library/jest-dom';
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
  m(workflowsApi.listGenerations).mockResolvedValue([]);
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
  const def = { id: 'wf', title: 'My flow', doneStage: 'plan', steps: [{ id: 's', title: 'S', gate: 'human' as const }] };

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

  const openDirtyEditor = async () => {
    window.location.hash = '#/workflows/new';
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [def], refused: [], writable: true });
    m(workflowsApi.validateWorkflow).mockResolvedValue([]);
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Workflow title'), { target: { value: 'Unsaved' } });
  };

  it('leaving the editor with unsaved changes by the sidebar asks first; Keep editing stays', async () => {
    await openDirtyEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    expect(window.location.hash).toBe('#/workflows/new');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Workflow title')).toHaveValue('Unsaved');
    expect(window.location.hash).toBe('#/workflows/new');
  });

  it('leaving by the browser (back, a link) asks too; Discard changes goes there', async () => {
    await openDirtyEditor();
    act(() => {
      window.location.hash = '#/backlog';
    });
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    expect(screen.getByLabelText('Workflow title')).toHaveValue('Unsaved');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await screen.findByTestId('backlog-card-7');
    expect(window.location.hash).toBe('#/backlog');
  });

  it('Cancel asks once and leaves', async () => {
    await openDirtyEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    await screen.findByTestId('workflow-row-wf');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/workflows');
  });
});

describe('App workflow generations', () => {
  const def = { id: 'wf', title: 'My flow', doneStage: 'plan', steps: [{ id: 's', title: 'S', gate: 'human' as const }] };
  const generation = {
    id: 'G-1', taskId: 'T-9', description: 'Plan then build', state: 'ready' as const, attempts: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
  const draft = { title: 'Generated flow', steps: [{ id: 'plan', title: 'Plan', gate: 'human', prompt: 'plan it' }] };

  beforeEach(() => {
    m(workflowsApi.validateWorkflow).mockResolvedValue([]);
    m(workflowsApi.getGeneration).mockResolvedValue({ ...generation, draft });
    m(workflowsApi.createWorkflow).mockImplementation(async (id: string, definition: object) => ({ definition: { id, ...definition }, version: 'v1' }));
    m(workflowsApi.readWorkflow).mockImplementation(async (id: string) => ({ definition: { id, ...draft }, version: 'v1' }));
  });
  const list = (writable: boolean) =>
    m(workflowsApi.listWorkflows).mockResolvedValue({ definitions: [def], refused: [], writable });

  it('writable: the list has Generate with AI and the open generations', async () => {
    window.location.hash = '#/workflows';
    list(true);
    m(workflowsApi.listGenerations).mockResolvedValue([{ ...generation, hasDraft: true }]);
    render(<App />);
    const panel = await screen.findByTestId('generation-G-1');
    expect(screen.getByRole('button', { name: 'Generate with AI' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Open in editor' })).toHaveAttribute('href', '#/workflows/new?generation=G-1');
  });

  it('read-only: no generate button and no generations are read', async () => {
    window.location.hash = '#/workflows';
    list(false);
    render(<App />);
    await screen.findByTestId('workflow-row-wf');
    expect(screen.queryByRole('button', { name: 'Generate with AI' })).toBeNull();
    expect(workflowsApi.listGenerations).not.toHaveBeenCalled();
  });

  it('opens the draft as a new workflow, saves it and marks the generation saved', async () => {
    window.location.hash = '#/workflows/new?generation=G-1';
    list(true);
    m(workflowsApi.markGenerationSaved).mockResolvedValue({ ...generation, state: 'saved' });
    render(<App />);
    expect(await screen.findByLabelText('Workflow title')).toHaveValue('Generated flow');
    expect(workflowsApi.getGeneration).toHaveBeenCalledWith('G-1');
    await waitFor(() => expect(screen.getByLabelText('Workflow id')).toHaveValue('generated-flow'));
    fireEvent.change(screen.getByLabelText('Workflow id'), { target: { value: 'gen-flow' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(window.location.hash).toBe('#/workflows/gen-flow'));
    expect(workflowsApi.createWorkflow).toHaveBeenCalledWith('gen-flow', draft);
    await waitFor(() => expect(workflowsApi.markGenerationSaved).toHaveBeenCalledWith('G-1'));
    expect(screen.queryByTestId('editor-notice')).toBeNull();
  });

  it('a failed saved-mark does not undo the save: a notice shows on the saved workflow', async () => {
    window.location.hash = '#/workflows/new?generation=G-1';
    list(true);
    m(workflowsApi.markGenerationSaved).mockRejectedValue(new Error('gone'));
    render(<App />);
    await screen.findByLabelText('Workflow title');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('editor-notice')).toHaveTextContent('could not be closed (gone)');
    expect(window.location.hash).toBe('#/workflows/generated-flow');
    expect(screen.getByLabelText('Workflow title')).toHaveValue('Generated flow');
  });

  it('the generated draft counts as unsaved: Cancel asks, then leaves without touching the generation', async () => {
    window.location.hash = '#/workflows/new?generation=G-1';
    list(true);
    render(<App />);
    await screen.findByLabelText('Workflow title');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    await screen.findByTestId('workflow-row-wf');
    expect(window.location.hash).toBe('#/workflows');
    expect(workflowsApi.markGenerationSaved).not.toHaveBeenCalled();
    expect(workflowsApi.discardGeneration).not.toHaveBeenCalled();
  });

  it('an unknown generation shows an error with a way back', async () => {
    window.location.hash = '#/workflows/new?generation=G-404';
    list(true);
    const { ApiError } = jest.requireActual('../../src/api/http');
    m(workflowsApi.getGeneration).mockRejectedValue(new ApiError(404, 'not found'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no generation G-404');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await screen.findByTestId('workflow-row-wf');
  });
});
