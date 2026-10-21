import { parseWorkflowDefinition, validateWorkflowDefinition, WorkflowDefinitionError } from '../../../../src/workflow/service/parse-workflow';

const VALID = `
title: Plan, implement, review
steps:
  - id: plan
    title: Plan
    stage: plan
    prompt: |
      You plan backlog item #{{item.id}}: {{item.title}}
      {{item.description}} {{item.url}}
    gate: human
    exitPrompt: Make sure the plan is complete in plans/{{item.id}}.md and committed.
  - id: implement
    title: Implement
    stage: in-progress
    requires:
      - plans/{{item.id}}.md
    continue: plan
    prompt: Implement plans/{{item.id}}.md on {{task.branch}} ({{task.id}}, {{step.id}}).
    gate: auto
  - id: review
    title: Review
    stage: review
    fork: implement
    model: sonnet
    prompt: Review the branch.
    gate: human
doneStage: done
`;

type Doc = any; // eslint-disable-line @typescript-eslint/no-explicit-any
function mutate(fn: (d: Doc) => void): string {
  const { parse, stringify } = require('yaml'); // eslint-disable-line @typescript-eslint/no-require-imports
  const doc = parse(VALID);
  fn(doc);
  return stringify(doc);
}

const fails = (text: string, re: RegExp, opts = {}) =>
  expect(() => parseWorkflowDefinition('wf', text, opts)).toThrow(re);

