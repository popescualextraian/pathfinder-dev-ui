import type { WorkflowRunStep } from '../../src/api/models';
import { currentSession, kickoffPrompt, openStepHref } from '../../src/views/workflow-run-view';
import { makeRun } from '../fixtures/workflows';

const step = (id: string, over: Partial<WorkflowRunStep> = {}): WorkflowRunStep => ({
  id, title: id, gate: 'human', prompt: `${id} it`, ...over,
});
const runAt = (steps: WorkflowRunStep[], stepIndex: number) =>
  makeRun({ definition: { id: 'wf', title: 'WF', steps }, stepIndex });

describe('currentSession', () => {
  it('is main for the first step, whatever its id', () => {
    expect(currentSession(runAt([step('plan'), step('build')], 0))).toBe('main');
  });

  it('is the step id for a step with a new conversation or a copy', () => {
    expect(currentSession(runAt([step('plan'), step('build')], 1))).toBe('build');
    expect(currentSession(runAt([step('plan'), step('build'), step('review', { fork: 'build' })], 2))).toBe('review');
  });

  it('follows continue chains to the conversation they go on in', () => {
    const steps = [step('plan'), step('build', { continue: 'plan' }), step('fix', { continue: 'build' }), step('rev'), step('again', { continue: 'rev' })];
    expect(currentSession(runAt(steps, 1))).toBe('main');
    expect(currentSession(runAt(steps, 2))).toBe('main');
    expect(currentSession(runAt(steps, 4))).toBe('rev');
  });

  it('prefers the internal session of an old run, also along a continue chain', () => {
    const steps = [step('plan', { session: 'main' }), step('implement', { session: 'impl' }), step('more', { continue: 'implement' })];
    expect(currentSession(runAt(steps, 1))).toBe('impl');
    expect(currentSession(runAt(steps, 2))).toBe('impl');
  });

  it('Open step links that session', () => {
    expect(openStepHref(runAt([step('plan'), step('build a')], 1))).toBe('#/tasks/T-1?session=build%20a');
  });
});

describe('kickoffPrompt', () => {
  const item = { id: '7', title: 'Fix it', description: '  Details\nmore  ', url: 'https://x/7' };
  const end = 'Read it and get familiar with it, then wait for my instructions. Do not change anything yet.';
  it('names the item, its description and link, then asks to wait', () => {
    expect(kickoffPrompt(item)).toBe(
      `We plan to work on backlog item #7: Fix it\n\nDetails\nmore\n\nhttps://x/7\n\n${end}`,
    );
  });
  it('omits a missing description or link', () => {
    expect(kickoffPrompt({ ...item, description: ' ', url: '' })).toBe(`We plan to work on backlog item #7: Fix it\n\n${end}`);
    expect(kickoffPrompt({ ...item, description: '' })).toBe(`We plan to work on backlog item #7: Fix it\n\nhttps://x/7\n\n${end}`);
  });
});
