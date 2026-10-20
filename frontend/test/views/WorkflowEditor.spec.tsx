import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkflowEditorPage } from '../../src/WorkflowEditorPage';
import * as api from '../../src/api/workflows-api';
import { ApiError } from '../../src/api/http';
import type { WorkflowDefinition } from '../../src/api/models';

jest.mock('../../src/api/workflows-api');
const m = (f: unknown) => f as jest.Mock;

const lanes = [
  { id: 'plan', title: 'Plan' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

const stored: WorkflowDefinition = {
  title: 'Two steps',
  doneStage: 'done',
  steps: [
    { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', sessions: [{ name: 'main', prompt: 'plan it' }] },
    {
      id: 'build',
      title: 'Build',
      gate: 'auto',
      requires: ['PLAN.md'],
      sessions: [
        { name: 'impl', prompt: 'build it', fork: 'main', model: 'opus' },
        { name: 'rev', prompt: 'review it' },
      ],
    },
  ],
};

const renderEditor = (props: Partial<Parameters<typeof WorkflowEditorPage>[0]> = {}) => {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(<WorkflowEditorPage workflow="two" from={null} lanes={lanes} writable onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
};

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  jest.resetAllMocks();
  m(api.readWorkflow).mockResolvedValue({ definition: { id: 'two', ...stored }, version: 'v1' });
  m(api.validateWorkflow).mockResolvedValue([]);
  m(api.createWorkflow).mockImplementation(async (id: string, definition: WorkflowDefinition) => ({
    definition: { id, ...definition },
    version: 'v1',
  }));
  m(api.updateWorkflow).mockImplementation(async (id: string, definition: WorkflowDefinition) => ({
    definition: { id, ...definition },
    version: 'v2',
  }));
});

describe('WorkflowEditor', () => {
  it('creates a two-step workflow and saves it', async () => {
    const { onSaved } = renderEditor({ workflow: 'new' });
    type('Workflow title', 'My flow');
    expect(screen.getByLabelText('Workflow id')).toHaveValue('my-flow');
    type('Step title', 'Plan');
    type('Session 1 prompt', 'plan {{item.title}}');
    type('When this step starts, move the item to', 'plan');
    fireEvent.click(screen.getByRole('button', { name: '+ step' }));
    type('Step title', 'Build');
    type('Session 1 prompt', 'build it');
    type('Session 1 starts as a copy of', 'main');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('my-flow'));
    expect(api.createWorkflow).toHaveBeenCalledWith('my-flow', {
      title: 'My flow',
      steps: [
        { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', sessions: [{ name: 'main', prompt: 'plan {{item.title}}' }] },
        { id: 'build', title: 'Build', gate: 'human', sessions: [{ name: 'session-1', prompt: 'build it', fork: 'main' }] },
      ],
    });
  });

  it('edits a prompt and saves with the version; the id is fixed', async () => {
    const { onSaved } = renderEditor();
    await screen.findByDisplayValue('Two steps');
    expect(screen.getByLabelText('Workflow id')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type('Session 1 prompt', 'plan better');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('two'));
    const [id, def, version] = m(api.updateWorkflow).mock.calls[0];
    expect([id, version]).toEqual(['two', 'v1']);
    expect(def.steps[0].sessions[0].prompt).toBe('plan better');
  });

  it('inserts a placeholder at the cursor', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    const area = screen.getByLabelText('Session 1 prompt') as HTMLTextAreaElement;
    area.setSelectionRange(4, 4);
    fireEvent.click(within(screen.getByRole('group', { name: 'Placeholders for Session 1 prompt' })).getByText('{{item.url}}'));
    expect(area.value).toBe('plan{{item.url}} it');
  });

  it('toggles the gate by clicking the arrow', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    const gate = screen.getByRole('button', { name: /Gate after step 1/ });
    expect(gate).toHaveTextContent('✋');
    fireEvent.click(gate);
    expect(screen.getByRole('button', { name: /Gate after step 1: automatic/ })).toHaveTextContent('⚡');
    expect(screen.getByLabelText('Gate')).toHaveValue('auto');
  });

  it('cannot move the first step or into its place; deletes a step after a confirm', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    const boxes = () => screen.getAllByTestId(/^step-box-/).map((b) => b.getAttribute('aria-label'));
    const before = boxes();
    expect(screen.getByRole('button', { name: 'Move step left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step right' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('step-box-2'));
    expect(screen.getByRole('button', { name: 'Move step left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step right' })).toBeDisabled();
    expect(boxes()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }));
    expect(boxes()).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete step' }));
    expect(boxes()).toEqual(['Step 1: Plan']);
  });

  it('a step without a lane shows no move and saves without stage', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    expect(within(screen.getByTestId('step-box-2')).getByText('no lane move')).toBeInTheDocument();
    expect(within(screen.getByTestId('step-box-1')).getByText('→ Plan')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step-box-1'));
    type('When this step starts, move the item to', '');
    expect(within(screen.getByTestId('step-box-1')).getByText('no lane move')).toBeInTheDocument();
    const stage = screen.getByLabelText('When this step starts, move the item to') as HTMLSelectElement;
    expect(stage.options[0].textContent).toBe("— don't move —");
  });

  it('offers only earlier sessions to fork from', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByTestId('step-box-2'));
    const options = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options('Session 1 starts as a copy of')).toEqual(['— fresh session —', 'main']);
    expect(options('Session 2 starts as a copy of')).toEqual(['— fresh session —', 'main', 'impl']);
    expect(screen.getByLabelText('Session 1 starts as a copy of')).toHaveValue('main');
    expect(within(screen.getByTestId('step-box-2')).getAllByText(/⑂ fork/)).toHaveLength(1);
    expect(within(screen.getByTestId('step-box-2')).getByText(/requires files/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step-box-1'));
    expect(screen.getByLabelText('Session 1 name')).toBeDisabled();
    expect(Array.from((screen.getByLabelText('Session 1 starts as a copy of') as HTMLSelectElement).options)).toHaveLength(1);
  });

  it('marks the step and the field of a validation error and blocks Save', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'steps[1].sessions[0].prompt must be a non-empty string', stepId: 'build', session: 'impl', field: 'prompt' }]);
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByTestId('step-box-2'));
    type('Session 1 prompt', '');
    expect(await screen.findByTestId('validation-error')).toHaveTextContent('must be a non-empty string');
    expect(screen.getByTestId('step-box-2')).toHaveAttribute('data-error', 'true');
    expect(screen.getByTestId('step-box-1')).not.toHaveAttribute('data-error');
    expect(screen.getByLabelText('Session 1 prompt')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Session 2 prompt')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('gives prompts at least 6 rows and the exit prompt 3', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    expect(Number(screen.getByLabelText('Session 1 prompt').getAttribute('rows'))).toBeGreaterThanOrEqual(6);
    expect(Number(screen.getByLabelText('Exit prompt').getAttribute('rows'))).toBeGreaterThanOrEqual(3);
  });

  it('does not allow deleting the first step', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByTestId('step-box-1'));
    expect(screen.getByRole('button', { name: 'Delete step' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('step-box-2'));
    expect(screen.getByRole('button', { name: 'Delete step' })).toBeEnabled();
  });

  it('marks the end box for an error on doneStage', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'doneStage "x" is not a stage of the work items', field: 'doneStage' }]);
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    type('Session 1 prompt', 'changed');
    await screen.findByTestId('validation-error');
    expect(screen.getByTestId('end-box')).toHaveAttribute('data-error', 'true');
    expect(screen.getByTestId('step-box-1')).not.toHaveAttribute('data-error');
  });

  it('marks a step and session located by index when the id or name is empty', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'steps[1].sessions[1].name must be a non-empty string', stepIndex: 1, sessionIndex: 1, field: 'name' }]);
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByTestId('step-box-2'));
    type('Session 2 prompt', 'changed');
    await screen.findByTestId('validation-error');
    expect(screen.getByTestId('step-box-2')).toHaveAttribute('data-error', 'true');
    expect(screen.getByTestId('step-box-1')).not.toHaveAttribute('data-error');
    expect(screen.getByLabelText('Session 2 name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Session 1 name')).not.toHaveAttribute('aria-invalid');
  });

  it('shows a 409 conflict with reload and keep-mine', async () => {
    m(api.updateWorkflow).mockRejectedValueOnce(new ApiError(409, 'workflow changed'));
    const { onSaved } = renderEditor();
    await screen.findByDisplayValue('Two steps');
    type('Session 1 prompt', 'mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('conflict')).toHaveTextContent('changed by someone else');
    m(api.readWorkflow).mockResolvedValue({ definition: { id: 'two', ...stored }, version: 'v9' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine (overwrite)' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('two'));
    expect(m(api.updateWorkflow).mock.calls[1][2]).toBe('v9');
  });

  it('reloads their version on conflict', async () => {
    m(api.updateWorkflow).mockRejectedValueOnce(new ApiError(409, 'workflow changed'));
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    type('Session 1 prompt', 'mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByTestId('conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Reload their version' }));
    await waitFor(() => expect(screen.queryByTestId('conflict')).toBeNull());
    expect(screen.getByLabelText('Session 1 prompt')).toHaveValue('plan it');
  });

  it('is read-only when the folder is: no edits, no Save, no step actions', async () => {
    renderEditor({ writable: false });
    await screen.findByDisplayValue('Two steps');
    expect(screen.getByRole('status')).toHaveTextContent('read-only');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ step' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete step' })).toBeNull();
    expect(screen.getByLabelText('Workflow title')).toBeDisabled();
    expect(screen.getByLabelText('Session 1 prompt')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Gate after step 1/ })).toBeDisabled();
  });

  it('asks before cancelling a dirty draft and not otherwise', async () => {
    const { onClose } = renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    type('Session 1 prompt', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('edits the end lane in the inspector when no step is selected', async () => {
    renderEditor();
    await screen.findByDisplayValue('Two steps');
    fireEvent.click(screen.getByTestId('end-box'));
    expect(screen.getByTestId('end-box')).toHaveTextContent('when done → Done');
    type('When the workflow ends, move the item to', '');
    expect(screen.getByTestId('end-box')).toHaveTextContent("when done → don't move");
  });

  it('copies a workflow for Duplicate', async () => {
    renderEditor({ workflow: 'new', from: 'two' });
    await screen.findByDisplayValue('Two steps (copy)');
    await waitFor(() => expect(screen.getByLabelText('Workflow id')).toHaveValue('two-steps-copy'));
    expect(screen.getByLabelText('Workflow id')).not.toBeDisabled();
  });
});