describe('parseWorkflowDefinition', () => {
  it('parses the valid example', () => {
    const d = parseWorkflowDefinition('plan-implement-review', VALID, { stages: ['plan', 'in-progress', 'review', 'done'] });
    expect(d.id).toBe('plan-implement-review');
    expect(d.title).toBe('Plan, implement, review');
    expect(d.doneStage).toBe('done');
    expect(d.steps.map((s) => s.id)).toEqual(['plan', 'implement', 'review']);
    expect(d.steps[0].gate).toBe('human');
    expect(d.steps[0].exitPrompt).toMatch(/plans\//);
    expect(d.steps[1].requires).toEqual(['plans/{{item.id}}.md']);
    expect(d.steps[1]).toMatchObject({ continue: 'plan' });
    expect(d.steps[2]).toMatchObject({ fork: 'implement', model: 'sonnet', prompt: 'Review the branch.' });
  });

  it('accepts any stage when none are known', () => {
    expect(() => parseWorkflowDefinition('wf', VALID)).not.toThrow();
  });

  it('rejects invalid YAML', () => fails('title: [unclosed', /invalid YAML/));
  it('rejects a non-mapping document', () => fails('- a', /mapping/));
  it('requires a title', () => fails(mutate((d) => delete d.title), /title/));
  it('requires non-empty steps', () => fails(mutate((d) => (d.steps = [])), /steps/));
  it('requires step fields', () => {
    for (const k of ['id', 'title', 'gate', 'prompt']) {
      fails(mutate((d) => delete d.steps[1][k]), new RegExp(`steps\\[1\\].*${k}`));
    }
  });
  it('loads a step without stage and a workflow with no stage at all', () => {
    const d = parseWorkflowDefinition('wf', mutate((x) => {
      for (const s of x.steps) delete s.stage;
      delete x.doneStage;
    }), { stages: ['todo'] });
    expect(d.steps.every((s) => !('stage' in s))).toBe(true);
    expect(d.doneStage).toBeUndefined();
  });
  it('still checks a given stage against the work items when other steps have none', () =>
    fails(mutate((x) => delete x.steps[0].stage), /stage "in-progress"/, { stages: ['plan', 'review', 'done'] }));
  it('rejects a stage that is not a string', () => fails(mutate((d) => (d.steps[1].stage = 3)), /steps\[1\]\.stage/));
  it('rejects a bad gate', () => fails(mutate((d) => (d.steps[0].gate = 'maybe')), /gate/));
  it('rejects duplicate step ids', () => fails(mutate((d) => (d.steps[1].id = 'plan')), /duplicate step id "plan"/));
  it('requires a prompt', () => fails(mutate((d) => delete d.steps[1].prompt), /prompt/));
  it('rejects a fork from an unknown, a later or the same step', () => {
    fails(mutate((d) => (d.steps[2].fork = 'nope')), /fork "nope" is not an earlier step/);
    fails(mutate((d) => (d.steps[1].fork = 'review')), /fork "review" is not an earlier step/);
    fails(mutate((d) => { delete d.steps[1].continue; d.steps[1].fork = 'implement'; }), /fork "implement" is not an earlier step/);
  });
  it('rejects a continue from an unknown, a later or the same step', () => {
    fails(mutate((d) => (d.steps[1].continue = 'nope')), /continue "nope" is not an earlier step/);
    fails(mutate((d) => (d.steps[1].continue = 'review')), /continue "review" is not an earlier step/);
    fails(mutate((d) => (d.steps[1].continue = 'implement')), /continue "implement" is not an earlier step/);
  });
  it('rejects continue and fork together', () => fails(mutate((d) => (d.steps[2].continue = 'plan')), /steps\[2\]: continue and fork cannot be used together/));
  it('rejects continue or fork on the first step', () => {
    fails(mutate((d) => (d.steps[0].continue = 'plan')), /steps\[0\].continue: the first step has no earlier step/);
    fails(mutate((d) => (d.steps[0].fork = 'plan')), /steps\[0\].fork: the first step has no earlier step/);
  });
  it('rejects a model together with continue', () => fails(mutate((d) => (d.steps[1].model = 'opus')), /steps\[1\].model: a step that continues a conversation cannot choose a model/));
  it('accepts a model with fork and on a plain step', () =>
    expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].model = 'opus')))).not.toThrow());
  it('refuses the old format with its message', () =>
    fails(mutate((d) => (d.steps[0].sessions = [{ name: 'main', prompt: 'x' }])),
      /^the file uses the old format \(sessions:\); since task 015 a step has one prompt: see README$/));
  it('rejects bad step ids', () => {
    fails(mutate((d) => (d.steps[1].id = 'Bad Id')), /steps\[1\]: step id "Bad Id" must match/);
    fails(mutate((d) => (d.steps[1].id = 'a'.repeat(33))), /must match/);
  });
  it('reserves the id main for the first step', () => {
    expect(() => parseWorkflowDefinition('wf', mutate((d) => { d.steps[0].id = 'main'; d.steps[1].continue = 'main'; }))).not.toThrow();
    fails(mutate((d) => (d.steps[1].id = 'main')), /steps\[1\]: the step id "main" is reserved for the first step/);
  });
  it('ignores the internal session field of run snapshots', () => {
    const d = parseWorkflowDefinition('wf', mutate((x) => (x.steps[1].session = 'impl')));
    expect(d.steps[1]).not.toHaveProperty('session');
  });
  it('rejects requires that is not a string list', () => fails(mutate((d) => (d.steps[1].requires = 'x')), /requires/));
  it('rejects a stage the work items do not have', () =>
    fails(VALID, /stage "in-progress"/, { stages: ['plan', 'review', 'done'] }));
  it('rejects a doneStage the work items do not have', () =>
    fails(VALID, /doneStage "done"/, { stages: ['plan', 'in-progress', 'review'] }));

  describe('placeholders', () => {
    it('rejects unknown ones in a prompt', () =>
      fails(mutate((d) => (d.steps[0].prompt = 'hi {{item.nope}}')), /unknown placeholder \{\{item\.nope\}\}/));
    it('rejects unknown ones in exitPrompt', () =>
      fails(mutate((d) => (d.steps[0].exitPrompt = '{{foo}}')), /unknown placeholder \{\{foo\}\}/));
    it('rejects unknown ones in requires', () =>
      fails(mutate((d) => (d.steps[1].requires = ['{{task.nope}}'])), /unknown placeholder/));
    it('refuses {{task.id}} and {{task.branch}} in the first session of the first step (the task does not exist yet)', () => {
      fails(mutate((d) => (d.steps[0].prompt = 'Plan {{task.id}}')), /steps\[0\]\.prompt: \{\{task\.id\}\} is not known before the task starts/);
      fails(mutate((d) => (d.steps[0].prompt = 'On {{ task.branch }}')), /\{\{task\.branch\}\} is not known before the task starts/);
    });
    it('allows {{task.*}} in the first step\'s exitPrompt and later sessions', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].exitPrompt = 'Commit on {{task.branch}} of {{task.id}}')))).not.toThrow());
    it('tolerates whitespace inside braces', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].prompt = '{{ item.id }}')))).not.toThrow());
  });

  describe('requires paths', () => {
    it('refuses an absolute path', () => fails(mutate((d) => (d.steps[1].requires = ['/etc/passwd'])), /requires\[0\].*"\/etc\/passwd".*relative/));
    it('refuses a path with ..', () => fails(mutate((d) => (d.steps[1].requires = ['plans/../../x.md'])), /requires\[0\].*relative/));
    it('refuses .. around placeholders', () => fails(mutate((d) => (d.steps[1].requires = ['../{{item.id}}.md'])), /requires\[0\]/));
    it('accepts relative paths with placeholders and dots in names', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[1].requires = ['plans/{{item.id}}.md', './a..b/c.md'])))).not.toThrow());
  });

  it('names WorkflowDefinitionError', () => {
    try { parseWorkflowDefinition('wf', 'x: 1'); } catch (e) { expect(e).toBeInstanceOf(WorkflowDefinitionError); }
  });
});

