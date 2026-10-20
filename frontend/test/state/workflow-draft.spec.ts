import type { WorkflowDefinition } from '../../src/api/models';
import {
  addSession, addStep, duplicateDraft, errorAt, normalize, forkOptions, moveSession, moveStep, newDraft, proposeId, removeSession,
  removeStep, setDoneStage, slugify, toggleGate, toWire, updateSession, updateStep,
} from '../../src/state/workflow-draft';

const two = (): WorkflowDefinition => ({
  title: 'Two',
  steps: [
    { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', sessions: [{ name: 'main', prompt: 'p' }] },
    {
      id: 'impl', title: 'Impl', gate: 'auto',
      sessions: [{ name: 'a', prompt: 'x', fork: 'main' }, { name: 'b', prompt: 'y' }],
    },
  ],
});
const names = (d: WorkflowDefinition) => d.steps.map((s) => s.sessions.map((x) => x.name));

describe('ids', () => {
  it('slugifies to [a-z0-9-], starting alphanumeric, max 64', () => {
    expect(slugify('  Plan & Implement!  ')).toBe('plan-implement');
    expect(slugify('--Ünï')).toBe('n');
    expect(slugify('!!!')).toBe('');
    expect(slugify('New')).toBe('new-workflow');
    const long = slugify('a'.repeat(100));
    expect(long).toHaveLength(64);
    expect(slugify(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63));
  });

  it('proposeId makes the slug unique among taken', () => {
    expect(proposeId('Review', ['review', 'review-2'])).toBe('review-3');
    expect(proposeId('Review')).toBe('review');
    expect(proposeId('')).toBe('');
    expect(proposeId('new')).toBe('new-workflow');
    expect(proposeId('New', ['new-workflow'])).toBe('new-workflow-2');
    expect(proposeId('a'.repeat(64), ['a'.repeat(64)])).toHaveLength(64);
  });
});

describe('initial drafts', () => {
  it('newDraft has one step with the main session', () => {
    expect(names(newDraft())).toEqual([['main']]);
  });

  it('duplicateDraft copies deeply, drops the id and marks the title', () => {
    const src = { ...two(), id: 'two' } as WorkflowDefinition;
    const copy = duplicateDraft(src);
    expect(copy.title).toBe('Two (copy)');
    expect('id' in copy).toBe(false);
    copy.steps[0].title = 'changed';
    expect(src.steps[0].title).toBe('Plan');
  });
});

describe('steps', () => {
  it('addStep appends a step with unique ids and session names', () => {
    const d = addStep(addStep(two()));
    expect(d.steps.map((s) => s.id)).toEqual(['plan', 'impl', 'step-1', 'step-2']);
    expect(new Set(names(d).flat()).size).toBe(names(d).flat().length);
  });

  it('removing the first step renames nothing (validation then asks for main) and drops forks to gone sessions', () => {
    const d = removeStep(two(), 0);
    expect(names(d)).toEqual([['a', 'b']]);
    expect(d.steps[0].sessions[0].fork).toBeUndefined();
  });

  it('moveStep swaps later steps, is a no-op out of range and for any move involving the first step', () => {
    const three = addStep(two());
    const d = moveStep(three, 2, -1);
    expect(d.steps.map((s) => s.id)).toEqual(['plan', 'step-1', 'impl']);
    const same = two();
    expect(moveStep(same, 0, -1)).toBe(same);
    expect(moveStep(same, 0, 1)).toBe(same);
    expect(moveStep(same, 1, -1)).toBe(same);
    expect(moveStep(same, 1, 1)).toBe(same);
  });

  it('normalize never renames sessions', () => {
    const d = two();
    d.steps[0].sessions[0].name = 'first';
    expect(names(normalize(d))[0]).toEqual(['first']);
  });

  it('updateStep: stage optional, empty clears it', () => {
    let d = updateStep(two(), 1, { stage: 'done' });
    expect(d.steps[1].stage).toBe('done');
    d = updateStep(d, 1, { stage: '' });
    expect('stage' in d.steps[1]).toBe(false);
    d = updateStep(d, 0, { stage: undefined });
    expect('stage' in d.steps[0]).toBe(false);
  });

  it('title proposes the id only while the id still follows the title', () => {
    let d = updateStep(addStep(newDraft()), 1, { title: 'Code Review' });
    expect(d.steps[1].id).toBe('code-review');
    d = updateStep(d, 1, { title: 'Code Review 2' });
    expect(d.steps[1].id).toBe('code-review-2');
    d = updateStep(d, 1, { id: 'mine' });
    d = updateStep(d, 1, { title: 'Other' });
    expect(d.steps[1].id).toBe('mine');
    d = updateStep(d, 1, { title: 'Plan' });
    d = updateStep(newDraft(), 0, { title: 'Plan' });
    expect(updateStep(addStep(d), 1, { title: 'Plan' }).steps[1].id).toBe('plan-2');
  });

  it('toggleGate flips human and auto', () => {
    expect(toggleGate(two(), 0).steps[0].gate).toBe('auto');
    expect(toggleGate(toggleGate(two(), 0), 0).steps[0].gate).toBe('human');
  });

  it('setDoneStage sets and clears', () => {
    expect(setDoneStage(two(), 'done').doneStage).toBe('done');
    expect('doneStage' in setDoneStage(setDoneStage(two(), 'done'), '')).toBe(false);
  });
});

describe('sessions', () => {
  it('addSession adds a uniquely named empty session', () => {
    const d = addSession(two(), 0);
    expect(names(d)[0]).toHaveLength(2);
    expect(new Set(names(d).flat()).size).toBe(4);
  });

  it('the first session of the first step cannot be removed, renamed or moved', () => {
    const d = addSession(two(), 0);
    expect(removeSession(d, 0, 0)).toBe(d);
    expect(updateSession(d, 0, 0, { name: 'x', prompt: 'new' }).steps[0].sessions[0]).toEqual({ name: 'main', prompt: 'new' });
    expect(moveSession(d, 0, 1, -1)).toBe(d);
    expect(moveSession(d, 0, 0, 1)).toBe(d);
  });

  it('removeSession and moveSession in other places; forks to a removed session are dropped', () => {
    expect(names(removeSession(two(), 1, 0))).toEqual([['main'], ['b']]);
    expect(names(moveSession(two(), 1, 0, 1))).toEqual([['main'], ['b', 'a']]);
    const withFork = updateSession(two(), 1, 1, { fork: 'a' });
    expect(withFork.steps[1].sessions[1].fork).toBe('a');
    expect(removeSession(withFork, 1, 0).steps[1].sessions[0].fork).toBeUndefined();
    expect(moveSession(withFork, 1, 1, -1).steps[1].sessions[0].fork).toBeUndefined();
  });

  it('renaming follows forks that name it; empty model and fork are cleared', () => {
    let d = updateSession(two(), 1, 1, { fork: 'a' });
    d = updateSession(d, 1, 0, { name: 'first' });
    expect(d.steps[1].sessions[1].fork).toBe('first');
    d = updateSession(d, 1, 1, { fork: '', model: '' });
    expect(d.steps[1].sessions[1]).toEqual({ name: 'b', prompt: 'y' });
  });

  it('forkOptions lists only earlier sessions', () => {
    const d = two();
    expect(forkOptions(d, 0, 0)).toEqual([]);
    expect(forkOptions(d, 1, 0)).toEqual(['main']);
    expect(forkOptions(d, 1, 1)).toEqual(['main', 'a']);
  });

  it('a fork to a later session is cleared by normalizing', () => {
    const d = updateSession(two(), 1, 0, { fork: 'b' });
    expect(d.steps[1].sessions[0].fork).toBeUndefined();
  });
});

describe('toWire and errorAt', () => {
  it('leaves out empty optional fields', () => {
    const d = two();
    d.steps[0].stage = '';
    d.steps[0].exitPrompt = '';
    d.steps[0].requires = [''];
    d.steps[1].sessions[0].model = '';
    d.doneStage = '';
    const wire = toWire(d);
    expect(wire.steps[0]).toEqual({ id: 'plan', title: 'Plan', gate: 'human', sessions: [{ name: 'main', prompt: 'p' }] });
    expect(wire.steps[1].sessions[0]).toEqual({ name: 'a', prompt: 'x', fork: 'main' });
    expect('doneStage' in wire).toBe(false);
  });

  it('errorAt matches by the given parts of the location', () => {
    const err = { message: 'm', stepId: 'impl', session: 'a', field: 'fork' };
    expect(errorAt(err, { stepId: 'impl' })).toBe(true);
    expect(errorAt(err, { stepId: 'impl', session: 'a', field: 'fork' })).toBe(true);
    expect(errorAt(err, { stepId: 'plan' })).toBe(false);
    expect(errorAt(err, { stepId: 'impl', field: 'prompt' })).toBe(false);
    expect(errorAt(null, { stepId: 'impl' })).toBe(false);
    const byIndex = { message: 'm', stepIndex: 1, sessionIndex: 0, field: 'name' };
    expect(errorAt(byIndex, { stepIndex: 1 })).toBe(true);
    expect(errorAt(byIndex, { stepIndex: 1, sessionIndex: 0, field: 'name' })).toBe(true);
    expect(errorAt(byIndex, { stepIndex: 0 })).toBe(false);
    expect(errorAt(byIndex, { stepIndex: 1, sessionIndex: 1 })).toBe(false);
  });
});
