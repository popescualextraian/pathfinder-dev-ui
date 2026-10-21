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
  title: 'Three steps',
  doneStage: 'done',
  steps: [
    { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', prompt: 'plan it\nsecond line', model: 'opus' },
    { id: 'build', title: 'Build', gate: 'auto', requires: ['PLAN.md'], prompt: 'build it', continue: 'plan', exitPrompt: 'commit' },
    { id: 'review', title: 'Review', gate: 'human', prompt: 'review it', fork: 'build', model: 'haiku' },
  ],
};

const renderEditor = (props: Partial<Parameters<typeof WorkflowEditorPage>[0]> = {}) => {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(<WorkflowEditorPage workflow="three" from={null} lanes={lanes} writable onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
};
const loaded = async (props: Partial<Parameters<typeof WorkflowEditorPage>[0]> = {}) => {
  const r = renderEditor(props);
  await screen.findByDisplayValue('Three steps');
  return r;
};

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const box = (n: number) => screen.getByTestId(`step-box-${n}`);
const select = (n: number) => fireEvent.click(box(n));
const options = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);
const chip = (name: string) => within(screen.getByRole('group', { name: 'Insert placeholder' })).getByRole('button', { name: `{{${name}}}` });

beforeEach(() => {
  jest.resetAllMocks();
  window.location.hash = '';
  m(api.readWorkflow).mockResolvedValue({ definition: { id: 'three', ...stored }, version: 'v1' });
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

describe('WorkflowEditor: creating', () => {
  it('creates a workflow with continue and copy without ever typing a step id', async () => {
    const { onSaved } = renderEditor({ workflow: 'new' });
    type('Workflow title', 'My flow');
    expect(screen.getByLabelText('Workflow id')).toHaveValue('my-flow');
    type('Step title', 'Write the plan');
    type('Prompt', 'plan {{item.title}}');
    type('When this step starts, move the item to', 'plan');
    fireEvent.click(screen.getByRole('button', { name: '+ step' }));
    type('Step title', 'Build');
    type('Prompt', 'build it');
    type('Conversation', 'continue:write-the-plan');
    fireEvent.click(screen.getByRole('button', { name: '+ step' }));
    type('Step title', 'Review');
    type('Prompt', 'review it');
    type('Conversation', 'fork:build');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('my-flow'));
    expect(api.createWorkflow).toHaveBeenCalledWith('my-flow', {
      title: 'My flow',
      steps: [
        { id: 'write-the-plan', title: 'Write the plan', stage: 'plan', gate: 'human', prompt: 'plan {{item.title}}' },
        { id: 'build', title: 'Build', gate: 'human', prompt: 'build it', continue: 'write-the-plan' },
        { id: 'review', title: 'Review', gate: 'human', prompt: 'review it', fork: 'build' },
      ],
    });
  });

  it('never shows a step id or a session name', async () => {
    await loaded();
    for (const n of [1, 2, 3]) {
      select(n);
      expect(screen.queryByLabelText(/step id/i)).toBeNull();
      expect(screen.queryByText(/session/i)).toBeNull();
    }
    expect(screen.queryByText('build')).toBeNull();
  });
});

describe('WorkflowEditor: conversation', () => {
  it('the first step has no Conversation field', async () => {
    await loaded();
    select(1);
    expect(screen.queryByLabelText('Conversation')).toBeNull();
    select(2);
    expect(screen.getByLabelText('Conversation')).toBeInTheDocument();
  });

  it('lists only earlier steps, by title', async () => {
    await loaded();
    select(2);
    expect(options('Conversation')).toEqual(['New conversation', 'Continue: Plan', 'Copy of: Plan']);
    expect(screen.getByLabelText('Conversation')).toHaveValue('continue:plan');
    select(3);
    expect(options('Conversation')).toEqual([
      'New conversation', 'Continue: Plan', 'Continue: Build', 'Copy of: Plan', 'Copy of: Build',
    ]);
    expect(screen.getByLabelText('Conversation')).toHaveValue('fork:build');
  });

  it('renaming a step renames the reference of the step continuing it, which still shows it', async () => {
    await loaded();
    select(1);
    type('Step title', 'Design');
    expect(within(box(2)).getByText('↩ continues Design')).toBeInTheDocument();
    select(2);
    expect(screen.getByLabelText('Conversation')).toHaveValue('continue:design');
    expect(options('Conversation')).toContain('Continue: Design');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateWorkflow).toHaveBeenCalled());
    const def = m(api.updateWorkflow).mock.calls[0][1] as WorkflowDefinition;
    expect(def.steps.map((s) => [s.id, s.continue, s.fork])).toEqual([
      ['design', undefined, undefined],
      ['build', 'design', undefined],
      ['review', undefined, 'build'],
    ]);
  });

  it('the model is in Advanced, hidden on a continuing step and cleared when it starts to continue', async () => {
    await loaded();
    select(2);
    expect(screen.queryByLabelText('Model')).toBeNull();
    select(3);
    expect(screen.getByText('Advanced').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Model')).toHaveValue('haiku');
    type('Conversation', 'continue:plan');
    expect(screen.queryByLabelText('Model')).toBeNull();
    expect(within(box(3)).queryByText('haiku')).toBeNull();
    type('Conversation', '');
    expect(screen.getByLabelText('Model')).toHaveValue('');
  });
});

