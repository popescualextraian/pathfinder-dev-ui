import { parseWorkflowDefinition, validateWorkflowDefinition, WorkflowDefinitionError } from '../../../../src/workflow/service/parse-workflow';

const VALID = `
title: Plan, implement, review
steps:
  - id: plan
    title: Plan
    stage: plan
    sessions:
      - name: main
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
    sessions:
      - name: impl
        prompt: Implement plans/{{item.id}}.md on {{task.branch}} ({{task.id}}, {{step.id}}).
    gate: auto
  - id: review
    title: Review
    stage: review
    sessions:
      - name: review
        fork: impl
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
    expect(d.steps[2].sessions[0]).toMatchObject({ name: 'review', fork: 'impl', model: 'sonnet' });
  });

  it('accepts any stage when none are known', () => {
    expect(() => parseWorkflowDefinition('wf', VALID)).not.toThrow();
  });

  it('rejects invalid YAML', () => fails('title: [unclosed', /invalid YAML/));
  it('rejects a non-mapping document', () => fails('- a', /mapping/));
  it('requires a title', () => fails(mutate((d) => delete d.title), /title/));
  it('requires non-empty steps', () => fails(mutate((d) => (d.steps = [])), /steps/));
  it('requires step fields', () => {
    for (const k of ['id', 'title', 'gate', 'sessions']) {
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
  it('rejects empty sessions', () => fails(mutate((d) => (d.steps[1].sessions = [])), /sessions/));
  it('rejects a bad gate', () => fails(mutate((d) => (d.steps[0].gate = 'maybe')), /gate/));
  it('rejects duplicate step ids', () => fails(mutate((d) => (d.steps[1].id = 'plan')), /duplicate step id "plan"/));
  it('rejects duplicate session names', () => fails(mutate((d) => (d.steps[2].sessions[0].name = 'impl')), /duplicate session name "impl"/));
  it('rejects a bad session name', () => fails(mutate((d) => (d.steps[1].sessions[0].name = 'Bad Name')), /session name/));
  it('requires the first session to be main', () => fails(mutate((d) => (d.steps[0].sessions[0].name = 'first')), /"main"/));
  it('requires a session prompt', () => fails(mutate((d) => delete d.steps[1].sessions[0].prompt), /prompt/));
  it('rejects a fork from an unknown session', () => fails(mutate((d) => (d.steps[2].sessions[0].fork = 'nope')), /fork.*"nope"/));
  it('rejects a fork from a later session', () => fails(mutate((d) => (d.steps[1].sessions[0].fork = 'review')), /fork.*"review"/));
  it('rejects a fork from itself', () => fails(mutate((d) => (d.steps[1].sessions[0].fork = 'impl')), /fork/));
  it('rejects requires that is not a string list', () => fails(mutate((d) => (d.steps[1].requires = 'x')), /requires/));
  it('rejects a non-string model', () => fails(mutate((d) => (d.steps[2].sessions[0].model = 3)), /model/));
  it('rejects a stage the work items do not have', () =>
    fails(VALID, /stage "in-progress"/, { stages: ['plan', 'review', 'done'] }));
  it('rejects a doneStage the work items do not have', () =>
    fails(VALID, /doneStage "done"/, { stages: ['plan', 'in-progress', 'review'] }));

  describe('placeholders', () => {
    it('rejects unknown ones in a prompt', () =>
      fails(mutate((d) => (d.steps[0].sessions[0].prompt = 'hi {{item.nope}}')), /unknown placeholder \{\{item\.nope\}\}/));
    it('rejects unknown ones in exitPrompt', () =>
      fails(mutate((d) => (d.steps[0].exitPrompt = '{{foo}}')), /unknown placeholder \{\{foo\}\}/));
    it('rejects unknown ones in requires', () =>
      fails(mutate((d) => (d.steps[1].requires = ['{{task.nope}}'])), /unknown placeholder/));
    it('refuses {{task.id}} and {{task.branch}} in the first session of the first step (the task does not exist yet)', () => {
      fails(mutate((d) => (d.steps[0].sessions[0].prompt = 'Plan {{task.id}}')), /steps\[0\]\.sessions\[0\]\.prompt: \{\{task\.id\}\} is not known before the task starts/);
      fails(mutate((d) => (d.steps[0].sessions[0].prompt = 'On {{ task.branch }}')), /\{\{task\.branch\}\} is not known before the task starts/);
    });
    it('allows {{task.*}} in the first step\'s exitPrompt and later sessions', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].exitPrompt = 'Commit on {{task.branch}} of {{task.id}}')))).not.toThrow());
    it('tolerates whitespace inside braces', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].sessions[0].prompt = '{{ item.id }}')))).not.toThrow());
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
  const session = (o: object = {}) => ({ name: 'main', prompt: 'p', ...o });
  const step = (o: object = {}) => ({ id: 's1', title: 'S', gate: 'auto', sessions: [session()], ...o });
  const doc = (o: object = {}) => ({ title: 'T', steps: [step()], ...o });
  const err = (d: unknown, opts = {}): WorkflowDefinitionError => {
    try { validateWorkflowDefinition('x', d, opts); } catch (e) { return e as WorkflowDefinitionError; }
    throw new Error('did not throw');
  };

  it('returns the normalized definition and drops unknown keys', () => {
    expect(validateWorkflowDefinition('x', doc({ extra: 1 }))).toEqual({
      id: 'x', title: 'T', steps: [{ id: 's1', title: 'S', gate: 'auto', sessions: [{ name: 'main', prompt: 'p' }] }],
    });
  });

  it.each([
    ['title', doc({ title: '' }), { field: 'title' }],
    ['steps', doc({ steps: [] }), { field: 'steps' }],
    ['step title', doc({ steps: [step({ title: ' ' })] }), { stepId: 's1', field: 'title' }],
    ['gate', doc({ steps: [step({ gate: 'x' })] }), { stepId: 's1', field: 'gate' }],
    ['stage', doc({ steps: [step({ stage: 'nope' })] }), { stepId: 's1', field: 'stage' }],
    ['duplicate step', doc({ steps: [step(), step()] }), { stepId: 's1', field: 'id' }],
    ['first session name', doc({ steps: [step({ sessions: [session({ name: 'other' })] })] }), { stepId: 's1', session: 'other', field: 'name' }],
    ['duplicate session', doc({ steps: [step({ sessions: [session(), session()] })] }), { stepId: 's1', session: 'main', field: 'name' }],
    ['prompt placeholder', doc({ steps: [step({ sessions: [session({ prompt: '{{nope}}' })] })] }), { stepId: 's1', session: 'main', field: 'prompt' }],
    ['task placeholder in first prompt', doc({ steps: [step({ sessions: [session({ prompt: '{{task.id}}' })] })] }), { stepId: 's1', session: 'main', field: 'prompt' }],
    ['fork', doc({ steps: [step({ sessions: [session(), session({ name: 'b', fork: 'zz' })] })] }), { stepId: 's1', session: 'b', field: 'fork' }],
    ['model', doc({ steps: [step({ sessions: [session({ model: '' })] })] }), { stepId: 's1', session: 'main', field: 'model' }],
    ['requires', doc({ steps: [step({ requires: ['../x'] })] }), { stepId: 's1', field: 'requires' }],
    ['exitPrompt', doc({ steps: [step({ exitPrompt: '{{bad}}' })] }), { stepId: 's1', field: 'exitPrompt' }],
    ['doneStage', doc({ doneStage: 'nope' }), { field: 'doneStage' }],
  ])('locates %s', (_n, d, location) => {
    expect(err(d, { stages: ['plan'] }).location).toEqual(location);
  });

  it('reports the first error only, in document order', () => {
    const e = err(doc({ steps: [step({ gate: 'x', sessions: [] })] }));
    expect(e.location).toEqual({ stepId: 's1', field: 'gate' });
  });

  it('parseWorkflowDefinition gives the same error with the same text', () => {
    expect(() => parseWorkflowDefinition('x', 'title: T\nsteps:\n  - id: a\n    title: A\n    gate: nope\n    sessions: []\n')).toThrow('steps[0].gate must be "human" or "auto"');
  });
});
