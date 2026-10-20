import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BoardView } from '../../src/views/BoardView';
import type { WorkflowBoard } from '../../src/views/workflow-run-view';
import type { BacklogItem, Lane, WorkflowRun } from '../../src/api/models';
import { makeRun, makeWorkflow } from '../fixtures/workflows';

const lanes: Lane[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'plan', title: 'Plan' },
  { id: 'in-progress', title: 'In progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

const item = (over: Partial<BacklogItem> = {}): BacklogItem => ({
  id: '7',
  title: 'Fix it',
  description: 'Details',
  lane: 'backlog',
  assignees: [],
  url: 'https://x/7',
  fileLinks: [],
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const three = makeRun().definition;
three.steps = [
  ...three.steps,
  { id: 'review', title: 'Review', stage: 'review', gate: 'human', sessions: [{ name: 'review', prompt: 'r' }] },
];
const run3 = (over: Partial<WorkflowRun> = {}) =>
  makeRun({ definition: three, sessions: { main: { status: 'running' }, impl: { status: 'pending' }, review: { status: 'pending' } }, ...over });

const board = (over: Partial<WorkflowBoard> = {}, runs: WorkflowRun[] = []): WorkflowBoard => ({
  definitions: [makeWorkflow()],
  ready: true,
  runsByItem: new Map(runs.map((r) => [r.itemId, r])),
  actionState: () => ({ pending: false, error: null }),
  start: jest.fn().mockResolvedValue({ ok: true }),
  advance: jest.fn().mockResolvedValue({ ok: true }),
  stop: jest.fn().mockResolvedValue({ ok: true }),
  ...over,
});

const renderBoard = (workflows: WorkflowBoard | undefined, items: BacklogItem[] = [item()], extra = {}) => {
  const onMove = jest.fn();
  render(
    <BoardView
      lanes={lanes}
      items={items}
      me="me"
      onMove={onMove}
      onCreate={jest.fn()}
      onUpdate={jest.fn()}
      workflows={workflows}
      {...extra}
    />,
  );
  return { onMove };
};

const card = () => screen.getByTestId('backlog-card-7');

const dataTransfer = () => {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => (data[k] = v),
    getData: (k: string) => data[k] ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
};
const drag = (laneTitle: string) => {
  const dt = dataTransfer();
  fireEvent.dragStart(card(), { dataTransfer: dt });
  fireEvent.drop(screen.getByRole('region', { name: laneTitle }), { dataTransfer: dt });
};

describe('workflows disabled', () => {
  it('shows no workflow controls anywhere', () => {
    renderBoard(undefined, [item()], { selectedId: '7' });
    expect(screen.queryByText(/Workflow/)).toBeNull();
    expect(screen.queryByTestId('workflow-run-line')).toBeNull();
  });

  it('shows no start button without definitions', () => {
    renderBoard(board({ definitions: [] }));
    expect(screen.queryByRole('button', { name: 'Start workflow on #7' })).toBeNull();
  });
});

describe('start a workflow from a card', () => {
  it('picks a definition, confirms, then starts', async () => {
    const wf = board({ definitions: [makeWorkflow(), makeWorkflow({ id: 'quick', title: 'Quick fix' })] });
    renderBoard(wf);
    fireEvent.click(within(card()).getByRole('button', { name: 'Start workflow on #7' }));
    const picker = screen.getByRole('dialog', { name: 'Choose a workflow for #7' });
    expect(wf.start).not.toHaveBeenCalled();
    fireEvent.click(within(picker).getByRole('button', { name: 'Quick fix' }));
    expect(wf.start).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Start Quick fix on #7?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Start' }));
    });
    expect(wf.start).toHaveBeenCalledWith('7', 'quick');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes straight to the confirm step with a single definition', () => {
    const wf = board();
    renderBoard(wf);
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow on #7' }));
    expect(screen.queryByRole('dialog', { name: /Choose a workflow/ })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Start Plan, implement, review on #7?' })).toBeTruthy();
  });

  it('cancel (button or Escape) does not start', () => {
    const wf = board({ definitions: [makeWorkflow(), makeWorkflow({ id: 'quick', title: 'Quick fix' })] });
    renderBoard(wf);
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow on #7' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow on #7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick fix' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow on #7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick fix' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wf.start).not.toHaveBeenCalled();
  });

  it('shows the action error from the hook', () => {
    renderBoard(board({ actionState: () => ({ pending: false, error: 'item has an active run' }) }));
    expect(within(card()).getByRole('alert').textContent).toBe('item has an active run');
  });
});

describe('run line', () => {
  it('shows title, step and state, Open step to the current session, Stop', () => {
    renderBoard(board({}, [run3()]));
    const line = within(card()).getByTestId('workflow-run-line');
    expect(line.textContent).toContain('Plan, implement, review');
    expect(within(line).getByTestId('workflow-step').textContent).toBe('Plan · 1/3');
    expect(within(line).getByTestId('workflow-state').textContent).toBe('running');
    expect(line.getAttribute('data-state')).toBe('running');
    expect(line.getAttribute('data-attention')).toBeNull();
    expect(within(line).getByRole('link', { name: 'Open step' }).getAttribute('href')).toBe('#/tasks/T-1?session=main');
    expect(within(line).getByRole('button', { name: 'Stop workflow' })).toBeTruthy();
    expect(within(line).queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start workflow on #7' })).toBeNull();
  });

  it('Open step links the last started session of the current step', () => {
    const run = makeRun({
      definition: {
        ...three,
        steps: [
          three.steps[0],
          { ...three.steps[1], sessions: [{ name: 'impl', prompt: 'a' }, { name: 'tests', prompt: 'b' }, { name: 'docs', prompt: 'c' }] },
        ],
      },
      stepIndex: 1,
      sessions: { main: { status: 'done' }, impl: { status: 'done' }, tests: { status: 'running' }, docs: { status: 'pending' } },
    });
    renderBoard(board({}, [run]));
    expect(screen.getByRole('link', { name: 'Open step' }).getAttribute('href')).toBe('#/tasks/T-1?session=tests');
    expect(screen.getByTestId('workflow-step').textContent).toBe('Implement · 2/2');
  });

  it.each([
    ['needs-you', 'needs you'],
    ['awaiting-approval', 'awaiting approval'],
    ['blocked', 'blocked'],
    ['failed', 'failed'],
  ] as const)('marks %s as needing attention', (state, label) => {
    const phase = state === 'blocked' ? 'blocked' : state === 'awaiting-approval' ? 'awaiting-approval' : 'sessions';
    renderBoard(board({}, [run3({ state, phase })]));
    const line = screen.getByTestId('workflow-run-line');
    expect(line.getAttribute('data-attention')).toBe('true');
    expect(line.getAttribute('aria-label')).toBe(`Workflow Plan, implement, review: ${label}`);
    expect(within(line).getByTestId('workflow-state').textContent).toBe(label);
  });

  it('awaiting approval: Continue → next step title calls advance', async () => {
    const wf = board({}, [run3({ state: 'awaiting-approval', phase: 'awaiting-approval' })]);
    renderBoard(wf);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue → Implement' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
  });

  it('awaiting approval after the last step: Finish', async () => {
    const wf = board({}, [run3({ state: 'awaiting-approval', phase: 'awaiting-approval', stepIndex: 2 })]);
    renderBoard(wf);
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
  });

  it('blocked: shows the warning and Start anyway forces', async () => {
    const wf = board({}, [run3({ state: 'blocked', phase: 'blocked', warning: 'Missing files: plans/7.md' })]);
    renderBoard(wf);
    expect(within(card()).getByTestId('workflow-warning').textContent).toBe('Missing files: plans/7.md');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa', true);
  });

  it('failed: shows the reason, no action buttons, a new workflow may start', () => {
    renderBoard(board({}, [run3({ state: 'failed', failureReason: 'the task is gone' })]));
    expect(screen.getByTestId('workflow-warning').textContent).toBe('the task is gone');
    expect(screen.queryByRole('button', { name: 'Stop workflow' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open step' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start workflow on #7' })).toBeTruthy();
  });

  it.each(['done', 'stopped'] as const)('%s: only the state, no action buttons', (state) => {
    renderBoard(board({}, [run3({ state })]));
    const line = screen.getByTestId('workflow-run-line');
    expect(within(line).getByTestId('workflow-state').textContent).toBe(state);
    expect(within(line).queryAllByRole('button')).toHaveLength(0);
    expect(within(line).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start workflow on #7' })).toBeTruthy();
  });

  it('Stop workflow asks first; Keep running does nothing, Yes, stop stops', async () => {
    const wf = board({}, [run3()]);
    renderBoard(wf);
    fireEvent.click(screen.getByRole('button', { name: 'Stop workflow' }));
    const dialog = screen.getByRole('dialog', { name: 'Stop Plan, implement, review on #7?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep running' }));
    expect(wf.stop).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop workflow' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, stop' }));
    });
    expect(wf.stop).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
  });

  it('disables the buttons while an action is pending and shows its error', () => {
    renderBoard(
      board({ actionState: () => ({ pending: true, error: 'advance failed' }) }, [
        run3({ state: 'awaiting-approval', phase: 'awaiting-approval' }),
      ]),
    );
    expect((screen.getByRole('button', { name: 'Continue → Implement' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Stop workflow' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(card()).getByRole('alert').textContent).toBe('advance failed');
  });
});

describe('item detail', () => {
  it('has the same controls and the steps with their state', async () => {
    const wf = board({}, [run3({ stepIndex: 1, state: 'awaiting-approval', phase: 'awaiting-approval' })]);
    renderBoard(wf, [item({ lane: 'in-progress' })], { selectedId: '7' });
    const detail = screen.getByRole('complementary', { name: 'Item detail' });
    const steps = within(detail).getByRole('list', { name: 'Workflow steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => [li.textContent, li.getAttribute('data-state')])).toEqual([
      ['Plan · done', 'done'],
      ['Implement · current', 'current'],
      ['Review · next', 'next'],
    ]);
    await act(async () => {
      fireEvent.click(within(detail).getByRole('button', { name: 'Continue → Review' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
  });

  it('a done run lists every step as done', () => {
    renderBoard(board({}, [run3({ stepIndex: 2, state: 'done' })]), [item()], { selectedId: '7' });
    const steps = screen.getByRole('list', { name: 'Workflow steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'done']);
  });

  it('starts a workflow from the detail too', () => {
    const wf = board();
    renderBoard(wf, [item()], { selectedId: '7' });
    const detail = screen.getByRole('complementary', { name: 'Item detail' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Start workflow on #7' }));
    expect(screen.getByRole('dialog', { name: 'Start Plan, implement, review on #7?' })).toBeTruthy();
  });
});

describe('dragging a card with an active run', () => {
  const awaiting = () => run3({ state: 'awaiting-approval', phase: 'awaiting-approval', item: { ...makeRun().item, stage: 'plan' } });

  it('drop on the next step lane while awaiting approval asks, and advances on yes', async () => {
    const wf = board({}, [awaiting()]);
    const { onMove } = renderBoard(wf, [item({ lane: 'plan' })]);
    drag('In progress');
    const dialog = screen.getByRole('dialog', { name: 'Continue the workflow to Implement?' });
    expect(wf.advance).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('answering no does nothing', () => {
    const wf = board({}, [awaiting()]);
    const { onMove } = renderBoard(wf, [item({ lane: 'plan' })]);
    drag('In progress');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wf.advance).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Plan' })).getByTestId('backlog-card-7')).toBeTruthy();
  });

  it.each([
    ['another lane while awaiting approval', () => awaiting(), 'Review'],
    ['the next lane while running', () => run3({ item: { ...makeRun().item, stage: 'plan' } }), 'In progress'],
    ['the next lane while blocked', () => run3({ state: 'blocked', phase: 'blocked' }), 'In progress'],
  ])('refuses a drop on %s with a message, no move', (_, run, lane) => {
    const wf = board({}, [run()]);
    const { onMove } = renderBoard(wf, [item({ lane: 'plan' })]);
    drag(lane);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    expect(wf.advance).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('This card is driven by its workflow');
    expect(within(screen.getByRole('region', { name: 'Plan' })).getByTestId('backlog-card-7')).toBeTruthy();
  });

  it('cards without an active run move as before', () => {
    const { onMove } = renderBoard(board({}, [run3({ state: 'done' })]), [item({ lane: 'plan' })]);
    drag('Review');
    expect(onMove).toHaveBeenCalledWith('7', 'review');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('board selection from outside', () => {
  it('a controlled selectedId opens the detail and closing reports null', () => {
    const onSelect = jest.fn();
    renderBoard(undefined, [item()], { selectedId: '7', onSelect });
    expect(screen.getByRole('complementary', { name: 'Item detail' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('runs not loaded', () => {
  it('refuses any drag (also of a card without a run), no move', () => {
    const { onMove } = renderBoard(board({ ready: false }), [item({ lane: 'plan' })]);
    drag('Review');
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Workflow state is not loaded yet');
    expect(within(screen.getByRole('region', { name: 'Plan' })).getByTestId('backlog-card-7')).toBeTruthy();
  });
});

describe('continue dialog follows the run', () => {
  const awaiting = (over: Partial<WorkflowRun> = {}) => run3({ state: 'awaiting-approval', phase: 'awaiting-approval', ...over });
  const props = (wf: WorkflowBoard) => ({
    lanes, items: [item({ lane: 'plan' })], me: 'me', onMove: jest.fn(), onCreate: jest.fn(), onUpdate: jest.fn(), workflows: wf,
  });

  it('closes when the run no longer awaits approval', () => {
    const { rerender } = render(<BoardView {...props(board({}, [awaiting()]))} />);
    drag('In progress');
    expect(screen.getByRole('dialog', { name: 'Continue the workflow to Implement?' })).toBeTruthy();
    rerender(<BoardView {...props(board({}, [run3({ stepIndex: 1, state: 'running', phase: 'sessions' })]))} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('advances the current run', async () => {
    const wf = board({}, [awaiting({ updatedAt: '2026-10-20T11:00:00Z' })]);
    const { rerender } = render(<BoardView {...props(board({}, [awaiting()]))} />);
    drag('In progress');
    rerender(<BoardView {...props(wf)} />);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
    });
    expect(wf.advance).toHaveBeenCalledWith('R-20261020-aaaaaaaa');
  });
});

describe('action errors on the board', () => {
  it('shows a failed workflow action in the board error banner too', () => {
    renderBoard(board({ actionState: (id) => ({ pending: false, error: id === '7' ? 'stop failed' : null }) }, [run3()]));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts.filter((t) => t === 'stop failed')).toHaveLength(2);
  });
});