describe('WorkflowEditor: inspector', () => {
  it('groups the fields: title and lane, Start, End, Advanced', async () => {
    await loaded();
    select(2);
    const start = screen.getByRole('group', { name: 'Start' });
    expect(within(start).getByLabelText('Required file 1')).toHaveValue('PLAN.md');
    expect(within(start).getByLabelText('Conversation')).toBeInTheDocument();
    expect(within(start).getByLabelText('Prompt')).toHaveValue('build it');
    const end = screen.getByRole('group', { name: 'End' });
    expect(within(end).getByLabelText('Exit prompt')).toHaveValue('commit');
    expect(options('Then')).toEqual(['wait for my approval ✋', 'go on automatically ⚡']);
    expect(screen.getByLabelText('Then')).toHaveValue('auto');
  });

  it('toggles the gate by clicking the arrow, and the inspector follows', async () => {
    await loaded();
    const gate = screen.getByRole('button', { name: /Gate after step 1/ });
    expect(gate).toHaveTextContent('✋');
    fireEvent.click(gate);
    expect(screen.getByRole('button', { name: /Gate after step 1: automatic/ })).toHaveTextContent('⚡');
    expect(screen.getByLabelText('Then')).toHaveValue('auto');
  });

  it('gives the prompt at least 6 rows and the exit prompt 3', async () => {
    await loaded();
    expect(Number(screen.getByLabelText('Prompt').getAttribute('rows'))).toBeGreaterThanOrEqual(6);
    expect(Number(screen.getByLabelText('Exit prompt').getAttribute('rows'))).toBeGreaterThanOrEqual(3);
  });
});

describe('WorkflowEditor: placeholder chips', () => {
  it('has one chip row that inserts at the cursor of the prompt by default', async () => {
    await loaded();
    select(2);
    expect(screen.getAllByRole('group', { name: 'Insert placeholder' })).toHaveLength(1);
    const area = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    area.setSelectionRange(5, 5);
    fireEvent.click(chip('item.url'));
    expect(area.value).toBe('build{{item.url}} it');
  });

  it('inserts into the last focused field: exit prompt, required file', async () => {
    await loaded();
    select(2);
    const exit = screen.getByLabelText('Exit prompt') as HTMLTextAreaElement;
    fireEvent.focus(exit);
    exit.setSelectionRange(0, 0);
    fireEvent.click(chip('item.id'));
    expect(exit.value).toBe('{{item.id}}commit');
    const file = screen.getByLabelText('Required file 1') as HTMLInputElement;
    fireEvent.focus(file);
    file.setSelectionRange(4, 4);
    fireEvent.click(chip('task.branch'));
    expect(file.value).toBe('PLAN{{task.branch}}.md');
    expect(screen.getByLabelText('Prompt')).toHaveValue('build it');
  });

  it('replaces the selection', async () => {
    await loaded();
    select(2);
    const area = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    fireEvent.focus(area);
    area.setSelectionRange(0, 5);
    fireEvent.click(chip('item.title'));
    expect(area.value).toBe('{{item.title}} it');
  });

  it('task chips are disabled for the first step prompt only', async () => {
    await loaded();
    select(1);
    fireEvent.focus(screen.getByLabelText('Prompt'));
    expect(chip('task.id')).toBeDisabled();
    expect(chip('task.branch')).toBeDisabled();
    expect(chip('item.id')).toBeEnabled();
    fireEvent.focus(screen.getByLabelText('Exit prompt'));
    expect(chip('task.id')).toBeEnabled();
    select(2);
    fireEvent.focus(screen.getByLabelText('Prompt'));
    expect(chip('task.id')).toBeEnabled();
  });
});

