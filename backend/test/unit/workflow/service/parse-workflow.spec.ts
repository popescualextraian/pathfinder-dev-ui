import { parseWorkflowDefinition, WorkflowDefinitionError } from '../../../../src/workflow/service/parse-workflow';

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
    for (const k of ['id', 'title', 'stage', 'gate', 'sessions']) {
      fails(mutate((d) => delete d.steps[1][k]), new RegExp(`steps\\[1\\].*${k}`));
    }
  });
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
    it('tolerates whitespace inside braces', () =>
      expect(() => parseWorkflowDefinition('wf', mutate((d) => (d.steps[0].sessions[0].prompt = '{{ item.id }}')))).not.toThrow());
  });

  it('names WorkflowDefinitionError', () => {
    try { parseWorkflowDefinition('wf', 'x: 1'); } catch (e) { expect(e).toBeInstanceOf(WorkflowDefinitionError); }
  });
});