describe('validateWorkflowDefinition (on the parsed object)', () => {
  const step = (o: object = {}) => ({ id: 's1', title: 'S', gate: 'auto', prompt: 'p', ...o });
  const doc = (o: object = {}) => ({ title: 'T', steps: [step()], ...o });
  const err = (d: unknown, opts = {}): WorkflowDefinitionError => {
    try { validateWorkflowDefinition('x', d, opts); } catch (e) { return e as WorkflowDefinitionError; }
    throw new Error('did not throw');
  };

  it('returns the normalized definition and drops unknown keys', () => {
    expect(validateWorkflowDefinition('x', doc({ extra: 1 }))).toEqual({
      id: 'x', title: 'T', steps: [{ id: 's1', title: 'S', gate: 'auto', prompt: 'p' }],
    });
  });

  it.each([
    ['title', doc({ title: '' }), { field: 'title' }],
    ['steps', doc({ steps: [] }), { field: 'steps' }],
    ['step title', doc({ steps: [step({ title: ' ' })] }), { stepId: 's1', field: 'title' }],
    ['gate', doc({ steps: [step({ gate: 'x' })] }), { stepId: 's1', field: 'gate' }],
    ['stage', doc({ steps: [step({ stage: 'nope' })] }), { stepId: 's1', field: 'stage' }],
    ['duplicate step', doc({ steps: [step(), step()] }), { stepId: 's1', field: 'id' }],
    ['bad step id', doc({ steps: [step({ id: 'A b' })] }), { stepId: 'A b', field: 'id' }],
    ['main on a later step', doc({ steps: [step(), step({ id: 'main' })] }), { stepId: 'main', field: 'id' }],
    ['prompt placeholder', doc({ steps: [step({ prompt: '{{nope}}' })] }), { stepId: 's1', field: 'prompt' }],
    ['task placeholder in first prompt', doc({ steps: [step({ prompt: '{{task.id}}' })] }), { stepId: 's1', field: 'prompt' }],
    ['missing prompt', doc({ steps: [step({ prompt: undefined })] }), { stepId: 's1', field: 'prompt' }],
    ['fork', doc({ steps: [step(), step({ id: 'b', fork: 'zz' })] }), { stepId: 'b', field: 'fork' }],
    ['continue', doc({ steps: [step(), step({ id: 'b', continue: 'zz' })] }), { stepId: 'b', field: 'continue' }],
    ['continue and fork', doc({ steps: [step(), step({ id: 'b', continue: 's1', fork: 's1' })] }), { stepId: 'b', field: 'fork' }],
    ['continue on first', doc({ steps: [step({ continue: 's1' })] }), { stepId: 's1', field: 'continue' }],
    ['model with continue', doc({ steps: [step(), step({ id: 'b', continue: 's1', model: 'm' })] }), { stepId: 'b', field: 'model' }],
    ['model', doc({ steps: [step({ model: '' })] }), { stepId: 's1', field: 'model' }],
    ['requires', doc({ steps: [step({ requires: ['../x'] })] }), { stepId: 's1', field: 'requires' }],
    ['exitPrompt', doc({ steps: [step({ exitPrompt: '{{bad}}' })] }), { stepId: 's1', field: 'exitPrompt' }],
    ['doneStage', doc({ doneStage: 'nope' }), { field: 'doneStage' }],
    ['empty step id', doc({ steps: [step(), step({ id: ' ' })] }), { stepIndex: 1, field: 'id' }],
    ['missing step id', doc({ steps: [step({ id: undefined })] }), { stepIndex: 0, field: 'id' }],
    ['old format', doc({ steps: [step({ sessions: [] })] }), { stepId: 's1', field: 'sessions' }],
  ])('locates %s', (_n, d, location) => {
    expect(err(d, { stages: ['plan'] }).location).toEqual(location);
  });

  it('reports the first error only, in document order', () => {
    const e = err(doc({ steps: [step({ gate: 'x', prompt: '' })] }));
    expect(e.location).toEqual({ stepId: 's1', field: 'gate' });
  });

  it('parseWorkflowDefinition gives the same error with the same text', () => {
    expect(() => parseWorkflowDefinition('x', 'title: T\nsteps:\n  - id: a\n    title: A\n    gate: nope\n    prompt: p\n')).toThrow('steps[0].gate must be "human" or "auto"');
  });
});
