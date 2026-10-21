import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskCost, WorkflowGenerationSummary } from '../../src/api/models';
import { GenerationPanel } from '../../src/views/GenerationPanel';
import { WorkflowGenerations } from '../../src/views/WorkflowGenerations';

const cost: TaskCost = {
  input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, usd: { estimate: 0.42 }, sessions: 1,
  snapshotAt: '2026-01-01T00:00:00Z', readAt: '2026-01-01T00:00:00Z',
};

const gen = (over: Partial<WorkflowGenerationSummary> = {}): WorkflowGenerationSummary => ({
  id: 'G-1', taskId: 'T-7', description: 'Plan with an architect, build, then review the merge request', state: 'writing',
  attempts: 0, hasDraft: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const panel = (over: Partial<WorkflowGenerationSummary> = {}, props: Partial<Parameters<typeof GenerationPanel>[0]> = {}) => {
  const p = {
    generation: gen(over),
    action: { pending: false, error: null },
    onAnswer: jest.fn(() => ok(undefined)),
    onRequestChanges: jest.fn(() => ok(undefined)),
    onDiscard: jest.fn(),
    ...props,
  };
  render(<GenerationPanel {...p} />);
  return p;
};
const show = ({ button, panels }: { button: ReactNode; panels: ReactNode }) => (
  <>
    <header data-testid="head">{button}</header>
    {panels}
  </>
);
const state = () => screen.getByTestId('generation-state');

describe('GenerationPanel', () => {
  it('writing: shortened description, state in words, cost, last message, open task link', () => {
    panel({
      description: `${'x'.repeat(150)} tail`,
      cost,
      lastMessage: `Reading the repository ${'y'.repeat(300)}`,
    });
    expect(state()).toHaveTextContent('writing…');
    const description = screen.getByTestId('generation-description');
    expect(description.textContent).toMatch(/^x+…$/);
    expect(description.textContent!.length).toBeLessThanOrEqual(120);
    expect(screen.getByTestId('generation-cost')).toHaveTextContent('$0.42 (estimate)');
    const last = screen.getByTestId('generation-last-message');
    expect(last).toHaveTextContent(/^Reading the repository y+…$/);
    expect(screen.getByRole('link', { name: 'open task' })).toHaveAttribute('href', '#/tasks/T-7');
    expect(screen.queryByRole('link', { name: /Open in editor/ })).toBeNull();
  });

  it.each(['writing', 'asking', 'fixing'] as const)('%s: Discard is offered and calls onDiscard', (state) => {
    const p = panel({ state, question: state === 'asking' ? { id: 'q1', session: 'main', text: 'Which?', options: [], asked: '2026-01-01T00:00:00Z' } : undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('fixing: shows the attempt of two', () => {
    panel({ state: 'fixing', attempts: 1 });
    expect(state()).toHaveTextContent('fixing 1 of 2…');
  });

  it('shows a warning line', () => {
    panel({ warning: 'The task could not be closed.' });
    expect(screen.getByTestId('generation-warning')).toHaveTextContent('The task could not be closed.');
  });

  it('asking: the question with its options and a free answer', async () => {
    const p = panel({
      state: 'asking',
      question: { id: 'q1', session: 'main', text: 'Which lane for review?', options: ['review', 'doing'], asked: '2026-01-01T00:00:00Z' },
    });
    expect(state()).toHaveTextContent('asking');
    const q = screen.getByTestId('generation-question');
    expect(q).toHaveTextContent('Which lane for review?');
    fireEvent.click(within(q).getByRole('button', { name: 'review' }));
    expect(p.onAnswer).toHaveBeenCalledWith('review');
    fireEvent.change(within(q).getByLabelText('Answer'), { target: { value: 'use doing' } });
    await act(async () => {
      fireEvent.click(within(q).getByRole('button', { name: 'Send answer' }));
    });
    expect(p.onAnswer).toHaveBeenLastCalledWith('use doing');
    await waitFor(() => expect(within(q).getByLabelText('Answer')).toHaveValue(''));
  });

  it('asking: send is off while empty or pending', () => {
    panel(
      { state: 'asking', question: { id: 'q1', session: 'main', text: 'Q?', options: [], asked: '2026-01-01T00:00:00Z' } },
      { action: { pending: true, error: null } },
    );
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  });

  it('ready: open in editor, discard, request changes', async () => {
    const p = panel({ state: 'ready', hasDraft: true });
    expect(state()).toHaveTextContent('draft ready');
    expect(screen.getByRole('link', { name: 'Open in editor' })).toHaveAttribute('href', '#/workflows/new?generation=G-1');
    expect(screen.queryByTestId('generation-last-message')).toBeNull();
    const send = screen.getByRole('button', { name: 'Request changes' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Changes'), { target: { value: 'add a review step' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(p.onRequestChanges).toHaveBeenCalledWith('add a review step');
    await waitFor(() => expect(screen.getByLabelText('Changes')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('keeps the typed changes when the request fails, and shows the action error', async () => {
    const p = panel(
      { state: 'ready', hasDraft: true },
      { onRequestChanges: jest.fn(() => Promise.resolve({ ok: false as const })), action: { pending: false, error: 'busy' } },
    );
    fireEvent.change(screen.getByLabelText('Changes'), { target: { value: 'more' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    });
    expect(p.onRequestChanges).toHaveBeenCalled();
    expect(screen.getByLabelText('Changes')).toHaveValue('more');
    expect(screen.getByRole('alert')).toHaveTextContent('busy');
  });

  it('failed: errors with their place, the reason, open anyway only with a draft, discard', () => {
    const p = panel({
      state: 'failed',
      hasDraft: true,
      failureReason: 'Still invalid after 2 fixes.',
      errors: [
        { message: 'prompt is empty', stepId: 'build', field: 'prompt' },
        { message: 'id is missing', stepIndex: 2 },
        { message: 'title is empty', field: 'title' },
      ],
    });
    expect(state()).toHaveTextContent('failed');
    const items = within(screen.getByRole('list', { name: 'Errors' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['build · prompt: prompt is empty', 'step 3: id is missing', 'title: title is empty']);
    expect(screen.getByTestId('generation-failure')).toHaveTextContent('Still invalid after 2 fixes.');
    expect(screen.getByRole('link', { name: 'Open in editor anyway' })).toHaveAttribute('href', '#/workflows/new?generation=G-1');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('failed without a draft: no editor link', () => {
    panel({ state: 'failed', hasDraft: false, failureReason: 'The task failed.' });
    expect(screen.queryByRole('link', { name: /Open in editor/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Errors' })).toBeNull();
  });
});

describe('WorkflowGenerations', () => {
  type GProps = Omit<Parameters<typeof WorkflowGenerations>[0], 'children'>;
  const setup = (over: Partial<GProps> = {}) => {
    const p = {
      generations: [gen(), gen({ id: 'G-2', state: 'ready', hasDraft: true })],
      error: null,
      startState: { pending: false, error: null },
      actionState: jest.fn(() => ({ pending: false, error: null })),
      start: jest.fn(() => ok(gen({ id: 'G-3' }))),
      requestChanges: jest.fn(() => ok(gen())),
      discard: jest.fn(() => ok(gen())),
      answer: jest.fn(() => ok(undefined)),
      ...over,
    } as GProps;
    const r = render(<WorkflowGenerations {...p}>{show}</WorkflowGenerations>);
    return { ...p, rerender: (next: Partial<GProps>) => r.rerender(<WorkflowGenerations {...p} {...next}>{show}</WorkflowGenerations>) };
  };

  it('shows one panel per open generation, wired to its id', () => {
    const p = setup();
    expect(screen.getByTestId('generation-G-1')).toBeInTheDocument();
    const ready = screen.getByTestId('generation-G-2');
    fireEvent.click(within(ready).getByRole('button', { name: 'Discard' }));
    expect(p.discard).toHaveBeenCalledWith('G-2');
    expect(p.actionState).toHaveBeenCalledWith('G-2');
  });

  it('answers with the generation', () => {
    const asking = gen({
      state: 'asking',
      question: { id: 'q', session: 'main', text: 'Q?', options: ['yes'], asked: '2026-01-01T00:00:00Z' },
    });
    const p = setup({ generations: [asking] });
    fireEvent.click(screen.getByRole('button', { name: 'yes' }));
    expect(p.answer).toHaveBeenCalledWith(asking, 'yes');
  });

  it('shows the list error', () => {
    setup({ error: 'Workflows are read-only here' });
    expect(screen.getByRole('alert')).toHaveTextContent('Workflows are read-only here');
  });

  it('Generate with AI opens a dialog: description (max 4000), optional model, a note on tokens, Start', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
    const dialog = screen.getByRole('dialog', { name: 'Generate a workflow with AI' });
    expect(dialog).toHaveTextContent(/agent task.*costs tokens/);
    const description = within(dialog).getByLabelText('Describe the workflow');
    expect(description).toHaveAttribute('maxLength', '4000');
    const start = within(dialog).getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    fireEvent.change(description, { target: { value: '  plan then build  ' } });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(p.start).toHaveBeenCalledWith('plan then build');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('passes a model when given', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
    fireEvent.change(screen.getByLabelText('Describe the workflow'), { target: { value: 'flow' } });
    fireEvent.change(screen.getByLabelText('Model (optional)'), { target: { value: ' opus ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    expect(p.start).toHaveBeenCalledWith('flow', 'opus');
  });

  it('keeps the dialog open with the error when start fails; Cancel closes it', async () => {
    const p = setup({ start: jest.fn(() => Promise.resolve({ ok: false as const })) });
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
    fireEvent.change(screen.getByLabelText('Describe the workflow'), { target: { value: 'flow' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    p.rerender({ startState: { pending: false, error: 'At most 2 tasks may run' } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('At most 2 tasks may run');
    expect(within(dialog).getByLabelText('Describe the workflow')).toHaveValue('flow');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Start is off while starting', () => {
    setup({ startState: { pending: true, error: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
    fireEvent.change(screen.getByLabelText('Describe the workflow'), { target: { value: 'flow' } });
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
  });
});
