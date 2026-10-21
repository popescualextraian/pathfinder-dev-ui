import type { WorkflowRun, WorkflowSummary } from '../../src/api/models';

export function makeWorkflow(over: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: 'plan-implement-review',
    title: 'Plan, implement, review',
    doneStage: 'done',
    steps: [
      { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human' },
      { id: 'implement', title: 'Implement', stage: 'in-progress', gate: 'auto' },
    ],
    ...over,
  };
}

export function makeRun(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'R-20261020-aaaaaaaa',
    workflowId: 'plan-implement-review',
    definition: {
      id: 'plan-implement-review',
      title: 'Plan, implement, review',
      doneStage: 'done',
      steps: [
        { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', prompt: 'plan it' },
        { id: 'implement', title: 'Implement', stage: 'in-progress', gate: 'auto', prompt: 'do it' },
      ],
    },
    itemId: '7',
    item: { id: '7', title: 'Fix it', description: 'Details', url: 'https://gitlab.example/p/-/issues/7', stage: 'backlog' },
    taskId: 'T-1',
    stepIndex: 0,
    phase: 'sessions',
    sessions: { main: { status: 'running' }, implement: { status: 'pending' } },
    state: 'running',
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
    ...over,
  };
}
