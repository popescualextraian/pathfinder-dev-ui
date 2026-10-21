import type { WorkflowDefinition } from '../../src/api/models';
import {
  addStep, conversationChoices, conversationOf, duplicateDraft, errorAt, isSameDefinition, moveStep, newDraft, normalize,
  proposeId, proposeStepId, removeStep, setConversation, setDoneStage, slugify, stepTitle, toggleGate, toWire, updateStep,
} from '../../src/state/workflow-draft';

const three = (): WorkflowDefinition => ({
  title: 'Three',
  steps: [
    { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', prompt: 'p', model: 'opus' },
    { id: 'impl', title: 'Impl', gate: 'auto', prompt: 'x', continue: 'plan' },
    { id: 'review', title: 'Review', gate: 'human', prompt: 'r', fork: 'impl' },
  ],
});
const ids = (d: WorkflowDefinition) => d.steps.map((s) => s.id);

describe('workflow ids', () => {
  it('slugifies to [a-z0-9-], starting alphanumeric, max 64', () => {
    expect(slugify('  Plan & Implement!  ')).toBe('plan-implement');
    expect(slugify('--Ünï')).toBe('n');
    expect(slugify('!!!')).toBe('');
    expect(slugify('New')).toBe('new-workflow');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
    expect(slugify(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63));
  });

  it('proposeId makes the slug unique among taken', () => {
    expect(proposeId('Review', ['review', 'review-2'])).toBe('review-3');
    expect(proposeId('Review')).toBe('review');
    expect(proposeId('')).toBe('');
    expect(proposeId('New', ['new-workflow'])).toBe('new-workflow-2');
  });
});

describe('step ids', () => {
  it('come from the title: lowercase words joined by -, at most 32 characters', () => {
    expect(proposeStepId('Write the Plan!', [], 1)).toBe('write-the-plan');
    expect(proposeStepId('x'.repeat(40), [], 1)).toBe('x'.repeat(32));
    expect(proposeStepId(`${'a'.repeat(31)} b`, [], 1)).toBe('a'.repeat(31));
  });

  it('are made unique with -2, -3, staying within 32 characters', () => {
    expect(proposeStepId('Review', ['review'], 2)).toBe('review-2');
    expect(proposeStepId('Review', ['review', 'review-2'], 2)).toBe('review-3');
    expect(proposeStepId('a'.repeat(32), ['a'.repeat(32)], 1)).toBe(`${'a'.repeat(30)}-2`);
  });

  it('fall back to step-N when the title has nothing usable', () => {
    expect(proposeStepId('!!!', [], 2)).toBe('step-1');
    expect(proposeStepId('', ['step-1'], 2)).toBe('step-2');
  });

  it('main is only for the first step', () => {
    expect(proposeStepId('Main', [], 0)).toBe('main');
    expect(proposeStepId('Main', [], 1)).toBe('main-2');
  });
});

describe('initial drafts', () => {
  it('newDraft has one step with an empty prompt', () => {
    expect(newDraft().steps).toEqual([{ id: 'step-1', title: '', gate: 'human', prompt: '' }]);
  });

  it('duplicateDraft copies deeply, drops the id and marks the title', () => {
    const src = { ...three(), id: 'three' } as WorkflowDefinition;
    const copy = duplicateDraft(src);
    expect(copy.title).toBe('Three (copy)');
    expect('id' in copy).toBe(false);
    copy.steps[0].title = 'changed';
    expect(src.steps[0].title).toBe('Plan');
  });
});

describe('steps', () => {
  it('addStep appends a step with a unique generated id', () => {
    const d = addStep(addStep(three()));
    expect(ids(d)).toEqual(['plan', 'impl', 'review', 'step-1', 'step-2']);
    expect(d.steps[3]).toEqual({ id: 'step-1', title: '', gate: 'human', prompt: '' });
  });

  it('removeStep drops continue and fork that name the removed step', () => {
    const d = removeStep(three(), 1);
    expect(ids(d)).toEqual(['plan', 'review']);
    expect(d.steps[1].fork).toBeUndefined();
  });

  it('moveStep swaps later steps, drops references that are no longer to an earlier step, never moves the first', () => {
    const d = moveStep(three(), 2, -1);
    expect(ids(d)).toEqual(['plan', 'review', 'impl']);
    expect(d.steps[1].fork).toBeUndefined();
    expect(d.steps[2].continue).toBe('plan');
    const same = three();
    expect(moveStep(same, 0, 1)).toBe(same);
    expect(moveStep(same, 1, -1)).toBe(same);
  });

  it('normalize drops a model on a continuing step and references on the first step', () => {
    const d = three();
    d.steps[1].model = 'opus';
    d.steps[0].fork = 'impl';
    const n = normalize(d);
    expect('model' in n.steps[1]).toBe(false);
    expect('fork' in n.steps[0]).toBe(false);
  });

  it('updateStep: stage, model and exit prompt are optional, empty clears them', () => {
    let d = updateStep(three(), 2, { stage: 'done', model: 'haiku', exitPrompt: 'check' });
    expect(d.steps[2]).toMatchObject({ stage: 'done', model: 'haiku', exitPrompt: 'check' });
    d = updateStep(d, 2, { stage: '', model: '', exitPrompt: '' });
    expect(d.steps[2]).toEqual({ id: 'review', title: 'Review', gate: 'human', prompt: 'r', fork: 'impl' });
  });

  it('a model is ignored on a step that continues a conversation', () => {
    expect('model' in updateStep(three(), 1, { model: 'opus' }).steps[1]).toBe(false);
  });

  it('a new title renames the id, and the steps continuing or copying it follow', () => {
    const d = updateStep(three(), 1, { title: 'Implement it' });
    expect(ids(d)).toEqual(['plan', 'implement-it', 'review']);
    expect(d.steps[2].fork).toBe('implement-it');
    const e = updateStep(d, 0, { title: 'Design' });
    expect(e.steps[0].id).toBe('design');
    expect(e.steps[1].continue).toBe('design');
  });

  it('a title that is taken gets -2; a title without letters keeps a generated id', () => {
    expect(updateStep(three(), 2, { title: 'Plan' }).steps[2].id).toBe('plan-2');
    const d = updateStep(addStep(three()), 3, { title: '' });
    expect(d.steps[3].id).toBe('step-1');
    expect(updateStep(d, 3, { title: '???' }).steps[3].id).toBe('step-1');
    expect(updateStep(three(), 1, { title: '' }).steps[1].id).toBe('step-1');
  });

  it('a title that gives the same id changes nothing else', () => {
    const d = updateStep(three(), 1, { title: 'IMPL!' });
    expect(d.steps[1].id).toBe('impl');
    expect(d.steps[2].fork).toBe('impl');
  });

  it('toggleGate flips human and auto; setDoneStage sets and clears', () => {
    expect(toggleGate(three(), 0).steps[0].gate).toBe('auto');
    expect(toggleGate(toggleGate(three(), 0), 0).steps[0].gate).toBe('human');
    expect(setDoneStage(three(), 'done').doneStage).toBe('done');
    expect('doneStage' in setDoneStage(setDoneStage(three(), 'done'), '')).toBe(false);
  });

  it('stepTitle names a step by its id (the id itself when untitled or unknown)', () => {
    const d = three();
    expect(stepTitle(d, 'impl')).toBe('Impl');
    expect(stepTitle(d, 'gone')).toBe('gone');
    expect(stepTitle(addStep(d), 'step-1')).toBe('Step 4');
  });
});

describe('conversation', () => {
  it('conversationOf reads new, continue and copy', () => {
    const d = three();
    expect(conversationOf(d.steps[0])).toEqual({ kind: 'new' });
    expect(conversationOf(d.steps[1])).toEqual({ kind: 'continue', step: 'plan' });
    expect(conversationOf(d.steps[2])).toEqual({ kind: 'fork', step: 'impl' });
  });

  it('choices are the earlier steps only; none for the first step', () => {
    const d = three();
    expect(conversationChoices(d, 0)).toEqual([]);
    expect(conversationChoices(d, 2)).toEqual([
      { id: 'plan', title: 'Plan' },
      { id: 'impl', title: 'Impl' },
    ]);
  });

  it('setConversation sets one of continue / fork; continue clears the model', () => {
    let d = updateStep(three(), 2, { model: 'opus' });
    d = setConversation(d, 2, { kind: 'continue', step: 'plan' });
    expect(d.steps[2]).toMatchObject({ continue: 'plan' });
    expect('fork' in d.steps[2]).toBe(false);
    expect('model' in d.steps[2]).toBe(false);
    d = setConversation(d, 2, { kind: 'fork', step: 'plan' });
    expect(d.steps[2]).toMatchObject({ fork: 'plan' });
    expect('continue' in d.steps[2]).toBe(false);
    d = setConversation(d, 2, { kind: 'new' });
    expect('fork' in d.steps[2] || 'continue' in d.steps[2]).toBe(false);
  });

  it('refuses a later step or the step itself, and the first step', () => {
    const d = three();
    expect(setConversation(d, 1, { kind: 'fork', step: 'review' })).toBe(d);
    expect(setConversation(d, 1, { kind: 'fork', step: 'impl' })).toBe(d);
    expect(setConversation(d, 0, { kind: 'continue', step: 'impl' })).toBe(d);
  });
});

describe('toWire, isSameDefinition and errorAt', () => {
  it('leaves out empty optional fields', () => {
    const d = three();
    d.steps[0].stage = '';
    d.steps[0].exitPrompt = '';
    d.steps[0].model = '';
    d.steps[0].requires = [''];
    d.doneStage = '';
    const wire = toWire(d);
    expect(wire.steps[0]).toEqual({ id: 'plan', title: 'Plan', gate: 'human', prompt: 'p' });
    expect(wire.steps[1]).toEqual({ id: 'impl', title: 'Impl', gate: 'auto', prompt: 'x', continue: 'plan' });
    expect('doneStage' in wire).toBe(false);
    expect(isSameDefinition(d, { ...three(), steps: [wire.steps[0], ...three().steps.slice(1)] })).toBe(true);
  });

  it('errorAt matches by the given parts of the location', () => {
    const err = { message: 'm', stepId: 'impl', field: 'fork' };
    expect(errorAt(err, { stepId: 'impl' })).toBe(true);
    expect(errorAt(err, { stepId: 'impl', field: 'fork' })).toBe(true);
    expect(errorAt(err, { stepId: 'plan' })).toBe(false);
    expect(errorAt(err, { stepId: 'impl', field: 'prompt' })).toBe(false);
    expect(errorAt(null, { stepId: 'impl' })).toBe(false);
    const byIndex = { message: 'm', stepIndex: 1, field: 'id' };
    expect(errorAt(byIndex, { stepIndex: 1, field: 'id' })).toBe(true);
    expect(errorAt(byIndex, { stepIndex: 0 })).toBe(false);
  });
});