describe('WorkflowEditor: expand dialog', () => {
  it('edits the prompt in a large dialog', async () => {
    await loaded();
    select(2);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Prompt' }));
    const dialog = screen.getByRole('dialog', { name: 'Prompt' });
    const big = within(dialog).getByRole('textbox');
    expect(big).toHaveValue('build it');
    expect(big).toHaveFocus();
    fireEvent.change(big, { target: { value: 'build it well' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Prompt')).toHaveValue('build it well');
  });

  it('expands the exit prompt too; chips in the dialog insert there', async () => {
    await loaded();
    select(2);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Exit prompt' }));
    const dialog = screen.getByRole('dialog', { name: 'Exit prompt' });
    const big = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    big.setSelectionRange(6, 6);
    fireEvent.click(within(dialog).getByRole('button', { name: '{{step.id}}' }));
    expect(big.value).toBe('commit{{step.id}}');
  });
});

describe('WorkflowEditor: step boxes', () => {
  it('show title, lane, first prompt line, conversation, model and the requires mark', async () => {
    await loaded();
    expect(within(box(1)).getByText('→ Plan')).toBeInTheDocument();
    expect(within(box(1)).getByText('plan it')).toBeInTheDocument();
    expect(within(box(1)).getByText('opus')).toBeInTheDocument();
    expect(within(box(2)).getByText('no lane move')).toBeInTheDocument();
    expect(within(box(2)).getByText('↩ continues Plan')).toBeInTheDocument();
    expect(within(box(2)).getByText(/requires files/)).toBeInTheDocument();
    expect(within(box(3)).getByText('⑂ copy of Build')).toBeInTheDocument();
    expect(within(box(3)).getByText('haiku')).toBeInTheDocument();
    expect(within(box(1)).queryByText(/requires files/)).toBeNull();
  });

  it('shortens a long first line', async () => {
    await loaded();
    select(1);
    type('Prompt', `${'word '.repeat(30)}\nmore`);
    const text = within(box(1)).getByTestId('step-prompt').textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(61);
    expect(text.endsWith('…')).toBe(true);
  });

  it('a step without a lane shows no move', async () => {
    await loaded();
    select(1);
    type('When this step starts, move the item to', '');
    expect(within(box(1)).getByText('no lane move')).toBeInTheDocument();
    const stage = screen.getByLabelText('When this step starts, move the item to') as HTMLSelectElement;
    expect(stage.options[0].textContent).toBe("— don't move —");
  });
});

describe('WorkflowEditor: steps', () => {
  it('cannot move the first step or into its place; deletes a step after a confirm', async () => {
    await loaded();
    const boxes = () => screen.getAllByTestId(/^step-box-/).map((b) => b.getAttribute('aria-label'));
    expect(screen.getByRole('button', { name: 'Move step left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete step' })).toBeDisabled();
    select(2);
    expect(screen.getByRole('button', { name: 'Move step left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step right' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete step' }));
    expect(boxes()).toEqual(['Step 1: Plan', 'Step 2: Review']);
    expect(within(box(2)).queryByText(/copy of/)).toBeNull();
  });

  it('edits the end lane in the inspector when no step is selected', async () => {
    await loaded();
    fireEvent.click(screen.getByTestId('end-box'));
    expect(screen.getByTestId('end-box')).toHaveTextContent('when done → Done');
    type('When the workflow ends, move the item to', '');
    expect(screen.getByTestId('end-box')).toHaveTextContent("when done → don't move");
  });
});

describe('WorkflowEditor: errors', () => {
  it('marks the step and the field of a validation error and blocks Save', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'steps[2].prompt must be a non-empty string', stepId: 'review', field: 'prompt' }]);
    await loaded();
    select(3);
    type('Prompt', '');
    expect(await screen.findByTestId('validation-error')).toHaveTextContent('must be a non-empty string');
    expect(box(3)).toHaveAttribute('data-error', 'true');
    expect(box(1)).not.toHaveAttribute('data-error');
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Exit prompt')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('an error on the id marks the title; on continue or fork the conversation; on model opens Advanced', async () => {
    await loaded();
    select(3);
    m(api.validateWorkflow).mockResolvedValue([{ message: 'bad id', stepId: 'review', field: 'id' }]);
    type('Prompt', 'x');
    await screen.findByTestId('validation-error');
    expect(screen.getByLabelText('Step title')).toHaveAttribute('aria-invalid', 'true');
    m(api.validateWorkflow).mockResolvedValue([{ message: 'not earlier', stepId: 'review', field: 'fork' }]);
    type('Prompt', 'y');
    await waitFor(() => expect(screen.getByLabelText('Conversation')).toHaveAttribute('aria-invalid', 'true'));
    m(api.validateWorkflow).mockResolvedValue([{ message: 'bad model', stepId: 'review', field: 'model' }]);
    type('Prompt', 'z');
    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Advanced').closest('details')).toHaveAttribute('open');
  });

  it('marks a step located by index', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'steps[1].id must be a non-empty string', stepIndex: 1, field: 'id' }]);
    await loaded();
    type('Prompt', 'changed');
    await screen.findByTestId('validation-error');
    expect(box(2)).toHaveAttribute('data-error', 'true');
    expect(box(1)).not.toHaveAttribute('data-error');
  });

  it('marks the end box for an error on doneStage', async () => {
    m(api.validateWorkflow).mockResolvedValue([{ message: 'doneStage "x" is not a stage of the work items', field: 'doneStage' }]);
    await loaded();
    type('Prompt', 'changed');
    await screen.findByTestId('validation-error');
    expect(screen.getByTestId('end-box')).toHaveAttribute('data-error', 'true');
    expect(box(1)).not.toHaveAttribute('data-error');
  });
});

describe('WorkflowEditor: saving and leaving', () => {
  it('edits a prompt and saves with the version; the id is fixed', async () => {
    const { onSaved } = await loaded();
    expect(screen.getByLabelText('Workflow id')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type('Prompt', 'plan better');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('three'));
    const [id, def, version] = m(api.updateWorkflow).mock.calls[0];
    expect([id, version]).toEqual(['three', 'v1']);
    expect(def.steps[0].prompt).toBe('plan better');
  });

  it('shows a 409 conflict with reload and keep-mine', async () => {
    m(api.updateWorkflow).mockRejectedValueOnce(new ApiError(409, 'workflow changed'));
    const { onSaved } = await loaded();
    type('Prompt', 'mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('conflict')).toHaveTextContent('changed by someone else');
    m(api.readWorkflow).mockResolvedValue({ definition: { id: 'three', ...stored }, version: 'v9' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine (overwrite)' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('three'));
    expect(m(api.updateWorkflow).mock.calls[1][2]).toBe('v9');
  });

  it('reloads their version on conflict', async () => {
    m(api.updateWorkflow).mockRejectedValueOnce(new ApiError(409, 'workflow changed'));
    await loaded();
    type('Prompt', 'mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByTestId('conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Reload their version' }));
    await waitFor(() => expect(screen.queryByTestId('conflict')).toBeNull());
    expect(screen.getByLabelText('Prompt')).toHaveValue('plan it\nsecond line');
  });

  it('is read-only when the folder is: no edits, no Save, no step actions, no chips', async () => {
    await loaded({ writable: false });
    expect(screen.getByRole('status')).toHaveTextContent('read-only');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ step' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete step' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Insert placeholder' })).toBeNull();
    expect(screen.getByLabelText('Workflow title')).toBeDisabled();
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /Gate after step 1/ })).toBeDisabled();
  });

  it('asks before cancelling a dirty draft and not otherwise', async () => {
    const { onClose } = await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    type('Prompt', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('copies a workflow for Duplicate', async () => {
    renderEditor({ workflow: 'new', from: 'three' });
    await screen.findByDisplayValue('Three steps (copy)');
    await waitFor(() => expect(screen.getByLabelText('Workflow id')).toHaveValue('three-steps-copy'));
    expect(screen.getByLabelText('Workflow id')).not.toBeDisabled();
  });
});
